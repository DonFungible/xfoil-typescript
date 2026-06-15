#!/usr/bin/env node

import assert from "node:assert/strict";
import { assertExecutableTarget, inspectExecutable } from "./inspect-executable.mjs";

const TARGETS = {
  "darwin-arm64": { cpu: "arm64", os: "darwin" },
  "darwin-x64": { cpu: "x64", os: "darwin" },
  "linux-arm64": { cpu: "arm64", os: "linux" },
  "linux-x64": { cpu: "x64", os: "linux" },
  "win32-x64": { cpu: "x64", os: "win32" },
};

assert.deepEqual(inspectExecutable(machO(0x0100000c)), {
  cpu: "arm64",
  format: "mach-o",
  os: "darwin",
});
assert.deepEqual(inspectExecutable(machO(0x01000007)), {
  cpu: "x64",
  format: "mach-o",
  os: "darwin",
});
assert.deepEqual(inspectExecutable(elf(183)), { cpu: "arm64", format: "elf", os: "linux" });
assert.deepEqual(inspectExecutable(elf(62)), { cpu: "x64", format: "elf", os: "linux" });
assert.deepEqual(inspectExecutable(pe(0x8664)), { cpu: "x64", format: "pe", os: "win32" });

assert.doesNotThrow(() =>
  assertExecutableTarget(machO(0x0100000c), "darwin-arm64", TARGETS["darwin-arm64"]),
);
assert.throws(
  () => assertExecutableTarget(machO(0x0100000c), "darwin-x64", TARGETS["darwin-x64"]),
  /expected darwin-x64, got darwin-arm64/,
);

console.log("Executable inspector verified.");

function machO(cpuType) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpuType, 4);
  return buffer;
}

function elf(machine) {
  const buffer = Buffer.alloc(20);
  buffer[0] = 0x7f;
  buffer[1] = 0x45;
  buffer[2] = 0x4c;
  buffer[3] = 0x46;
  buffer[5] = 1;
  buffer.writeUInt16LE(machine, 18);
  return buffer;
}

function pe(machine) {
  const buffer = Buffer.alloc(0x80);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.write("PE\0\0", 0x40, "binary");
  buffer.writeUInt16LE(machine, 0x44);
  return buffer;
}
