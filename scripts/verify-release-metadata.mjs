#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TARGETS as BINARY_PACKAGES,
  DEFAULT_XFOIL_SOURCE_SHA256,
  WRAPPER_PACKAGE,
  XFOIL_VERSION,
} from "./xfoil-targets.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const errors = [];

await verify().catch((error) => {
  errors.push(error instanceof Error ? error.message : String(error));
});

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Release metadata verified.");

async function verify() {
  const rootPackage = await readJson("package.json");
  const wrapperPackage = await readJson("packages/xfoil/package.json");
  const changesetConfig = await readJson(".changeset/config.json");

  assertEqual(rootPackage.private, true, "root private");
  assertEqual(rootPackage.license, "MIT", "root license");
  assertIncludes(rootPackage.packageManager, "pnpm@", "root packageManager");
  assertEqual(wrapperPackage.name, WRAPPER_PACKAGE, "wrapper name");
  assertEqual(wrapperPackage.license, "MIT", "wrapper license");
  assertEqual(wrapperPackage.sideEffects, false, "wrapper sideEffects");
  assertEqual(wrapperPackage.bin?.xfoil, "./bin/xfoil.mjs", "wrapper bin");
  assertEqual(
    wrapperPackage.scripts?.prepublishOnly,
    "node ../../scripts/verify-release-metadata.mjs && node ../../scripts/verify-binary-packages.mjs",
    "wrapper prepublishOnly guard",
  );
  assertIncludes(wrapperPackage.files, "bin", "wrapper files");
  assertIncludes(wrapperPackage.files, "dist", "wrapper files");
  assertIncludes(wrapperPackage.files, "LICENSE", "wrapper files");
  assertIncludes(wrapperPackage.files, "README.md", "wrapper files");
  assertEqual(changesetConfig.access, "public", "changesets access");
  assertDeepEqual(changesetConfig.fixed, [["xfoil", "@xfoil/*"]], "changesets fixed packages");

  const wrapperVersion = wrapperPackage.version;
  const expectedOptionalDeps = {};
  for (const target of Object.keys(BINARY_PACKAGES)) {
    expectedOptionalDeps[`@xfoil/${target}`] = wrapperVersion;
  }
  assertDeepEqual(
    wrapperPackage.optionalDependencies,
    expectedOptionalDeps,
    "optional dependencies",
  );

  await verifyRequiredFiles([
    ".github/CODEOWNERS",
    ".github/workflows/build-binaries.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/docs.yml",
    ".github/workflows/release.yml",
    ".gitattributes",
    "build/golden/xfoil-6.99.json",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "docs/GUIDES.md",
    "docs/RELEASE_CHECKLIST.md",
    "docs/guides/browser-geometry.md",
    "docs/guides/byo-binary.md",
    "docs/guides/convergence.md",
    "docs/guides/custom-airfoils.md",
    "scripts/build-xfoil-binary.mjs",
    "scripts/check-npm-names.mjs",
    "scripts/inspect-executable.mjs",
    "scripts/smoke-packed-install.mjs",
    "scripts/smoke-published-install.mjs",
    "scripts/test-inspect-executable.mjs",
    "scripts/verify-binary-packages.mjs",
    "scripts/verify-release-metadata.mjs",
    "scripts/verify-workflows.mjs",
    "scripts/xfoil-targets.mjs",
  ]);

  const readme = await readText("README.md");
  assertIncludes(readme, "MIT", "README license");
  assertIncludes(readme, "GPL-2.0-or-later", "README license");
  assertIncludes(readme, "not affiliated with or endorsed", "README attribution");

  for (const [target, config] of Object.entries(BINARY_PACKAGES)) {
    await verifyBinaryPackage(target, config, wrapperVersion);
  }
}

async function verifyBinaryPackage(target, config, wrapperVersion) {
  const packageRoot = `packages/binaries/${target}`;
  const packageJson = await readJson(`${packageRoot}/package.json`);
  const version = (await readText(`${packageRoot}/VERSION`)).trim();
  const sourceOffer = await readText(`${packageRoot}/SOURCE_OFFER.md`);
  const license = await readText(`${packageRoot}/LICENSE`);

  assertEqual(packageJson.name, `@xfoil/${target}`, `${target} package name`);
  assertEqual(packageJson.version, wrapperVersion, `${target} package version`);
  assertEqual(packageJson.license, "GPL-2.0-or-later", `${target} package license`);
  assertDeepEqual(packageJson.os, [config.os], `${target} package os`);
  assertDeepEqual(packageJson.cpu, [config.cpu], `${target} package cpu`);
  assertEqual(
    packageJson.scripts?.prepublishOnly,
    `node ../../../scripts/verify-binary-packages.mjs --target ${target}`,
    `${target} prepublishOnly guard`,
  );

  for (const file of [config.executable, "LICENSE", "SOURCE_OFFER.md", "VERSION", "README.md"]) {
    assertIncludes(packageJson.files, file, `${target} package files`);
  }

  if (packageJson.xfoilVersion === XFOIL_VERSION) {
    assertEqual(version, XFOIL_VERSION, `${target} VERSION`);
    assertIncludes(license, "GNU GENERAL PUBLIC LICENSE", `${target} LICENSE`);
    assertIncludes(sourceOffer, `XFOIL ${XFOIL_VERSION}`, `${target} SOURCE_OFFER`);
    assertIncludes(sourceOffer, DEFAULT_XFOIL_SOURCE_SHA256, `${target} SOURCE_OFFER checksum`);
    await assertReadable(`${packageRoot}/${config.executable}`);
  } else {
    assertEqual(packageJson.xfoilVersion, "pending", `${target} placeholder xfoilVersion`);
    assertEqual(version, "pending", `${target} placeholder VERSION`);
    assertIncludes(
      sourceOffer,
      "does not contain a compiled XFOIL executable yet",
      `${target} SOURCE_OFFER`,
    );
  }
}

async function verifyRequiredFiles(files) {
  for (const file of files) await assertReadable(file);
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function readText(path) {
  return readFile(join(ROOT, path), "utf8").catch((error) => {
    throw new Error(`Could not read ${path}: ${error.message}`);
  });
}

async function assertReadable(path) {
  await access(join(ROOT, path)).catch((error) => {
    throw new Error(`Missing required file ${path}: ${error.message}`);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value?.includes?.(expected)) {
    throw new Error(`${label} does not include ${JSON.stringify(expected)}`);
  }
}
