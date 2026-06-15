#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET_NAMES, TARGETS } from "./xfoil-targets.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MATRIX_TARGET_EXPRESSION = "$" + "{{ matrix.target }}";
const GITHUB_REPOSITORY_SHELL_EXPRESSION = "$" + "{GITHUB_REPOSITORY}";
const EXPECTED_ACTION_REFS = new Set([
  "actions/checkout@v5",
  "actions/configure-pages@v6",
  "actions/deploy-pages@v5",
  "actions/download-artifact@v5",
  "actions/setup-node@v5",
  "actions/setup-node@v6",
  "actions/upload-artifact@v5",
  "actions/upload-pages-artifact@v5",
  "changesets/action@v1",
  "msys2/setup-msys2@v2",
  "pnpm/action-setup@v4",
]);
const errors = [];

await verify().catch((error) => {
  errors.push(error instanceof Error ? error.message : String(error));
});

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Workflow configuration verified.");

async function verify() {
  const buildBinaries = await readText(".github/workflows/build-binaries.yml");
  const release = await readText(".github/workflows/release.yml");
  const ci = await readText(".github/workflows/ci.yml");
  const docs = await readText(".github/workflows/docs.yml");

  verifyTargetMatrix(buildBinaries, "build-binaries.yml", 1);
  verifyTargetMatrix(release, "release.yml", 2);
  verifyBuildWorkflow(buildBinaries, "build-binaries.yml");
  verifyBuildWorkflow(release, "release.yml");
  verifyReleaseWorkflow(release);
  verifyCiWorkflow(ci);
  verifyDocsWorkflow(docs);
  verifyActionRefs(buildBinaries, "build-binaries.yml");
  verifyActionRefs(release, "release.yml");
  verifyActionRefs(ci, "ci.yml");
  verifyActionRefs(docs, "docs.yml");
}

function verifyTargetMatrix(text, label, expectedOccurrences) {
  const targets = extractTargets(text);
  assertDeepEqual([...new Set(targets)].sort(), TARGET_NAMES, `${label} matrix target set`);

  for (const target of TARGET_NAMES) {
    const count = targets.filter((item) => item === target).length;
    assertEqual(count, expectedOccurrences, `${label} ${target} matrix occurrences`);
  }

  for (const { runner, target } of extractTargetRunners(text)) {
    assertEqual(runner, TARGETS[target]?.runner, `${label} ${target} runner`);
  }
}

function verifyBuildWorkflow(text, label) {
  assertIncludes(text, "node scripts/build-xfoil-binary.mjs --target", `${label} build step`);
  assertIncludes(text, "if: runner.os != 'Windows'", `${label} non-Windows build condition`);
  assertIncludes(text, "shell: bash", `${label} non-Windows shell`);
  assertIncludes(text, "if: runner.os == 'Windows'", `${label} Windows build condition`);
  assertIncludes(text, "shell: msys2 {0}", `${label} Windows shell`);
  assertIncludes(text, "MAKE: mingw32-make", `${label} Windows make`);
  assertIncludes(
    text,
    "node scripts/verify-binary-packages.mjs --target",
    `${label} verify binary step`,
  );
  assertIncludes(text, "pnpm install --frozen-lockfile", `${label} install step`);
  assertIncludes(text, "pnpm --filter xfoil build", `${label} wrapper build step`);
  assertIncludes(text, "pnpm --filter xfoil test:integration", `${label} integration step`);
  assertIncludes(text, "pnpm smoke:packed-install -- --target", `${label} packed smoke step`);
  assertIncludes(text, `name: xfoil-${MATRIX_TARGET_EXPRESSION}`, `${label} upload artifact name`);
  assertIncludes(
    text,
    `path: packages/binaries/${MATRIX_TARGET_EXPRESSION}`,
    `${label} upload artifact path`,
  );
}

function verifyReleaseWorkflow(text) {
  for (const target of TARGET_NAMES) {
    assertIncludes(text, `name: xfoil-${target}`, `release download artifact ${target}`);
    assertIncludes(text, `path: packages/binaries/${target}`, `release download path ${target}`);
  }
  assertIncludes(text, "pnpm verify:binary-packages", "release verifies all binary packages");
  assertIncludes(text, "pnpm check", "release runs package check");
  assertIncludes(text, "pnpm changeset publish --provenance", "release uses provenance publish");
  assertIncludes(
    text,
    "node scripts/smoke-published-install.mjs --target",
    "release post-publish smoke",
  );
}

function verifyCiWorkflow(text) {
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "pnpm build",
    "pnpm package:check",
    "pnpm verify:release-metadata",
    "pnpm verify:workflows",
  ]) {
    assertIncludes(text, command, `ci command ${command}`);
  }
}

function verifyDocsWorkflow(text) {
  assertIncludes(text, "pnpm docs:api", "docs API build");
  assertIncludes(
    text,
    `gh api "repos/${GITHUB_REPOSITORY_SHELL_EXPRESSION}/pages"`,
    "docs checks Pages",
  );
  assertIncludes(text, "actions/upload-artifact@v5", "docs fallback artifact upload");
  assertIncludes(text, "actions/upload-pages-artifact@v5", "docs artifact upload");
  assertIncludes(text, "actions/deploy-pages@v5", "docs deploy");
  assertIncludes(text, "if: needs.build.outputs.pages_enabled == 'true'", "docs deploy gate");
}

function verifyActionRefs(text, label) {
  for (const actionRef of extractActionRefs(text)) {
    if (!EXPECTED_ACTION_REFS.has(actionRef)) {
      throw new Error(`${label} uses unexpected action ref ${JSON.stringify(actionRef)}`);
    }
  }
}

function extractTargets(text) {
  return [...text.matchAll(/^\s*-\s+target:\s+([A-Za-z0-9-]+)\s*$/gm)].map((match) => match[1]);
}

function extractTargetRunners(text) {
  return [
    ...text.matchAll(/^\s*-\s+target:\s+([A-Za-z0-9-]+)\s*\n\s+runner:\s+([A-Za-z0-9.-]+)\s*$/gm),
  ].map((match) => ({ runner: match[2], target: match[1] }));
}

function extractActionRefs(text) {
  return [...text.matchAll(/^\s*(?:-\s*)?uses:\s+([^#\s]+)\s*$/gm)].map((match) => match[1]);
}

async function readText(path) {
  return readFile(join(ROOT, path), "utf8").catch((error) => {
    throw new Error(`Could not read ${path}: ${error.message}`);
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
  if (!value.includes(expected)) {
    throw new Error(`${label} does not include ${JSON.stringify(expected)}`);
  }
}
