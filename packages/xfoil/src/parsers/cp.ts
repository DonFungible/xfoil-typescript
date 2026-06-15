import { XFoilParseError } from "../errors.js";
import type { CpDistribution } from "../types.js";
import { parseFortranNumbers } from "./numeric.js";

export function parseCp(text: string): CpDistribution {
  const points = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      if (line.trim().length === 0 || line.trimStart().startsWith("#")) return [];
      const values = parseFortranNumbers(line);
      if (values.length < 2) return [];
      return [{ x: values[0] ?? Number.NaN, cp: values[values.length - 1] ?? Number.NaN }];
    });

  if (points.length === 0) {
    throw new XFoilParseError("Cp file did not contain any numeric rows.", {
      snippet: text.slice(0, 400),
    });
  }

  return {
    cp: points.map((point) => point.cp),
    points,
    x: points.map((point) => point.x),
  };
}
