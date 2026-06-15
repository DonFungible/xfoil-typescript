import { describe, expect, it } from "vitest";
import {
  parseCoordinates,
  parseCp,
  parseDump,
  parseFortranNumbers,
  parsePolar,
} from "../src/parsers/index.js";

const polarText = `

       XFOIL         Version 6.99

 Calculated polar for: NACA 2412

 xtrf =   1.000 (top)        1.000 (bottom)
 Mach =   0.100     Re =     1.000 e 6     Ncrit =   9.000

   alpha    CL        CD       CDp       CM     Top_Xtr  Bot_Xtr
  ------ -------- --------- --------- -------- -------- --------
  -5.000  -0.3120   0.00601   0.00208  -0.0613   0.7755   0.2447
   0.000   0.2520   0.00557   0.00128  -0.0521   0.6094   0.5063
   2.000   *****    0.00600   0.00150  -0.0500   0.5000   0.5000
`;

describe("parsers", () => {
  it("parses Fortran-ish numeric rows", () => {
    expect(parseFortranNumbers("Mach = 0.100 Re = 1.000 e 6 Ncrit = 9.0")).toEqual([
      0.1, 1_000_000, 9,
    ]);
    expect(Object.is(parseFortranNumbers("-0.0000")[0], -0)).toBe(false);
    expect(parseFortranNumbers("-0.0000")[0]).toBe(0);
    expect(Number.isNaN(parseFortranNumbers("*****")[0])).toBe(true);
  });

  it("parses XFOIL polar save files", () => {
    const polar = parsePolar(polarText);
    expect(polar.airfoilName).toBe("NACA 2412");
    expect(polar.reynolds).toBe(1_000_000);
    expect(polar.mach).toBe(0.1);
    expect(polar.ncrit).toBe(9);
    expect(polar.points).toHaveLength(3);
    expect(polar.points[0]).toMatchObject({ alpha: -5, cd: 0.00601, cl: -0.312 });
    expect(Number.isNaN(polar.points[2]?.cl)).toBe(true);
  });

  it("parses Cp files with two or three columns", () => {
    const cp = parseCp(`
# x Cp
 1.00000 0.24517
 0.99619 0.00 0.18213
`);
    expect(cp.x).toEqual([1, 0.99619]);
    expect(cp.cp).toEqual([0.24517, 0.18213]);
  });

  it("parses boundary-layer dumps", () => {
    const dump = parseDump(`
# s x y Ue/Vinf Dstar Theta Cf H
 0.0 1.0 0.001 0.0 0.0 0.0 0.0 0.0
 0.1 0.9 0.010 0.8 0.01 0.02 0.003 1.4
`);
    expect(dump.s).toEqual([0, 0.1]);
    expect(dump.ue[1]).toBe(0.8);
    expect(dump.h[1]).toBe(1.4);
  });

  it("parses Lednicer coordinates into Selig order", () => {
    const parsed = parseCoordinates(`
Example
3 3
0.0 0.0
0.5 0.1
1.0 0.0
0.0 0.0
0.5 -0.1
1.0 0.0
`);
    expect(parsed.name).toBe("Example");
    expect(parsed.points).toEqual([
      { x: 1, y: 0 },
      { x: 0.5, y: 0.1 },
      { x: 0, y: 0 },
      { x: 0.5, y: -0.1 },
      { x: 1, y: 0 },
    ]);
  });
});
