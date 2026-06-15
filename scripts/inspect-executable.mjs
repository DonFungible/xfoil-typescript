const CPU_BY_MACHO_TYPE = new Map([
  [0x01000007, "x64"],
  [0x0100000c, "arm64"],
]);

const CPU_BY_ELF_MACHINE = new Map([
  [62, "x64"],
  [183, "arm64"],
]);

const CPU_BY_PE_MACHINE = new Map([
  [0x8664, "x64"],
  [0xaa64, "arm64"],
]);

export function inspectExecutable(buffer) {
  if (buffer.length < 4) throw new Error("Executable is too small to identify");

  if (isMachO(buffer)) return inspectMachO(buffer);
  if (isElf(buffer)) return inspectElf(buffer);
  if (isPe(buffer)) return inspectPe(buffer);

  throw new Error("Unsupported executable format");
}

export function assertExecutableTarget(buffer, target, config) {
  const actual = inspectExecutable(buffer);
  const expected = { cpu: config.cpu, os: config.os };
  if (actual.os !== expected.os || actual.cpu !== expected.cpu) {
    throw new Error(
      `${target} executable target mismatch: expected ${expected.os}-${expected.cpu}, got ${actual.os}-${actual.cpu}`,
    );
  }
}

function isMachO(buffer) {
  const magic = buffer.readUInt32BE(0);
  return (
    magic === 0xcafebabe ||
    magic === 0xcafebabf ||
    buffer.readUInt32LE(0) === 0xfeedface ||
    buffer.readUInt32LE(0) === 0xfeedfacf ||
    buffer.readUInt32BE(0) === 0xfeedface ||
    buffer.readUInt32BE(0) === 0xfeedfacf
  );
}

function inspectMachO(buffer) {
  const magic = buffer.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    if (buffer.length < 8) throw new Error("Mach-O fat header is truncated");
    const archCount = buffer.readUInt32BE(4);
    const headerSize = magic === 0xcafebabf ? 32 : 20;
    const cpus = new Set();
    for (let index = 0; index < archCount; index += 1) {
      const offset = 8 + index * headerSize;
      if (buffer.length < offset + 4) throw new Error("Mach-O fat arch header is truncated");
      const cpu = CPU_BY_MACHO_TYPE.get(buffer.readUInt32BE(offset));
      if (cpu) cpus.add(cpu);
    }
    if (cpus.size === 1) return { cpu: [...cpus][0], format: "mach-o", os: "darwin" };
    if (cpus.size > 1)
      throw new Error(`Mach-O universal binary contains multiple CPUs: ${[...cpus].join(", ")}`);
    throw new Error("Mach-O CPU type is unsupported");
  }

  const littleEndian =
    buffer.readUInt32LE(0) === 0xfeedface || buffer.readUInt32LE(0) === 0xfeedfacf;
  if (buffer.length < 8) throw new Error("Mach-O header is truncated");
  const cpuType = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  const cpu = CPU_BY_MACHO_TYPE.get(cpuType);
  if (!cpu) throw new Error(`Mach-O CPU type ${cpuType} is unsupported`);
  return { cpu, format: "mach-o", os: "darwin" };
}

function isElf(buffer) {
  return buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;
}

function inspectElf(buffer) {
  if (buffer.length < 20) throw new Error("ELF header is truncated");
  const dataEncoding = buffer[5];
  const machine =
    dataEncoding === 1
      ? buffer.readUInt16LE(18)
      : dataEncoding === 2
        ? buffer.readUInt16BE(18)
        : undefined;
  if (machine === undefined) throw new Error(`ELF data encoding ${dataEncoding} is unsupported`);
  const cpu = CPU_BY_ELF_MACHINE.get(machine);
  if (!cpu) throw new Error(`ELF machine ${machine} is unsupported`);
  return { cpu, format: "elf", os: "linux" };
}

function isPe(buffer) {
  if (buffer.length < 0x40) return false;
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return false;
  const headerOffset = buffer.readUInt32LE(0x3c);
  return (
    buffer.length >= headerOffset + 6 &&
    buffer.subarray(headerOffset, headerOffset + 4).equals(Buffer.from("PE\0\0"))
  );
}

function inspectPe(buffer) {
  const headerOffset = buffer.readUInt32LE(0x3c);
  const machine = buffer.readUInt16LE(headerOffset + 4);
  const cpu = CPU_BY_PE_MACHINE.get(machine);
  if (!cpu) throw new Error(`PE machine ${machine} is unsupported`);
  return { cpu, format: "pe", os: "win32" };
}
