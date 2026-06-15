import { XFoilInputError } from "../errors.js";

export function formatNumber(value: number, label = "number"): string {
  if (!Number.isFinite(value)) {
    throw new XFoilInputError(`${label} must be a finite number.`);
  }

  if (Object.is(value, -0)) return "0";
  const rendered =
    Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) < 1e-4)
      ? value.toExponential(10)
      : value.toPrecision(12);

  return rendered
    .replace(/(\.\d*?)0+(e|$)/i, "$1$2")
    .replace(/\.($|e)/i, "$1")
    .replace(/e\+?/i, "e");
}

export function assertInteger(
  value: number,
  label: string,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new XFoilInputError(`${label} must be an integer between ${min} and ${max}.`);
  }
}
