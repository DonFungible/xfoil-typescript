#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { arch, cwd, env, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { assertExecutableTarget } from "./inspect-executable.mjs";
import {
  DEFAULT_XFOIL_SOURCE_SHA256,
  TARGET_NAMES,
  TARGETS,
  XFOIL_VERSION,
} from "./xfoil-targets.mjs";

const XFOIL_SOURCE_SHA256 = env.XFOIL_SOURCE_SHA256 ?? DEFAULT_XFOIL_SOURCE_SHA256;
const XFOIL_SOURCE_URL =
  env.XFOIL_SOURCE_URL ?? `https://web.mit.edu/drela/Public/web/xfoil/xfoil${XFOIL_VERSION}.tgz`;
const FC = env.FC ?? "gfortran";
const MAKE = env.MAKE ?? "make";
const NM = env.NM ?? "nm";
const OBJDUMP = env.OBJDUMP ?? "objdump";
const TAR = env.TAR ?? "tar";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STUB_SOURCE = join(ROOT, "build", "stub-plotlib", "stub.f");
const GPL_TEXT = join(ROOT, "build", "GPL-2.0.txt");
const GOLDEN_CASES = join(ROOT, "build", "golden", `xfoil-${XFOIL_VERSION}.json`);
const DEFAULT_TARGET = `${platform}-${arch}`;
const SUPPORTED_TARGETS = new Set(TARGET_NAMES);

const args = parseArgs(process.argv.slice(2));
const target = args.target ?? DEFAULT_TARGET;
const stage = args.stage ?? true;

if (!SUPPORTED_TARGETS.has(target)) {
  throw new Error(
    `Unsupported target "${target}". Supported targets: ${[...SUPPORTED_TARGETS].join(", ")}`,
  );
}

const executableName = TARGETS[target].executable;
const packageDir = join(ROOT, "packages", "binaries", target);
const workDir = args.workDir
  ? resolve(cwd(), args.workDir)
  : await mkdtemp(join(tmpdir(), `xfoil-build-${target}-`));

try {
  await main();
} finally {
  if (!args.keepWork && !args.workDir) {
    await rm(workDir, { force: true, recursive: true });
  }
}

async function main() {
  await ensureFile(STUB_SOURCE, "plotlib stub");
  await ensureFile(GPL_TEXT, "GPL-2.0 license text");
  await ensureFile(GOLDEN_CASES, "XFOIL numerical golden cases");
  await ensureCommand(FC, ["--version"]);
  await ensureCommand(MAKE, ["--version"]);
  await ensureCommand(NM, ["--version"]);
  if (target.startsWith("win32")) await ensureCommand(OBJDUMP, ["--version"]);

  await mkdir(workDir, { recursive: true });
  const archive = args.sourceArchive
    ? resolve(cwd(), args.sourceArchive)
    : join(workDir, basename(new URL(XFOIL_SOURCE_URL).pathname));
  if (!args.sourceArchive) await download(XFOIL_SOURCE_URL, archive);
  await verifyArchiveChecksum(archive);

  await run(TAR, ["-xzf", archive, "-C", workDir]);
  const xfoilRoot = join(workDir, "Xfoil");
  const binDir = join(xfoilRoot, "bin");
  await ensureFile(join(binDir, "Makefile_gfortran"), "XFOIL gfortran makefile");

  await compileSolverObjects(binDir);
  await verifyStubSymbols(binDir);
  await copyFile(STUB_SOURCE, join(binDir, "stub_plotlib.f"));
  await run(FC, ["-c", ...compileFlags(), "stub_plotlib.f"], { cwd: binDir });

  const objects = (await readdir(binDir)).filter((file) => file.endsWith(".o")).sort();
  const binaryPath = join(binDir, executableName);
  await run(FC, [...linkFlags(), "-o", binaryPath, ...objects], { cwd: binDir });
  await chmod(binaryPath, 0o755);
  await verifyExecutableTarget(binaryPath);

  const version = await readVersion(binaryPath);
  if (version !== XFOIL_VERSION) {
    throw new Error(`Built XFOIL ${version}, expected ${XFOIL_VERSION}.`);
  }

  await smokeTest(binaryPath);
  await goldenTest(binaryPath);
  await verifyDependencies(binaryPath);

  if (stage) await stagePackage(binaryPath);

  console.log(`Built XFOIL ${version} for ${target}: ${binaryPath}`);
  if (stage) console.log(`Staged package: ${packageDir}`);
}

