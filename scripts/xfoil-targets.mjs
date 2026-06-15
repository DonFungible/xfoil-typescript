export const WRAPPER_PACKAGE = "xfoil";
export const XFOIL_VERSION = "6.99";
export const DEFAULT_XFOIL_SOURCE_SHA256 =
  "5c0250643f52ce0e75d7338ae2504ce7907f2d49a30f921826717b8ac12ebe40";

export const TARGETS = Object.freeze({
  "darwin-arm64": { cpu: "arm64", executable: "xfoil", os: "darwin", runner: "macos-14" },
  "darwin-x64": { cpu: "x64", executable: "xfoil", os: "darwin", runner: "macos-13" },
  "linux-arm64": { cpu: "arm64", executable: "xfoil", os: "linux", runner: "ubuntu-24.04-arm" },
  "linux-x64": { cpu: "x64", executable: "xfoil", os: "linux", runner: "ubuntu-latest" },
  "win32-x64": {
    cpu: "x64",
    executable: "xfoil.exe",
    os: "win32",
    runner: "windows-latest",
  },
});

export const TARGET_NAMES = Object.freeze(Object.keys(TARGETS).sort());
export const BINARY_PACKAGE_NAMES = Object.freeze(TARGET_NAMES.map((target) => `@xfoil/${target}`));
export const PACKAGE_NAMES = Object.freeze([WRAPPER_PACKAGE, ...BINARY_PACKAGE_NAMES]);
