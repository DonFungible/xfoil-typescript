import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeNativeBackend } from "../src/backend/node-native.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("NodeNativeBackend", () => {
  it("times out and kills a stalled process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xfoil-backend-test-"));
    tempDirs.push(dir);
    const hookPath = join(dir, "stalled-xfoil.cjs");
    await writeFile(
      hookPath,
      [
        "process.on('uncaughtException', () => {});",
        "process.stdin.resume();",
        "process.stdout.write('XFOIL Version 6.99\\n');",
        "setTimeout(() => {}, 10_000);",
      ].join("\n"),
      "utf8",
    );

    const backend = new NodeNativeBackend({
      binaryPath: process.execPath,
      env: { NODE_OPTIONS: `--require=${hookPath}` },
    });
    const result = await backend.run({ outputFiles: [], script: ["QUIT"], timeoutMs: 50 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
