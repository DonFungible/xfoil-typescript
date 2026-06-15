import { XFoilInputError } from "../errors.js";
import type { Point } from "../types.js";

interface CamberPoint {
  yc: number;
  dyc: number;
}

const FIVE_DIGIT_NON_REFLEX: Record<string, { m: number; k1: number }> = {
  "210": { k1: 361.4, m: 0.058 },
  "220": { k1: 51.64, m: 0.126 },
  "230": { k1: 15.957, m: 0.2025 },
  "240": { k1: 6.643, m: 0.29 },
  "250": { k1: 3.23, m: 0.391 },
};

export function naca(designation: string, opts: { panels?: number } = {}): Point[] {
  const digits = designation.trim();
  if (!/^\d{4}$|^\d{5}$/.test(digits)) {
    throw new XFoilInputError("NACA designation must be 4 or 5 digits.");
  }

  const panels = normalizePanelCount(opts.panels ?? 160);
  return digits.length === 4 ? naca4(digits, panels) : naca5(digits, panels);
}

function naca4(digits: string, panels: number): Point[] {
  const m = Number.parseInt(digits[0] ?? "0", 10) / 100;
  const p = Number.parseInt(digits[1] ?? "0", 10) / 10;
  const t = Number.parseInt(digits.slice(2), 10) / 100;
  return coordinatesFromCamber(panels, t, (x) => fourDigitCamber(x, m, p));
}

function naca5(digits: string, panels: number): Point[] {
  const prefix = digits.slice(0, 3);
  const table = FIVE_DIGIT_NON_REFLEX[prefix];
  if (!table) {
    throw new XFoilInputError(
      `Unsupported NACA 5-digit mean-line '${prefix}'. Supported non-reflex prefixes: ${Object.keys(FIVE_DIGIT_NON_REFLEX).join(", ")}.`,
    );
  }

  const t = Number.parseInt(digits.slice(3), 10) / 100;
  return coordinatesFromCamber(panels, t, (x) => fiveDigitCamber(x, table.m, table.k1));
}

function coordinatesFromCamber(
  panels: number,
  thickness: number,
  camber: (x: number) => CamberPoint,
): Point[] {
  const halfPanels = Math.floor(panels / 2);
  const xs = cosinePoints(halfPanels);
  const upper: Point[] = [];
  const lower: Point[] = [];

  for (const x of xs) {
    const { yc, dyc } = camber(x);
    const yt = thicknessDistribution(x, thickness);
    const theta = Math.atan(dyc);
    upper.push({ x: x - yt * Math.sin(theta), y: yc + yt * Math.cos(theta) });
    lower.push({ x: x + yt * Math.sin(theta), y: yc - yt * Math.cos(theta) });
  }

  return upper.reverse().concat(lower.slice(1));
}

function fourDigitCamber(x: number, m: number, p: number): CamberPoint {
  if (m === 0 || p === 0) return { dyc: 0, yc: 0 };
  if (x < p) {
    return {
      dyc: (2 * m * (p - x)) / (p * p),
      yc: (m / (p * p)) * (2 * p * x - x * x),
    };
  }

  return {
    dyc: (2 * m * (p - x)) / ((1 - p) * (1 - p)),
    yc: (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x),
  };
}

function fiveDigitCamber(x: number, m: number, k1: number): CamberPoint {
  if (x < m) {
    return {
      dyc: (k1 / 6) * (3 * x * x - 6 * m * x + m * m * (3 - m)),
      yc: (k1 / 6) * (x ** 3 - 3 * m * x * x + m * m * (3 - m) * x),
    };
  }

  return {
    dyc: (-k1 * m ** 3) / 6,
    yc: ((k1 * m ** 3) / 6) * (1 - x),
  };
}

function thicknessDistribution(x: number, t: number): number {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(Math.max(0, x)) -
      0.126 * x -
      0.3516 * x ** 2 +
      0.2843 * x ** 3 -
      0.1036 * x ** 4)
  );
}

export function cosinePoints(segments: number): number[] {
  return Array.from({ length: segments + 1 }, (_unused, index) => {
    const theta = (Math.PI * index) / segments;
    return (1 - Math.cos(theta)) / 2;
  });
}

function normalizePanelCount(panels: number): number {
  if (!Number.isInteger(panels) || panels < 20 || panels > 500) {
    throw new XFoilInputError("Panel count must be an integer between 20 and 500.");
  }

  return panels % 2 === 0 ? panels : panels + 1;
}
