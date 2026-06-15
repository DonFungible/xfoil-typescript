import { XFoilParseError } from "../errors.js";
import type { Polar, PolarPoint } from "../types.js";
import { parseFortranNumbers } from "./numeric.js";

export function parsePolar(text: string): Polar {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const name = extractName(lines);
  const { mach, reynolds, ncrit } = extractFlowMetadata(lines);
  const headerIndex = lines.findIndex((line) => /\balpha\b/i.test(line) && /\bCL\b/.test(line));

  if (headerIndex < 0) {
    throw new XFoilParseError("Could not find the polar data header.", {
      snippet: text.slice(0, 400),
    });
  }

  const points: PolarPoint[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^\s*-+\s+/.test(line) || line.trim().length === 0) continue;
    const values = parseFortranNumbers(line);
    if (values.length < 7) {
      if (points.length > 0) break;
      continue;
    }

    points.push({
      alpha: values[0] ?? Number.NaN,
      cl: values[1] ?? Number.NaN,
      cd: values[2] ?? Number.NaN,
      cdp: values[3] ?? Number.NaN,
      cm: values[4] ?? Number.NaN,
      topXtr: values[5] ?? Number.NaN,
      botXtr: values[6] ?? Number.NaN,
    });
  }

  return {
    airfoilName: name,
    failed: [],
    mach,
    ncrit,
    points,
    requested: points.map((point) => point.alpha),
    reynolds,
  };
}

function extractName(lines: string[]): string {
  const line = lines.find((entry) => /Calculated polar for:/i.test(entry));
  const name = line?.split(/Calculated polar for:/i)[1]?.trim();
  return name && name.length > 0 ? name : "Airfoil";
}

function extractFlowMetadata(lines: string[]): { mach: number; reynolds: number; ncrit: number } {
  const line = lines.find(
    (entry) => /Mach\s*=/.test(entry) || /Re\s*=/.test(entry) || /Ncrit\s*=/.test(entry),
  );
  if (!line) return { mach: 0, ncrit: Number.NaN, reynolds: Number.NaN };

  const values = parseFortranNumbers(line);
  return {
    mach: values[0] ?? 0,
    reynolds: values[1] ?? Number.NaN,
    ncrit: values[2] ?? Number.NaN,
  };
}
