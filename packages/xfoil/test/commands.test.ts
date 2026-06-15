import { describe, expect, it } from "vitest";
import { buildAnalyzeScript, buildPolarScript } from "../src/core/commands.js";

describe("command builders", () => {
  it("builds a bounded single-point script with optional files", () => {
    expect(
      buildAnalyzeScript({
        airfoil: { kind: "naca", naca: "2412", repanel: true },
        alpha: 5,
        cpFile: "cp.txt",
        dumpFile: "bl.txt",
        iterations: 200,
        mach: 0.1,
        ncrit: 9,
        polarFile: "polar.txt",
        reynolds: 1_000_000,
      }),
    ).toEqual([
      "PLOP",
      "G F",
      "",
      "NACA 2412",
      "PANE",
      "OPER",
      "VISC 1e6",
      "MACH 0.1",
      "ITER 200",
      "VPAR",
      "N 9",
      "",
      "PACC",
      "polar.txt",
      "",
      "ALFA 5",
      "CPWR cp.txt",
      "DUMP bl.txt",
      "PACC",
      "",
      "QUIT",
    ]);
  });

  it("builds a loaded-coordinate polar with explicit panel count", () => {
    expect(
      buildPolarScript({
        airfoil: { file: "airfoil.dat", kind: "file", name: "Demo", repanel: { panels: 200 } },
        alpha: { end: 4, start: -2, step: 2 },
        iterations: 100,
        polarFile: "polar.txt",
      }),
    ).toEqual([
      "PLOP",
      "G F",
      "",
      "LOAD airfoil.dat",
      "Demo",
      "PPAR",
      "N",
      "200",
      "",
      "",
      "OPER",
      "ITER 100",
      "PACC",
      "polar.txt",
      "",
      "ASEQ -2 4 2",
      "PACC",
      "",
      "QUIT",
    ]);
  });

  it("applies flap geometry before entering OPER", () => {
    expect(
      buildAnalyzeScript({
        airfoil: { kind: "naca", naca: "0012", repanel: false },
        alpha: 0,
        flap: { angle: 5, x: 0.75, y: 0 },
        iterations: 100,
        polarFile: "polar.txt",
      }),
    ).toEqual([
      "PLOP",
      "G F",
      "",
      "NACA 0012",
      "GDES",
      "FLAP",
      "0.75",
      "0",
      "5",
      "EXEC",
      "",
      "OPER",
      "ITER 100",
      "PACC",
      "polar.txt",
      "",
      "ALFA 0",
      "PACC",
      "",
      "QUIT",
    ]);
  });

  it("uses a lift sequence for single-point cl analysis", () => {
    expect(
      buildAnalyzeScript({
        airfoil: { kind: "naca", naca: "0012", repanel: false },
        cl: 0.25,
        iterations: 100,
        polarFile: "polar.txt",
      }),
    ).toEqual([
      "PLOP",
      "G F",
      "",
      "NACA 0012",
      "OPER",
      "ITER 100",
      "PACC",
      "polar.txt",
      "",
      "CSEQ 0 0.25 0.0833333333333",
      "PACC",
      "",
      "QUIT",
    ]);
  });

  it("ramps single-point alpha before opening polar accumulation", () => {
    expect(
      buildAnalyzeScript({
        airfoil: { kind: "naca", naca: "0012", repanel: true },
        alpha: 3,
        iterations: 100,
        polarFile: "polar.txt",
        ramp: { step: 1 },
      }),
    ).toEqual([
      "PLOP",
      "G F",
      "",
      "NACA 0012",
      "PANE",
      "OPER",
      "ITER 100",
      "ALFA 1",
      "ALFA 2",
      "PACC",
      "polar.txt",
      "",
      "ALFA 3",
      "PACC",
      "",
      "QUIT",
    ]);
  });
});
