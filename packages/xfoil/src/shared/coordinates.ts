import { XFoilInputError, XFoilParseError } from "../errors.js";
import type { Point } from "../types.js";

const NUMBER = "[+-]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eEdD][+-]?\\d+)?";
const NUMBER_RE = new RegExp(NUMBER, "g");

export interface ParsedCoordinates {
  name: string;
  points: Point[];
}

export function parseCoordinateLine(line: string): Point | undefined {
  const matches = line.replaceAll(",", " ").match(NUMBER_RE);
  if (!matches || matches.length < 2) return undefined;
  const values = matches.map((token) => Number.parseFloat(token.replace(/[dD]/, "e")));
  const x = values[0];
  const y = values[1];
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
    return undefined;
  return { x, y };
}

export function parseCoordinatesText(text: string): ParsedCoordinates {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new XFoilParseError("Coordinate file is empty.");
  }

  const firstPoint = parseCoordinateLine(lines[0] ?? "");
  const name = firstPoint ? "Airfoil" : (lines[0] ?? "Airfoil");
  const dataLines = firstPoint ? lines : lines.slice(1);
  const counts = dataLines[0]?.match(NUMBER_RE)?.map((n) => Number.parseInt(n, 10));

  const upperCount = counts?.[0];
  const lowerCount = counts?.[1];
  if (
    upperCount !== undefined &&
    lowerCount !== undefined &&
    upperCount > 1 &&
    lowerCount > 1 &&
    dataLines.length >= upperCount + lowerCount + 1
  ) {
    return parseLednicer(name, dataLines, upperCount, lowerCount);
  }

  const points = dataLines
    .map(parseCoordinateLine)
    .filter((point): point is Point => Boolean(point));
  assertUsableCoordinates(points);
  return { name, points };
}

export function serializeCoordinates(name: string, points: ReadonlyArray<Point>): string {
  assertUsableCoordinates(points);
  const rows = points.map((point) => `${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`);
  return `${sanitizeAirfoilName(name)}\n${rows.join("\n")}\n`;
}

export function assertUsableCoordinates(points: ReadonlyArray<Point>): void {
  if (points.length < 3) {
    throw new XFoilInputError("Airfoil coordinates must contain at least three points.");
  }

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new XFoilInputError("Airfoil coordinates must be finite numbers.");
    }
  }
}

export function sanitizeAirfoilName(name: string | undefined): string {
  const trimmed = (name ?? "Airfoil").trim();
  if (trimmed.length === 0) return "Airfoil";
  return trimmed.replace(/\s+/g, " ").slice(0, 80);
}

function parseLednicer(
  name: string,
  lines: string[],
  upperCount: number,
  lowerCount: number,
): ParsedCoordinates {
  const coordinateLines = lines.slice(1);
  const upper = coordinateLines
    .slice(0, upperCount)
    .map(parseCoordinateLine)
    .filter((point): point is Point => Boolean(point));
  const lower = coordinateLines
    .slice(upperCount, upperCount + lowerCount)
    .map(parseCoordinateLine)
    .filter((point): point is Point => Boolean(point));

  if (upper.length !== upperCount || lower.length !== lowerCount) {
    throw new XFoilParseError("Lednicer coordinate counts do not match the point data.");
  }

  const points = [...upper].reverse().concat(lower.slice(1));
  assertUsableCoordinates(points);
  return { name, points };
}

function formatCoordinate(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  return value
    .toPrecision(12)
    .replace(/(\.\d*?)0+($|e)/i, "$1$2")
    .replace(/\.($|e)/i, ".0$1");
}
