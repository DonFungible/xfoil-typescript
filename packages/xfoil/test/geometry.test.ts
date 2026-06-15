import { describe, expect, it } from "vitest";
import { Airfoil, naca } from "../src/geometry/index.js";

describe("geometry", () => {
  it("generates closed NACA 4-digit coordinates", () => {
    const points = naca("0012", { panels: 40 });
    expect(points).toHaveLength(41);
    expect(points[0]?.x).toBeCloseTo(1, 6);
    expect(points.at(-1)?.x).toBeCloseTo(1, 6);
    expect(points[0]?.y).toBeCloseTo(0, 4);
    expect(points.at(-1)?.y).toBeCloseTo(0, 4);
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(0, 6);
  });

  it("supports common NACA 5-digit sections", () => {
    const airfoil = Airfoil.fromNACA("23012", { panels: 80 });
    expect(airfoil.coordinates).toHaveLength(81);
    expect(airfoil.maxThickness().value).toBeGreaterThan(0.1);
  });

  it("round-trips Selig dat files and estimates metrics", () => {
    const airfoil = Airfoil.fromNACA("2412", { panels: 80 }).normalize().repanel(60);
    const parsed = Airfoil.fromDat(airfoil.toDat());
    expect(parsed.coordinates).toHaveLength(61);
    expect(parsed.bounds().minX).toBeCloseTo(0, 5);
    expect(parsed.bounds().maxX).toBeCloseTo(1, 5);
    expect(parsed.maxThickness().value).toBeGreaterThan(0.1);
    expect(parsed.maxCamber().value).toBeGreaterThan(0.01);
  });
});
