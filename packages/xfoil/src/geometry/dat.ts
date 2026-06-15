import { parseCoordinatesText, serializeCoordinates } from "../shared/coordinates.js";
import type { Point } from "../types.js";

export function parseDat(text: string): { name: string; points: Point[] } {
  return parseCoordinatesText(text);
}

export function toDat(name: string, points: ReadonlyArray<Point>): string {
  return serializeCoordinates(name, points);
}
