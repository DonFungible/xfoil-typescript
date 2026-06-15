import type { AlphaRange, FlowCondition, RepanelOption } from "../types.js";
import { assertInteger, formatNumber } from "./format.js";

export interface AirfoilPlan {
  kind: "naca" | "file";
  naca?: string | undefined;
  file?: string | undefined;
  name?: string | undefined;
  repanel: RepanelOption;
}

export interface AnalyzePlan extends FlowCondition {
  airfoil: AirfoilPlan;
  alpha?: number | undefined;
  cl?: number | undefined;
  cpFile?: string | undefined;
  dumpFile?: string | undefined;
  iterations: number;
  polarFile: string;
  ramp?: boolean | { step: number } | undefined;
}

export interface PolarPlan extends FlowCondition {
  airfoil: AirfoilPlan;
  alpha?: AlphaRange | number[] | undefined;
  cl?: AlphaRange | undefined;
  iterations: number;
  polarFile: string;
}

export function buildAnalyzeScript(plan: AnalyzePlan): string[] {
  const lines = [
    ...prelude(),
    ...airfoilLines(plan.airfoil),
    ...flapLines(plan.flap),
    "OPER",
    ...flowLines(plan),
  ];
  if (plan.alpha !== undefined) lines.push(...rampLines(plan.alpha, plan.ramp));
  lines.push("PACC", plan.polarFile, "");
  if (plan.alpha !== undefined) lines.push(`ALFA ${formatNumber(plan.alpha, "alpha")}`);
  if (plan.cl !== undefined) lines.push(clSequenceLine(plan.cl));
  if (plan.cpFile) lines.push(`CPWR ${plan.cpFile}`);
  if (plan.dumpFile) lines.push(`DUMP ${plan.dumpFile}`);
  lines.push("PACC", "", "QUIT");
  return lines;
}

export function buildPolarScript(plan: PolarPlan): string[] {
  const lines = [
    ...prelude(),
    ...airfoilLines(plan.airfoil),
    ...flapLines(plan.flap),
    "OPER",
    ...flowLines(plan),
    "PACC",
    plan.polarFile,
    "",
  ];

  if (Array.isArray(plan.alpha)) {
    for (const alpha of plan.alpha) lines.push(`ALFA ${formatNumber(alpha, "alpha")}`);
  } else if (plan.alpha) {
    lines.push(rangeLine("ASEQ", plan.alpha));
  } else if (plan.cl) {
    lines.push(rangeLine("CSEQ", plan.cl));
  }

  lines.push("PACC", "", "QUIT");
  return lines;
}

export function prelude(): string[] {
  return ["PLOP", "G F", ""];
}

export function airfoilLines(plan: AirfoilPlan): string[] {
  const lines: string[] = [];

  if (plan.kind === "naca") {
    lines.push(`NACA ${plan.naca}`);
  } else {
    lines.push(`LOAD ${plan.file}`, plan.name ?? "");
  }

  if (typeof plan.repanel === "object") {
    assertInteger(plan.repanel.panels, "repanel.panels", 20, 500);
    lines.push("PPAR", "N", `${plan.repanel.panels}`, "", "");
  } else if (plan.repanel) {
    lines.push("PANE");
  }

  return lines;
}

export function flowLines(flow: FlowCondition & { iterations: number }): string[] {
  const lines: string[] = [];

  if (flow.reynolds !== undefined) lines.push(`VISC ${formatNumber(flow.reynolds, "reynolds")}`);
  if (flow.mach !== undefined && flow.mach !== 0)
    lines.push(`MACH ${formatNumber(flow.mach, "mach")}`);
  lines.push(`ITER ${formatNumber(flow.iterations, "iterations")}`);

  if (flow.reynolds !== undefined && (flow.ncrit !== undefined || flow.xtr !== undefined)) {
    lines.push("VPAR");
    if (flow.ncrit !== undefined) lines.push(`N ${formatNumber(flow.ncrit, "ncrit")}`);
    if (flow.xtr !== undefined) {
      lines.push(
        `XTR ${formatNumber(flow.xtr.top ?? 1, "xtr.top")} ${formatNumber(flow.xtr.bottom ?? 1, "xtr.bottom")}`,
      );
    }
    lines.push("");
  }

  return lines;
}

export function flapLines(flap: FlowCondition["flap"]): string[] {
  if (!flap) return [];
  return [
    "GDES",
    "FLAP",
    formatNumber(flap.x, "flap.x"),
    formatNumber(flap.y, "flap.y"),
    formatNumber(flap.angle, "flap.angle"),
    "EXEC",
    "",
  ];
}

function rangeLine(command: "ASEQ" | "CSEQ", range: AlphaRange): string {
  return `${command} ${formatNumber(range.start)} ${formatNumber(range.end)} ${formatNumber(range.step)}`;
}

function clSequenceLine(targetCl: number): string {
  const stepCount = Math.max(1, Math.ceil(Math.abs(targetCl) / 0.1));
  const step = targetCl === 0 ? 0.1 : targetCl / stepCount;
  return `CSEQ 0 ${formatNumber(targetCl, "cl")} ${formatNumber(step, "cl.step")}`;
}

function rampLines(targetAlpha: number, ramp: boolean | { step: number } | undefined): string[] {
  if (!ramp || targetAlpha === 0) return [];
  const stepMagnitude = typeof ramp === "object" ? ramp.step : 1;
  assertPositiveNumber(stepMagnitude, "ramp.step");
  const direction = Math.sign(targetAlpha);
  const step = direction * stepMagnitude;
  const lines: string[] = [];
  let current = step;
  let guard = 0;

  while (
    (direction > 0 && current < targetAlpha - 1e-12) ||
    (direction < 0 && current > targetAlpha + 1e-12)
  ) {
    lines.push(`ALFA ${formatNumber(current, "ramp.alpha")}`);
    current += step;
    guard += 1;
    if (guard > 10_000) throw new Error("ramp expands to too many points.");
  }

  return lines;
}

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero.`);
  }
}
