import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stderr: { write: (chunk: string) => (stderr += chunk) },
      stdout: { write: (chunk: string) => (stdout += chunk) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

describe("CLI", () => {
  it("prints help", async () => {
    const output = capture();

    await expect(runCli(["--help"], output.streams)).resolves.toBe(0);
    expect(output.stdout()).toContain("Usage: xfoil <command>");
    expect(output.stderr()).toBe("");
  });

  it("rejects unknown commands", async () => {
    const output = capture();

    await expect(runCli(["wat"], output.streams)).resolves.toBe(1);
    expect(output.stderr()).toContain("Unknown command: wat");
  });
});
