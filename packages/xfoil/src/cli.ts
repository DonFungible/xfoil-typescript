import { arch, platform } from "node:process";
import { resolveBinary, supportedPlatformPackages } from "./backend/resolve-binary.js";
import { XFoil } from "./core/xfoil.js";
import { XFoilBinaryNotFoundError } from "./errors.js";

interface CliStreams {
  stderr: { write(chunk: string): unknown };
  stdout: { write(chunk: string): unknown };
}

interface DoctorResult {
  ok: boolean;
  platform: string;
  packageName: string | undefined;
  binaryPath?: string | undefined;
  version?: string | undefined;
  searched: string[];
  smoke?: {
    points: number;
    failed: number[];
    clAtTwoDeg: number | undefined;
    cdAtTwoDeg: number | undefined;
  };
  error?: string | undefined;
}

export async function runCli(
  argv = process.argv.slice(2),
  streams: CliStreams = { stderr: process.stderr, stdout: process.stdout },
): Promise<number> {
  const command = argv.find((arg) => !arg.startsWith("-"));
  const json = argv.includes("--json");

  if (argv.includes("--doctor") || command === "doctor") {
    const result = await doctor();
    streams.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : renderDoctor(result));
    return result.ok ? 0 : 1;
  }

  if (argv.includes("--help") || argv.includes("-h") || !command) {
    streams.stdout.write(helpText());
    return 0;
  }

  streams.stderr.write(`Unknown command: ${command}\n\n${helpText()}`);
  return 1;
}

export async function doctor(): Promise<DoctorResult> {
  const platformKey = `${platform}-${arch}`;
  const packageName = supportedPlatformPackages()[platformKey];

  try {
    const resolved = await resolveBinary();
    const xfoil = new XFoil({ binaryPath: resolved.path, timeoutMs: 15_000 });
    const version = await xfoil.version();
    const polar = await xfoil.polar({
      airfoil: { naca: "0012" },
      alpha: { end: 2, start: 0, step: 1 },
      iterations: 50,
      reynolds: 1_000_000,
    });
    const point = polar.points.find((entry) => entry.alpha === 2);

    return {
      binaryPath: resolved.path,
      ok: true,
      packageName,
      platform: platformKey,
      searched: resolved.searched,
      smoke: {
        cdAtTwoDeg: point?.cd,
        clAtTwoDeg: point?.cl,
        failed: polar.failed,
        points: polar.points.length,
      },
      version,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      packageName,
      platform: platformKey,
      searched: error instanceof XFoilBinaryNotFoundError ? error.searched : [],
    };
  }
}

function renderDoctor(result: DoctorResult): string {
  const lines = [
    `xfoil doctor`,
    `Platform: ${result.platform}`,
    `Platform package: ${result.packageName ?? "unsupported"}`,
  ];

  if (result.ok) {
    lines.push(
      `Binary: ${result.binaryPath}`,
      `XFOIL version: ${result.version}`,
      `Smoke: ok (${result.smoke?.points ?? 0} polar points, ${result.smoke?.failed.length ?? 0} failed)`,
    );
    if (result.smoke?.clAtTwoDeg !== undefined && result.smoke.cdAtTwoDeg !== undefined) {
      lines.push(
        `NACA 0012 @ alpha=2 deg: Cl=${result.smoke.clAtTwoDeg}, Cd=${result.smoke.cdAtTwoDeg}`,
      );
    }
  } else {
    lines.push(`Binary: not found or failed`, `Error: ${result.error ?? "unknown"}`);
    if (result.searched.length) {
      lines.push("Searched:");
      for (const searched of result.searched) lines.push(`  - ${searched}`);
    }
    lines.push(
      "Remediation:",
      "  - Install the matching @xfoil/<platform> optional dependency via npm install xfoil.",
      "  - Or set XFOIL_BINARY_PATH to a compatible XFOIL executable.",
      "  - Or pass new XFoil({ binaryPath }) from application code.",
    );
  }

  return `${lines.join("\n")}\n`;
}

function helpText(): string {
  return `Usage: xfoil <command> [options]

Commands:
  doctor, --doctor   Resolve the XFOIL binary and run a headless smoke test

Options:
  --json             Print machine-readable doctor output
  -h, --help         Show this help
`;
}
