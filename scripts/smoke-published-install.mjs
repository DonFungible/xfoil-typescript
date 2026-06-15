#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arch, platform } from "node:process";

const DEFAULT_TARGET = `${platform}-${arch}`;
const args = parseArgs(process.argv.slice(2));
const spec = args.spec ?? "xfoil@latest";
const target = args.target ?? DEFAULT_TARGET;

if (target !== DEFAULT_TARGET) {
  throw new Error(
    `Published-install smoke can only execute the current platform (${DEFAULT_TARGET}); got ${target}.`,
  );
}

const workDir = await mkdtemp(join(tmpdir(), `xfoil-published-smoke-${target}-`));

try {
  await main();
} finally {
  if (!args.keepWork) await rm(workDir, { force: true, recursive: true });
}

async function main() {
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", spec], {
    cwd: workDir,
    timeoutMs: 120_000,
  });

  const doctor = await run("npm", ["exec", "--", "xfoil", "doctor", "--json"], {
    cwd: workDir,
    timeoutMs: 30_000,
  });
  const doctorJson = JSON.parse(doctor.stdout);
  if (!doctorJson.ok || doctorJson.version !== "6.99") {
    throw new Error(`Published doctor failed:\n${doctor.stdout}\n${doctor.stderr}`);
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
    throw new Error(`Published runtime smoke failed:\n${runtime.stdout}\n${runtime.stderr}`);
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
        spec,
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
      cwd: options.cwd ?? process.cwd(),
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
  return platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

function parseArgs(rawArgs) {
  const parsed = { keepWork: false, spec: undefined, target: undefined };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = () => {
      const value = rawArgs[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--spec") parsed.spec = next();
    else if (arg === "--target") parsed.target = next();
    else if (arg === "--keep-work") parsed.keepWork = true;
    else if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/smoke-published-install.mjs [options]

Options:
  --spec <npm-spec>              Package spec to install (default: xfoil@latest).
  --target <platform-arch>       Assert the current platform target.
  --keep-work                    Keep the temp install directory.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
