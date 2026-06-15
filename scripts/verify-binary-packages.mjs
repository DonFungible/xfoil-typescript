#!/usr/bin/env node

import { constants } from "node:fs";
import { access, chmod, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { assertExecutableTarget } from "./inspect-executable.mjs";
import { DEFAULT_XFOIL_SOURCE_SHA256, TARGETS, XFOIL_VERSION } from "./xfoil-targets.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const args = parseArgs(process.argv.slice(2));
const targets = args.targets.length > 0 ? args.targets : Object.keys(TARGETS);
const errors = [];

for (const target of targets) {
  const config = TARGETS[target];
  if (!config) {
    errors.push(`Unsupported target: ${target}`);
    continue;
  }
  await verifyTarget(target, config).catch((error) => {
    errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Verified ${targets.length} binary package${targets.length === 1 ? "" : "s"}.`);

async function verifyTarget(target, config) {
  const packageDir = join(ROOT, "packages", "binaries", target);
  const packageJson = await readJson(join(packageDir, "package.json"));
  const executable = join(packageDir, config.executable);
  const license = await readText(join(packageDir, "LICENSE"));
  const sourceOffer = await readText(join(packageDir, "SOURCE_OFFER.md"));
  const version = (await readText(join(packageDir, "VERSION"))).trim();

  assertEqual(packageJson.name, `@xfoil/${target}`, "package name");
  assertEqual(packageJson.license, "GPL-2.0-or-later", "license");
  assertEqual(packageJson.xfoilVersion, XFOIL_VERSION, "package xfoilVersion");
  assertEqual(version, XFOIL_VERSION, "VERSION");
  assertSingle(packageJson.os, config.os, "os");
  assertSingle(packageJson.cpu, config.cpu, "cpu");

  for (const file of [config.executable, "LICENSE", "SOURCE_OFFER.md", "VERSION", "README.md"]) {
    if (!packageJson.files?.includes(file)) {
      throw new Error(`package.json files does not include ${file}`);
    }
  }

  if (!license.includes("GNU GENERAL PUBLIC LICENSE")) {
    throw new Error("LICENSE is not the full GPL text");
  }
  if (!sourceOffer.includes(`XFOIL ${XFOIL_VERSION}`)) {
    throw new Error(`SOURCE_OFFER.md does not mention XFOIL ${XFOIL_VERSION}`);
  }
  if (!sourceOffer.includes(DEFAULT_XFOIL_SOURCE_SHA256)) {
    throw new Error("SOURCE_OFFER.md does not include the pinned source checksum");
  }

  const executableBuffer = await readFile(executable);
  assertExecutableTarget(executableBuffer, target, config);

  const executableStats = await stat(executable);
  if (!executableStats.isFile() || executableStats.size === 0) {
    throw new Error(`${config.executable} is missing or empty`);
  }

  if (target === `${platform}-${arch}`) {
    await chmod(executable, 0o755).catch(() => undefined);
    await access(executable, constants.X_OK);
  }
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function readText(path) {
  return readFile(path, "utf8").catch((error) => {
    throw new Error(`Could not read ${path}: ${error.message}`);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual ?? "(missing)"}`);
  }
}

function assertSingle(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== 1 || actual[0] !== expected) {
    throw new Error(`${label} expected [${expected}], got ${JSON.stringify(actual)}`);
  }
}

function parseArgs(rawArgs) {
  const parsed = { targets: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = () => {
      const value = rawArgs[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--target") parsed.targets.push(next());
    else if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/verify-binary-packages.mjs [options]

Options:
  --target <platform-arch>       Verify one target; repeat for multiple targets.
                                 Defaults to every supported target.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
