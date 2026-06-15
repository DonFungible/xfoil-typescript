"use server";

import { XFoil } from "xfoil";

export async function getPolar(naca: string) {
  return new XFoil({ allowPathLookup: true }).polar({
    airfoil: { naca },
    alpha: { end: 12, start: -4, step: 1 },
    reynolds: 1_000_000,
  });
}
