import { parseCoordinatesText } from "../shared/coordinates.js";
import type { Point } from "../types.js";

export function parseCoordinates(text: string): { name: string; points: Point[] } {
  return parseCoordinatesText(text);
}
