import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform, env as processEnv } from "node:process";
import type { Backend, RunRequest, RunResult, XFoilLogEvent } from "../types.js";
import { type ResolveBinaryOptions, resolveBinary } from "./resolve-binary.js";

const OUTPUT_CAP_BYTES = 1024 * 1024;
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

export interface NodeNativeBackendOptions extends ResolveBinaryOptions {
  workDir?: string | undefined;
  logger?: ((event: XFoilLogEvent) => void) | undefined;
}

export class NodeNativeBackend implements Backend {
  readonly #options: NodeNativeBackendOptions;
  #binaryPath?: string;

  constructor(options: NodeNativeBackendOptions = {}) {
    this.#options = options;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const binary = await this.#resolve();
    const baseDir = this.#options.workDir ?? tmpdir();
    await mkdir(baseDir, { recursive: true });
    const cwd = await mkdtemp(join(baseDir, "xfoil-"));
    const startedAt = Date.now();
    let timedOut = false;
    let exitCode: number | null = null;
    let stdout = "";
    let stderr = "";

    try {
      for (const [name, contents] of Object.entries(req.inputFiles ?? {})) {
        assertSafeFilename(name);
        await writeFile(join(cwd, name), contents, "utf8");
      }
      for (const name of req.outputFiles) assertSafeFilename(name);

      this.#options.logger?.({ type: "script", lines: req.script });
      this.#options.logger?.({ type: "spawn", binary, cwd });

      const child = spawn(binary, [], {
        cwd,
        detached: platform !== "win32",
        env: { ...processEnv, ...this.#options.env, ...req.env },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
      }, req.timeoutMs);

      const abort = () => {
        timedOut = true;
        killProcessTree(child.pid);
      };
      req.signal?.addEventListener("abort", abort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = appendCapped(stdout, chunk);
        this.#options.logger?.({ type: "stdout", chunk });
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = appendCapped(stderr, chunk);
        this.#options.logger?.({ type: "stderr", chunk });
      });

      child.stdin.end(`${req.script.join("\n")}\n`);
      exitCode = await waitForClose(child);
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", abort);

      const files: Record<string, string> = {};
      for (const name of req.outputFiles) {
        const file = join(cwd, name);
        if (await exists(file)) files[name] = await readFile(file, "utf8");
      }

      const durationMs = Date.now() - startedAt;
      this.#options.logger?.({ code: exitCode, durationMs, timedOut, type: "exit" });
      return {
        dir: req.keepFiles ? cwd : undefined,
        durationMs,
        exitCode,
        files,
        stderr,
        stdout,
        timedOut,
      };
    } finally {
      if (!req.keepFiles) await rm(cwd, { force: true, recursive: true });
    }
  }

  async version(): Promise<string> {
    const result = await this.run({ outputFiles: [], script: ["QUIT"], timeoutMs: 5_000 });
    const version = result.stdout.match(/Version\s+([0-9.]+)/i)?.[1];
    return version ?? "unknown";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.version();
      return true;
    } catch {
      return false;
    }
  }

  async #resolve(): Promise<string> {
    if (this.#binaryPath) return this.#binaryPath;
    const resolved = await resolveBinary(this.#options);
    this.#binaryPath = resolved.path;
    return resolved.path;
  }
}

async function mkdtemp(prefix: string): Promise<string> {
  const { mkdtemp: createTempDir } = await import("node:fs/promises");
  return createTempDir(prefix);
}

function appendCapped(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= OUTPUT_CAP_BYTES
    ? combined
    : combined.slice(combined.length - OUTPUT_CAP_BYTES);
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertSafeFilename(name: string): void {
  if (!SAFE_FILENAME.test(name) || name === "." || name === "..") {
    throw new Error(`Unsafe XFOIL run filename: ${name}`);
  }
}