async function compileSolverObjects(binDir) {
  const result = await run(
    MAKE,
    [
      "-f",
      "Makefile_gfortran",
      "xfoil",
      "BINDIR=/tmp/xfoil-build-unused",
      "PLTOBJ=",
      "PLTLIB=",
      "INSTALLCMD=true",
      `FFLAGS=${compileFlags().join(" ")}`,
      `FFLOPT=${compileFlags().join(" ")}`,
    ],
    { allowFailure: true, cwd: binDir },
  );

  const objects = (await readdir(binDir)).filter((file) => file.endsWith(".o"));
  if (objects.length === 0) {
    throw new Error(`XFOIL object compilation failed before producing objects:\n${result.stderr}`);
  }
}

async function verifyStubSymbols(binDir) {
  const objects = (await readdir(binDir)).filter((file) => file.endsWith(".o")).sort();
  const defined = collectDefinedFortranSymbols(
    (await run(NM, ["-g", ...objects], { cwd: binDir })).stdout,
  );
  const unresolved = collectFortranSymbols(
    (await run(NM, ["-u", ...objects], { cwd: binDir })).stdout,
  );
  const external = [...unresolved].filter((symbol) => !defined.has(symbol)).sort();
  const stubbed = collectStubSymbols(await readFile(STUB_SOURCE, "utf8"));
  const missing = external.filter((symbol) => !stubbed.has(symbol));
  const extra = [...stubbed].filter((symbol) => !external.includes(symbol)).sort();

  if (missing.length || extra.length) {
    throw new Error(
      [
        "build/stub-plotlib/stub.f does not match the pinned XFOIL external plotlib surface.",
        missing.length ? `Missing: ${missing.join(", ")}` : undefined,
        extra.length ? `Extra: ${extra.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function stagePackage(binaryPath) {
  await mkdir(packageDir, { recursive: true });
  await copyFile(binaryPath, join(packageDir, executableName));
  await chmod(join(packageDir, executableName), 0o755);
  await copyFile(GPL_TEXT, join(packageDir, "LICENSE"));
  await writeFile(join(packageDir, "VERSION"), `${XFOIL_VERSION}\n`, "utf8");

  const packageJsonPath = join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.xfoilVersion = XFOIL_VERSION;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  await writeFile(
    join(packageDir, "SOURCE_OFFER.md"),
    `# Source Offer

This package contains a headless XFOIL ${XFOIL_VERSION} executable built from the upstream source archive hosted by MIT:

- Source archive: ${XFOIL_SOURCE_URL}
- Source SHA-256: ${XFOIL_SOURCE_SHA256}
- Local build script: \`scripts/build-xfoil-binary.mjs\`
- Local plot stub: \`build/stub-plotlib/stub.f\`
- Local patches: none

XFOIL is Copyright (C) Mark Drela and Harold Youngren and is distributed under the GNU General Public License, version 2 or later. The full GPL v2 text is included in \`LICENSE\`.

For any released binary package, the corresponding source is the upstream archive above plus this repository's build scripts and release tag. If you need a copy of the corresponding source, open an issue at the repository URL in \`package.json\`; a written offer is valid for at least three years from the package release date.
`,
    "utf8",
  );
}

async function verifyExecutableTarget(binaryPath) {
  assertExecutableTarget(await readFile(binaryPath), target, TARGETS[target]);
}

function compileFlags() {
  return ["-O2", "-fdefault-real-8", "-std=legacy", "-fallow-argument-mismatch"];
}

function linkFlags() {
  const flags = ["-static-libgfortran", "-static-libgcc", "-static-libquadmath"];

  if (target.startsWith("win32")) return ["-static", ...flags];
  if (target.startsWith("darwin")) {
    const sdk = env.SDKROOT ?? runSync("xcrun", ["--show-sdk-path"]).trim();
    return [`-Wl,-syslibroot,${sdk}`, ...flags];
  }

  return flags;
}

async function readVersion(binaryPath) {
  const result = await run(binaryPath, [], { input: "QUIT\n" });
  return result.stdout.match(/Version\s+([0-9.]+)/i)?.[1] ?? "unknown";
}

async function smokeTest(binaryPath) {
  const runDir = await mkdtemp(join(tmpdir(), "xfoil-smoke-"));
  try {
    await run(binaryPath, [], {
      cwd: runDir,
      input: [
        "PLOP",
        "G F",
        "",
        "NACA 0012",
        "OPER",
        "VISC 1000000",
        "ITER 50",
        "PACC",
        "polar.txt",
        "",
        "ASEQ 0 2 1",
        "PACC",
        "",
        "QUIT",
        "",
      ].join("\n"),
      timeoutMs: 15_000,
    });
    const polar = await readFile(join(runDir, "polar.txt"), "utf8");
    const rows = polar.split(/\r?\n/).filter((line) => /^\s*-?\d+\.\d+/.test(line));
    if (rows.length < 3 || !/NACA 0012/.test(polar)) {
      throw new Error(`Smoke polar is not parseable:\n${polar.slice(0, 500)}`);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
}

async function goldenTest(binaryPath) {
  const golden = JSON.parse(await readFile(GOLDEN_CASES, "utf8"));
  if (golden.xfoilVersion !== XFOIL_VERSION) {
    throw new Error(`Golden file version ${golden.xfoilVersion} does not match ${XFOIL_VERSION}.`);
  }

  for (const testCase of golden.cases ?? []) {
    const runDir = await mkdtemp(join(tmpdir(), "xfoil-golden-"));
    try {
      await run(binaryPath, [], {
        cwd: runDir,
        input: [
          "PLOP",
          "G F",
          "",
          `NACA ${testCase.airfoil}`,
          "PANE",
          "OPER",
          `VISC ${testCase.reynolds}`,
          testCase.mach ? `MACH ${testCase.mach}` : undefined,
          "ITER 200",
          "PACC",
          "polar.txt",
          "",
          `ALFA ${testCase.alpha}`,
          "PACC",
          "",
          "QUIT",
          "",
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
        timeoutMs: 15_000,
      });
      const polar = await readFile(join(runDir, "polar.txt"), "utf8");
      const point = parseFirstPolarPoint(polar);
      assertClose(point.alpha, testCase.alpha, 1e-6, testCase, "alpha");
      assertClose(point.cl, testCase.cl, golden.tolerances.cl, testCase, "cl");
      assertClose(point.cd, testCase.cd, golden.tolerances.cd, testCase, "cd");
      assertClose(point.cm, testCase.cm, golden.tolerances.cm, testCase, "cm");
    } finally {
      await rm(runDir, { force: true, recursive: true });
    }
  }
}

function parseFirstPolarPoint(polar) {
  for (const line of polar.split(/\r?\n/)) {
    if (!/^\s*-?\d+\.\d+/.test(line)) continue;
    const values = line.trim().split(/\s+/).map(Number.parseFloat);
    if (values.length >= 7 && values.every(Number.isFinite)) {
      return {
        alpha: values[0],
        cl: values[1],
        cd: values[2],
        cm: values[4],
      };
    }
  }
  throw new Error(`Golden polar did not contain a numeric row:\n${polar.slice(0, 500)}`);
}

function assertClose(actual, expected, tolerance, testCase, field) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      [
        `Golden mismatch for ${testCase.airfoil} Re=${testCase.reynolds} Mach=${testCase.mach} alpha=${testCase.alpha} ${field}.`,
        `Expected ${expected} +/- ${tolerance}, got ${actual}.`,
      ].join("\n"),
    );
  }
}

async function verifyDependencies(binaryPath) {
  if (target.startsWith("darwin")) {
    const output = (await run("otool", ["-L", binaryPath])).stdout;
    assertNoDisallowedDependencies(output, [
      "libX11",
      "libgfortran",
      "libquadmath",
      "libgcc",
      "/opt/homebrew",
    ]);
    return;
  }

  if (target.startsWith("linux")) {
    const output = (await run("ldd", [binaryPath], { allowFailure: true })).stdout;
    assertNoDisallowedDependencies(output, ["libX11", "libgfortran", "libquadmath", "libgcc"]);
    return;
  }

  if (target.startsWith("win32")) {
    const output = (await run(OBJDUMP, ["-p", binaryPath])).stdout;
    assertNoDisallowedDependencies(output, [
      "libX11",
      "libgcc",
      "libgfortran",
      "libquadmath",
      "libstdc++",
      "libwinpthread",
    ]);
  }
}

async function verifyArchiveChecksum(archive) {
  const buffer = await readFile(archive);
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== XFOIL_SOURCE_SHA256) {
    throw new Error(
      `XFOIL source checksum mismatch for ${archive}. Expected ${XFOIL_SOURCE_SHA256}, got ${actual}.`,
    );
  }
}

function assertNoDisallowedDependencies(output, disallowed) {
  const found = disallowed.filter((needle) => output.includes(needle));
  if (found.length > 0) {
    throw new Error(`Binary has disallowed dynamic dependencies (${found.join(", ")}):\n${output}`);
  }
}

function collectFortranSymbols(output) {
  const symbols = new Set();
  for (const token of output.split(/\s+/)) {
    const normalized = normalizeFortranSymbol(token);
    if (normalized) symbols.add(normalized);
  }
  return symbols;
}

function collectDefinedFortranSymbols(output) {
  const symbols = new Set();
  for (const line of output.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3 || tokens[1] === "U") continue;
    const normalized = normalizeFortranSymbol(tokens[tokens.length - 1] ?? "");
    if (normalized) symbols.add(normalized);
  }
  return symbols;
}

