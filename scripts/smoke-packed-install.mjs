#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TARGET = `${platform}-${arch}`;
const args = parseArgs(process.argv.slice(2));
const target = args.target ?? DEFAULT_TARGET;
const binaryPackage = `@xfoil/${target}`;

if (target !== DEFAULT_TARGET) {
  throw new Error(
    `Packed-install smoke can only execute the current platform (${DEFAULT_TARGET}); got ${target}.`,
  );
}

const workDir = await mkdtemp(join(tmpdir(), `xfoil-packed-smoke-${target}-`));

try {
  await main();
} finally {
  if (!args.keepWork) await rm(workDir, { force: true, recursive: true });
}

async function main() {
  const packDir = join(workDir, "packs");
  await mkdir(packDir, { recursive: true });

  await run("pnpm", ["--filter", "xfoil", "build"], { cwd: ROOT });
  const wrapper = await packPackage("xfoil", packDir);
  const binary = await packPackage(binaryPackage, packDir);
  await writeFile(join(workDir, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", binary, wrapper], {
    cwd: workDir,
    timeoutMs: 120_000,
  });

  const bin =
    platform === "win32"
      ? join(workDir, "node_modules", ".bin", "xfoil.cmd")
      : join(workDir, "node_modules", ".bin", "xfoil");
  const doctor = await run(bin, ["doctor", "--json"], { cwd: workDir, timeoutMs: 30_000 });
  const doctorJson = JSON.parse(doctor.stdout);
  if (!doctorJson.ok || doctorJson.version !== "6.99") {
    throw new Error(`Packed doctor failed:\n${doctor.stdout}\n${doctor.stderr}`);
  }

  const runtime = await run(
    "node",
    [
      "--input-type=module",
      "-e",
      [
        "import { XFoil } from 'xfoil';",
        "const xf = new XFoil({ timeoutMs: 15000 });",
        "const polar = await xf.polar({ airfoil: { naca: '0012' }, reynolds: 1_000_000, alpha: { start: 0, end: 2, step: 1 }, iterations: 50 });",
        "console.log(JSON.stringify({ version: await xf.version(), points: polar.points.length, failed: polar.failed.length, cl: polar.points.at(-1)?.cl }));",
      ].join(" "),
    ],
    { cwd: workDir, timeoutMs: 30_000 },
  );
  const smoke = JSON.parse(runtime.stdout);
  if (smoke.version !== "6.99" || smoke.points !== 3 || smoke.failed !== 0) {
    throw new Error(`Packed runtime smoke failed:\n${runtime.stdout}\n${runtime.stderr}`);
  }

  console.log(
    JSON.stringify(
      {
        doctor: {
          binaryPath: doctorJson.binaryPath,
          platform: doctorJson.platform,
          version: doctorJson.version,
        },
        ok: true,
        runtime: smoke,
        target,
      },
      null,
      2,
    ),
  );
}

async function run(command, commandArgs, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const executable = resolveCommand(command);
    const child = spawn(executable, commandArgs, {
      cwd: options.cwd ?? ROOT,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            [
              `${command} ${commandArgs.join(" ")} failed with code ${code}.`,
              stderr.trim(),
              stdout.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

function resolveCommand(command) {
  return platform === "win32" && (command === "npm" || command === "pnpm")
    ? `${command}.cmd`
    : command;
}

async function packPackage(filter, packDir) {
  const before = new Set(await listTarballs(packDir));
  const result = await run("pnpm", ["--filter", filter, "pack", "--pack-destination", packDir], {
    cwd: ROOT,
  });
  const created = (await listTarballs(packDir)).filter((file) => !before.has(file));
  if (created.length !== 1) {
    throw new Error(
      [
        `Expected ${filter} pack to create exactly one tarball, found ${created.length}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return join(packDir, created[0]);
}

async function listTarballs(directory) {
  return (await readdir(directory)).filter((file) => file.endsWith(".tgz")).sort();
}

function parseArgs(rawArgs) {
  const parsed = { keepWork: false, target: undefined };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = () => {
      const value = rawArgs[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--target") parsed.target = next();
    else if (arg === "--keep-work") parsed.keepWork = true;
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
