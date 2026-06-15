import { XFoilParseError } from "../errors.js";
import type { BoundaryLayer } from "../types.js";
import { parseFortranNumbers } from "./numeric.js";

export function parseDump(text: string): BoundaryLayer {
  const rows = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (line.trim().length === 0 || line.trimStart().startsWith("#")) return [];
      const values = parseFortranNumbers(line);
      return values.length >= 8 ? [values] : [];
    });

  if (rows.length === 0) {
    throw new XFoilParseError("Boundary-layer dump did not contain any numeric rows.", {
      snippet: text.slice(0, 400),
    });
  }

  return {
    cf: rows.map((row) => row[6] ?? Number.NaN),
    dstar: rows.map((row) => row[4] ?? Number.NaN),
    h: rows.map((row) => row[7] ?? Number.NaN),
    s: rows.map((row) => row[0] ?? Number.NaN),
    theta: rows.map((row) => row[5] ?? Number.NaN),
    ue: rows.map((row) => row[3] ?? Number.NaN),
    x: rows.map((row) => row[1] ?? Number.NaN),
    y: rows.map((row) => row[2] ?? Number.NaN),
  };
}