function collectStubSymbols(source) {
  const symbols = new Set();
  for (const match of source.matchAll(/^\s*SUBROUTINE\s+([A-Z][A-Z0-9_]*)\b/gim)) {
    symbols.add(match[1].toUpperCase());
  }
  return symbols;
}

function normalizeFortranSymbol(token) {
  const withoutLeadingUnderscores = token.trim().replace(/^_+/, "");
  if (!/^[A-Za-z][A-Za-z0-9_]*_$/.test(withoutLeadingUnderscores)) return undefined;
  const name = withoutLeadingUnderscores.slice(0, -1);
  if (name === "GLOBAL_OFFSET_TABLE") return undefined;
  if (name.toLowerCase().startsWith("gfortran")) return undefined;
  return name.toUpperCase();
}

async function download(url, destination) {
  await new Promise((resolvePromise, reject) => {
    const request = get(url, (response) => {
      const redirect = response.headers.location;
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        redirect
      ) {
        response.resume();
        download(new URL(redirect, url).toString(), destination).then(resolvePromise, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolvePromise));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function ensureCommand(command, argsForProbe) {
  await run(command, argsForProbe, {
    allowFailure: false,
    timeoutMs: 10_000,
  }).catch((error) => {
    throw new Error(`Required command not available: ${command}\n${error.message}`);
  });
}

async function ensureFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { code, stderr, stdout };
      if (!options.allowFailure && (timedOut || code !== 0)) {
        reject(
          new Error(
            [
              `${command} ${args.join(" ")} failed with code ${code}${timedOut ? " (timeout)" : ""}.`,
              stderr.trim(),
              stdout.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }
      resolvePromise(result);
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function runSync(command, args) {
  return execFileSync(command, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

function parseArgs(rawArgs) {
  const parsed = {
    keepWork: false,
    sourceArchive: undefined,
    stage: true,
    target: undefined,
    workDir: undefined,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = () => {
      const value = rawArgs[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--target") parsed.target = next();
    else if (arg === "--") continue;
    else if (arg === "--source-archive") parsed.sourceArchive = next();
    else if (arg === "--work-dir") parsed.workDir = next();
    else if (arg === "--keep-work") parsed.keepWork = true;
    else if (arg === "--no-stage") parsed.stage = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/build-xfoil-binary.mjs [options]

Options:
  --target <platform-arch>       Target package (default: ${DEFAULT_TARGET})
  --source-archive <path>        Use an existing xfoil${XFOIL_VERSION}.tgz archive
  --work-dir <path>              Reuse a build directory instead of a temp dir
  --keep-work                    Keep the generated temp work directory
  --no-stage                     Build and verify without copying into packages/binaries
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}
