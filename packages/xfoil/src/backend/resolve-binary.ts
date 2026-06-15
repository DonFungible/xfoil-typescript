import { constants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { arch, cwd, env, platform } from "node:process";
import { XFoilBinaryNotFoundError } from "../errors.js";

const require = createRequire(join(cwd(), "package.json"));

export interface ResolveBinaryOptions {
  binaryPath?: string | undefined;
  env?: Record<string, string> | undefined;
  allowPathLookup?: boolean | undefined;
}

export interface ResolveBinaryResult {
  path: string;
  searched: string[];
}

const SUPPORTED_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@xfoil/darwin-arm64",
  "darwin-x64": "@xfoil/darwin-x64",
  "linux-arm64": "@xfoil/linux-arm64",
  "linux-x64": "@xfoil/linux-x64",
  "win32-x64": "@xfoil/win32-x64",
};

export async function resolveBinary(
  options: ResolveBinaryOptions = {},
): Promise<ResolveBinaryResult> {
  const searched: string[] = [];
  const mergedEnv = { ...env, ...options.env };
  const explicit = options.binaryPath ?? mergedEnv.XFOIL_BINARY_PATH;

  if (explicit) {
    searched.push(explicit);
    if (await isExecutableFile(explicit)) return { path: explicit, searched };
  }

  const platformKey = `${platform}-${arch}`;
  const packageName = SUPPORTED_PACKAGES[platformKey];
  const executable = platform === "win32" ? "xfoil.exe" : "xfoil";

  if (packageName) {
    const specifiers = new Set([`${packageName}/${executable}`, `${packageName}/xfoil`]);
    for (const specifier of specifiers) {
      searched.push(specifier);
      try {
        const resolved = require.resolve(specifier);
        if (await isExecutableFile(resolved, { chmodFirst: true })) {
          return { path: resolved, searched };
        }
      } catch {
        // Optional package may not be installed for this platform.
      }
    }

    const packageJsonSpecifier = `${packageName}/package.json`;
    searched.push(packageJsonSpecifier);
    try {
      const packageRoot = dirname(require.resolve(packageJsonSpecifier));
      const resolved = join(packageRoot, executable);
      searched.push(resolved);
      if (await isExecutableFile(resolved, { chmodFirst: true })) {
        return { path: resolved, searched };
      }
    } catch {
      // Optional package may not be installed for this platform.
    }

    for (const candidate of workspaceBinaryCandidates(platformKey, executable)) {
      searched.push(candidate);
      if (await isExecutableFile(candidate, { chmodFirst: true })) {
        return { path: candidate, searched };
      }
    }
  }

  if (options.allowPathLookup) {
    for (const dir of (mergedEnv.PATH ?? "").split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, executable);
      searched.push(candidate);
      if (await isExecutableFile(candidate)) return { path: candidate, searched };
    }
  }

  throw new XFoilBinaryNotFoundError(platformKey, searched);
}

export function supportedPlatformPackages(): Record<string, string> {
  return { ...SUPPORTED_PACKAGES };
}

async function isExecutableFile(
  path: string,
  options: { chmodFirst?: boolean } = {},
): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    if (options.chmodFirst) await chmod(path, 0o755).catch(() => undefined);
    await access(path, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function workspaceBinaryCandidates(platformKey: string, executable: string): string[] {
  const fromRoot = resolve(cwd(), "packages", "binaries", platformKey, executable);
  const fromPackage = resolve(cwd(), "..", "binaries", platformKey, executable);
  const fromNestedPackage = resolve(
    cwd(),
    "..",
    "..",
    "packages",
    "binaries",
    platformKey,
    executable,
  );
  return [...new Set([fromRoot, fromPackage, fromNestedPackage])];
}
