import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { XFoil } from "../src/index.js";
import { parseFortranNumbers } from "../src/parsers/index.js";

const binaryPath = process.env.XFOIL_BINARY_PATH;
const describeWithBinary = binaryPath ? describe : describe.skip;

describeWithBinary("XFOIL binary integration", () => {
  it("runs a headless viscous NACA 0012 polar", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    await expect(xfoil.version()).resolves.toBe("6.99");

    const polar = await xfoil.polar({
      airfoil: { naca: "0012" },
      alpha: { end: 2, start: 0, step: 1 },
      iterations: 50,
      reynolds: 1_000_000,
    });

    expect(polar.failed).toEqual([]);
    expect(polar.points).toHaveLength(3);
    expect(polar.points[0]).toMatchObject({ alpha: 0, cl: 0 });
    expect(polar.points[2]?.alpha).toBe(2);
    expect(polar.points[2]?.cl).toBeCloseTo(0.2142, 4);
    expect(polar.points[2]?.cd).toBeCloseTo(0.0058, 5);
    expect(polar.points[2]?.topXtr).toBeCloseTo(0.4742, 4);
    expect(polar.points[2]?.botXtr).toBeCloseTo(0.8676, 4);
  });

  it("captures Cp and boundary-layer files", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const result = await xfoil.analyze({
      airfoil: { naca: "0012" },
      alpha: 2,
      boundaryLayer: true,
      cp: true,
      iterations: 50,
      reynolds: 1_000_000,
    });

    expect(result.converged).toBe(true);
    expect(result.cl).toBeCloseTo(0.2142, 4);
    expect(result.cp?.points.length).toBeGreaterThan(100);
    expect(result.boundaryLayer?.s.length).toBeGreaterThan(100);
  });

  it("parses inviscid polar files", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const polar = await xfoil.polar({
      airfoil: { naca: "0012" },
      alpha: { end: 2, start: 0, step: 1 },
      iterations: 50,
    });

    expect(polar.failed).toEqual([]);
    expect(polar.reynolds).toBe(0);
    expect(polar.points).toHaveLength(3);
    expect(polar.points[2]?.cl).toBeCloseTo(0.2416, 4);
    expect(polar.points[2]?.cd).toBe(0);
    expect(polar.points[2]?.topXtr).toBe(0);
    expect(polar.points[2]?.botXtr).toBe(0);
  });

  it("emits the pinned CPWR and DUMP data shapes", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const viscous = await xfoil.raw(
      [
        "PLOP",
        "G F",
        "",
        "NACA 0012",
        "OPER",
        "VISC 1e6",
        "ITER 50",
        "PACC",
        "polar.txt",
        "",
        "ALFA 2",
        "CPWR cp.txt",
        "DUMP bl.txt",
        "PACC",
        "",
        "QUIT",
      ],
      { outputFiles: ["cp.txt", "bl.txt"] },
    );
    const inviscid = await xfoil.raw(
      ["PLOP", "G F", "", "NACA 0012", "OPER", "ITER 50", "ALFA 2", "CPWR cp.txt", "QUIT"],
      { outputFiles: ["cp.txt"] },
    );

    const cpRows = dataRows(viscous.files["cp.txt"] ?? "");
    const inviscidCpRows = dataRows(inviscid.files["cp.txt"] ?? "");
    const dumpRows = dataRows(viscous.files["bl.txt"] ?? "");

    expect(cpRows.length).toBeGreaterThan(100);
    expect(inviscidCpRows.length).toBeGreaterThan(100);
    expect(dumpRows.length).toBeGreaterThan(100);
    expect(new Set(cpRows.map((row) => row.length))).toEqual(new Set([2]));
    expect(new Set(inviscidCpRows.map((row) => row.length))).toEqual(new Set([2]));
    expect(new Set(dumpRows.map((row) => row.length))).toEqual(new Set([8, 12]));
  });

  it("honors explicit paneling and alpha ramping", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const result = await xfoil.analyze({
      airfoil: { naca: "0012" },
      alpha: 3,
      iterations: 200,
      ramp: { step: 1 },
      repanel: { panels: 180 },
      reynolds: 1_000_000,
    });

    expect(result.converged).toBe(true);
    expect(result.alpha).toBe(3);
    expect(result.cl).toBeCloseTo(0.3199, 4);
    expect(result.cd).toBeCloseTo(0.0064, 5);
  });

  it("applies forced transition and flap geometry", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const tripped = await xfoil.analyze({
      airfoil: { naca: "0012" },
      alpha: 2,
      iterations: 100,
      reynolds: 1_000_000,
      xtr: { bottom: 0.6, top: 0.4 },
    });
    const flapped = await xfoil.analyze({
      airfoil: { naca: "0012" },
      alpha: 0,
      flap: { angle: 5, x: 0.75, y: 0 },
      iterations: 100,
      reynolds: 1_000_000,
    });

    expect(tripped.converged).toBe(true);
    expect(tripped.topXtr).toBeCloseTo(0.4, 4);
    expect(tripped.botXtr).toBeCloseTo(0.6, 4);
    expect(flapped.converged).toBe(true);
    expect(flapped.cl).toBeCloseTo(0.3471, 4);
    expect(flapped.cm).toBeCloseTo(-0.0569, 4);
  });

  it("solves single-point and sequence lift-coefficient requests", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const point = await xfoil.analyze({
      airfoil: { naca: "0012" },
      cl: 0.2,
      iterations: 100,
      reynolds: 1_000_000,
    });
    const polar = await xfoil.polar({
      airfoil: { naca: "0012" },
      cl: { end: 0.2, start: 0, step: 0.1 },
      iterations: 100,
      reynolds: 1_000_000,
    });

    expect(point.converged).toBe(true);
    expect(point.cl).toBeCloseTo(0.2, 4);
    expect(point.alpha).toBeCloseTo(1.867, 3);
    expect(polar.failed).toEqual([]);
    expect(polar.points.map((item) => item.cl)).toEqual([0, 0.1, 0.2]);
  });

  it("reports unreachable lift and alpha sequence points without throwing", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const lift = await xfoil.polar({
      airfoil: { naca: "0012" },
      cl: { end: 2, start: 0, step: 1 },
      iterations: 50,
      reynolds: 1_000_000,
    });
    const alpha = await xfoil.polar({
      airfoil: { naca: "0012" },
      alpha: { end: 30, start: 0, step: 10 },
      iterations: 20,
      reynolds: 1_000_000,
    });

    expect(lift.requested).toEqual([0, 1, 2]);
    expect(lift.failed).toEqual([2]);
    expect(lift.points.map((point) => point.cl)).toEqual([0, 1]);
    expect(alpha.requested).toEqual([0, 10, 20, 30]);
    expect(alpha.failed).toEqual([10, 20, 30]);
    expect(alpha.points.map((point) => point.alpha)).toEqual([0]);
  });

  it("isolates concurrent solver runs", async () => {
    const xfoil = new XFoil({ binaryPath, timeoutMs: 15_000 });

    const results = await Promise.all(
      [0, 1, 2].map((alpha) =>
        xfoil.analyze({
          airfoil: { naca: "0012" },
          alpha,
          iterations: 50,
          reynolds: 1_000_000,
        }),
      ),
    );

    expect(results.map((result) => result.alpha)).toEqual([0, 1, 2]);
    expect(results.every((result) => result.converged)).toBe(true);
    expect(results[0]?.cl).toBeCloseTo(0, 4);
    expect(results[1]?.cl).toBeCloseTo(0.107, 3);
    expect(results[2]?.cl).toBeCloseTo(0.2142, 4);
  });

  it("reports doctor diagnostics as JSON", async () => {
    let stdout = "";
    let stderr = "";

    const code = await runCli(["doctor", "--json"], {
      stderr: { write: (chunk: string) => (stderr += chunk) },
      stdout: { write: (chunk: string) => (stdout += chunk) },
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      ok: boolean;
      version: string;
      smoke: { points: number; failed: number[] };
    };
    expect(result.ok).toBe(true);
    expect(result.version).toBe("6.99");
    expect(result.smoke.points).toBe(3);
    expect(result.smoke.failed).toEqual([]);
  });
});

function dataRows(text: string): number[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (line.trim().length === 0 || line.trimStart().startsWith("#")) return [];
      const values = parseFortranNumbers(line);
      return values.length > 0 ? [values] : [];
    });
}
