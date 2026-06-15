import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const roots = [
  "packages/xfoil/src/geometry",
  "packages/xfoil/src/parsers",
  "packages/xfoil/src/shared",
];
const files = ["packages/xfoil/src/types.ts", "packages/xfoil/src/errors.ts"];

const forbidden =
  /\b(?:from|import)\s*(?:\(?\s*)?["'](?:node:|child_process|fs|os|path|module|process)(?:["'/:])/;
const offenders = [];

async function collectTypescriptFiles(dir) {
  const entries = await readdir(join(cwd(), dir), { withFileTypes: true });
  for (const entry of entries) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectTypescriptFiles(relative);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relative);
    }
  }
}

for (const root of roots) await collectTypescriptFiles(root);

for (const file of files) {
  const text = await readFile(join(cwd(), file), "utf8");
  if (forbidden.test(text)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error("Browser-safe entrypoints import Node-only modules:");
  for (const file of offenders) console.error(`- ${file}`);
  exit(1);
}

console.log("Purity guard passed.");
