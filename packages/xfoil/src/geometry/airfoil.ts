import { XFoilInputError } from "../errors.js";
import { assertUsableCoordinates, sanitizeAirfoilName } from "../shared/coordinates.js";
import type { Point } from "../types.js";
import { parseDat, toDat } from "./dat.js";
import { cosinePoints, naca } from "./naca.js";

interface SurfacePair {
  upper: Point[];
  lower: Point[];
}

export class Airfoil {
  readonly name: string;
  readonly coordinates: ReadonlyArray<Point>;

  private constructor(points: ReadonlyArray<Point>, name = "Airfoil") {
    assertUsableCoordinates(points);
    this.name = sanitizeAirfoilName(name);
    this.coordinates = Object.freeze(points.map((point) => ({ x: point.x, y: point.y })));
  }

  static fromNACA(designation: string, opts: { panels?: number } = {}): Airfoil {
    return new Airfoil(naca(designation, opts), `NACA ${designation.trim()}`);
  }

  static fromCoordinates(points: Point[], name?: string): Airfoil {
    return new Airfoil(points, name);
  }

  static fromDat(text: string): Airfoil {
    const parsed = parseDat(text);
    return new Airfoil(parsed.points, parsed.name);
  }

  toDat(): string {
    return toDat(this.name, this.coordinates);
  }

  normalize(): Airfoil {
    const bounds = this.bounds();
    const first = this.coordinates[0];
    const last = this.coordinates.at(-1);
    if (!first || !last) {
      throw new XFoilInputError("Cannot normalize an airfoil without coordinates.");
    }
    const le = this.coordinates.reduce((best, point) => (point.x < best.x ? point : best), first);
    const teCandidates = this.coordinates.filter((point) => Math.abs(point.x - bounds.maxX) < 1e-8);
    const te =
      teCandidates.length > 0
        ? averagePoints(teCandidates)
        : {
            x: (first.x + last.x) / 2,
            y: 0,
          };
    const chord = Math.hypot(te.x - le.x, te.y - le.y);
    if (chord <= 0) throw new XFoilInputError("Cannot normalize an airfoil with zero chord.");

    const angle = Math.atan2(te.y - le.y, te.x - le.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const normalized = this.coordinates.map((point) => {
      const dx = point.x - le.x;
      const dy = point.y - le.y;
      return {
        x: (dx * cos - dy * sin) / chord,
        y: (dx * sin + dy * cos) / chord,
      };
    });

    return new Airfoil(normalized, this.name);
  }

  repanel(panels: number): Airfoil {
    if (!Number.isInteger(panels) || panels < 20 || panels > 500) {
      throw new XFoilInputError("Panel count must be an integer between 20 and 500.");
    }

    const normalized = this.normalize();
    const { upper, lower } = splitSurfaces(normalized.coordinates);
    const upperCount = Math.floor(panels / 2) + 1;
    const lowerCount = panels - Math.floor(panels / 2) + 1;
    const upperXs = cosinePoints(upperCount - 1).reverse();
    const lowerXs = cosinePoints(lowerCount - 1);
    const repaneledUpper = upperXs.map((x) => ({ x, y: interpolateSurfaceY(upper, x) }));
    const repaneledLower = lowerXs.slice(1).map((x) => ({ x, y: interpolateSurfaceY(lower, x) }));

    return new Airfoil(repaneledUpper.concat(repaneledLower), this.name);
  }

  bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return this.coordinates.reduce(
      (bounds, point) => ({
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
      }),
      { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity },
    );
  }

  maxThickness(): { value: number; x: number } {
    return maxMetric(this.normalize(), (upper, lower) => upper - lower);
  }

  maxCamber(): { value: number; x: number } {
    return maxMetric(this.normalize(), (upper, lower) => (upper + lower) / 2);
  }
}

function splitSurfaces(points: ReadonlyArray<Point>): SurfacePair {
  if (points.length < 3) {
    throw new XFoilInputError("Airfoil coordinates must contain at least three points.");
  }

  let leIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const best = points[leIndex];
    if (current && best && current.x < best.x) leIndex = index;
  }

  const upper = [...points.slice(0, leIndex + 1)].reverse().sort((a, b) => a.x - b.x);
  const lower = [...points.slice(leIndex)].sort((a, b) => a.x - b.x);

  if (upper.length < 2 || lower.length < 2) {
    throw new XFoilInputError("Airfoil coordinates must contain upper and lower surfaces.");
  }

  return { lower, upper };
}

function interpolateSurfaceY(surface: Point[], x: number): number {
  const first = surface[0];
  const last = surface.at(-1);
  if (!first || !last) throw new XFoilInputError("Cannot interpolate an empty surface.");
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  for (let index = 1; index < surface.length; index += 1) {
    const right = surface[index];
    const left = surface[index - 1];
    if (!right || !left) continue;
    if (x <= right.x) {
      const span = right.x - left.x;
      if (Math.abs(span) < 1e-12) return (left.y + right.y) / 2;
      const t = (x - left.x) / span;
      return left.y + t * (right.y - left.y);
    }
  }

  return last.y;
}

function maxMetric(
  airfoil: Airfoil,
  metric: (upper: number, lower: number) => number,
): { value: number; x: number } {
  const { upper, lower } = splitSurfaces(airfoil.coordinates);
  let best = { value: -Infinity, x: 0 };

  for (let index = 0; index <= 200; index += 1) {
    const x = index / 200;
    const value = metric(interpolateSurfaceY(upper, x), interpolateSurfaceY(lower, x));
    if (value > best.value) best = { value, x };
  }

  return best;
}

function averagePoints(points: ReadonlyArray<Point>): Point {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}
