import { XFoilInputError } from "../errors.js";
import type {
  AlphaRange,
  AnalyzeInput,
  FlowCondition,
  PolarInput,
  RepanelOption,
  XFoilOptions,
} from "../types.js";

export interface NormalizedOptions {
  timeoutMs: number;
  iterations: number;
  repanel: RepanelOption;
  keepFiles: boolean;
  workDir: string | undefined;
  binaryPath: string | undefined;
  env: Record<string, string> | undefined;
  allowPathLookup: boolean;
}

export function normalizeOptions(options: XFoilOptions = {}): NormalizedOptions {
  return {
    allowPathLookup: options.allowPathLookup ?? false,
    binaryPath: options.binaryPath,
    env: options.env,
    iterations: options.iterations ?? 100,
    keepFiles: options.keepFiles ?? false,
    repanel: options.repanel ?? true,
    timeoutMs: options.timeoutMs ?? 60_000,
    workDir: options.workDir,
  };
}

export function validateAnalyzeInput(input: AnalyzeInput): void {
  validateFlow(input);
  validateExactlyOne(input.alpha, input.cl, "analyze() requires exactly one of alpha or cl.");
  if (input.alpha !== undefined) validateFinite(input.alpha, "alpha");
  if (input.cl !== undefined) validateFinite(input.cl, "cl");
  if (typeof input.ramp === "object" && input.ramp !== null) {
    validatePositive(input.ramp.step, "ramp.step");
  }
  validateRepanel(input.repanel);
}

export function validatePolarInput(input: PolarInput): void {
  validateFlow(input);
  validateExactlyOne(input.alpha, input.cl, "polar() requires exactly one of alpha or cl.");
  if (Array.isArray(input.alpha)) {
    if (input.alpha.length === 0)
      throw new XFoilInputError("alpha list must contain at least one value.");
    for (const alpha of input.alpha) validateFinite(alpha, "alpha");
  } else if (input.alpha !== undefined) {
    validateRange(input.alpha, "alpha");
  }
  if (input.cl !== undefined) validateRange(input.cl, "cl");
  for (const alpha of input.cpAt ?? []) validateFinite(alpha, "cpAt alpha");
  validateRepanel(input.repanel);
}

export function requestedValues(input: PolarInput): number[] {
  if (Array.isArray(input.alpha)) return [...input.alpha];
  const range = input.alpha ?? input.cl;
  if (!range) return [];
  return expandRange(range);
}

export function expandRange(range: AlphaRange): number[] {
  validateRange(range, "range");
  const values: number[] = [];
  const direction = Math.sign(range.step);
  let current = range.start;
  let guard = 0;

  while (
    (direction > 0 && current <= range.end + 1e-12) ||
    (direction < 0 && current >= range.end - 1e-12)
  ) {
    values.push(roundForComparison(current));
    current += range.step;
    guard += 1;
    if (guard > 10_000) throw new XFoilInputError("range expands to too many points.");
  }

  return values;
}

export function roundForComparison(value: number): number {
  return Number.parseFloat(value.toFixed(10));
}

export function validateNaca(designation: string): string {
  const normalized = designation.trim();
  if (!/^\d{4}$|^\d{5}$/.test(normalized)) {
    throw new XFoilInputError("NACA designation must be 4 or 5 digits.");
  }
  return normalized;
}

function validateFlow(flow: FlowCondition): void {
  if (flow.reynolds !== undefined) validatePositive(flow.reynolds, "reynolds");
  if (flow.mach !== undefined) validateFinite(flow.mach, "mach");
  if (flow.ncrit !== undefined) validatePositive(flow.ncrit, "ncrit");
  if (flow.iterations !== undefined) validatePositive(flow.iterations, "iterations");
  if (flow.xtr?.top !== undefined) validateUnit(flow.xtr.top, "xtr.top");
  if (flow.xtr?.bottom !== undefined) validateUnit(flow.xtr.bottom, "xtr.bottom");
  if (flow.flap) {
    validateUnit(flow.flap.x, "flap.x");
    validateFinite(flow.flap.y, "flap.y");
    validateFinite(flow.flap.angle, "flap.angle");
  }
}

function validateRange(range: AlphaRange, label: string): void {
  validateFinite(range.start, `${label}.start`);
  validateFinite(range.end, `${label}.end`);
  validateFinite(range.step, `${label}.step`);
  if (range.step === 0) throw new XFoilInputError(`${label}.step must not be zero.`);
  if (range.start < range.end && range.step < 0) {
    throw new XFoilInputError(`${label}.step must be positive when start < end.`);
  }
  if (range.start > range.end && range.step > 0) {
    throw new XFoilInputError(`${label}.step must be negative when start > end.`);
  }
}

function validateRepanel(repanel: RepanelOption | undefined): void {
  if (typeof repanel === "object" && repanel !== null) {
    if (!Number.isInteger(repanel.panels) || repanel.panels < 20 || repanel.panels > 500) {
      throw new XFoilInputError("repanel.panels must be an integer between 20 and 500.");
    }
  }
}

function validateExactlyOne(left: unknown, right: unknown, message: string): void {
  if ((left === undefined && right === undefined) || (left !== undefined && right !== undefined)) {
    throw new XFoilInputError(message);
  }
}

function validatePositive(value: number, label: string): void {
  validateFinite(value, label);
  if (value <= 0) throw new XFoilInputError(`${label} must be greater than zero.`);
}

function validateUnit(value: number, label: string): void {
  validateFinite(value, label);
  if (value < 0 || value > 1) throw new XFoilInputError(`${label} must be between 0 and 1.`);
}

function validateFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new XFoilInputError(`${label} must be a finite number.`);
}
