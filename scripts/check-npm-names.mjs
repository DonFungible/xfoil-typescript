#!/usr/bin/env node

import { spawn } from "node:child_process";
import { PACKAGE_NAMES } from "./xfoil-targets.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/check-npm-names.mjs

Checks whether the xfoil wrapper and @xfoil platform package names are absent
from the public npm registry. Exits non-zero if any package is already
published or the registry result is inconclusive.
`);
  process.exit(0);
}

const results = [];

for (const name of PACKAGE_NAMES) {
  results.push(await checkPackage(name));
}

console.log(JSON.stringify(results, null, 2));

const unavailable = results.filter((result) => result.available !== true);
if (unavailable.length > 0) process.exit(1);

async function checkPackage(name) {
  const result = await run("npm", ["view", name, "name", "version", "--json"]);
  if (result.code === 0) {
    return {
      available: false,
      name,
      reason: "published",
      registry: parseJson(result.stdout),
    };
  }
  if (result.stderr.includes("E404") || result.stdout.includes('"code": "E404"')) {
    return {
      available: true,
      name,
      reason: "not-found",
    };
  }
  return {
    available: undefined,
    name,
    reason: "unknown",
    stderr: result.stderr.trim(),
    stdout: result.stdout.trim(),
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

async function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => resolve({ code: 1, stderr: error.message, stdout }));
    child.once("close", (code) => resolve({ code, stderr, stdout }));
  });
}
