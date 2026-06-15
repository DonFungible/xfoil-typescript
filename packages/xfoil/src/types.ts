import type { Airfoil } from "./geometry/airfoil.js";

export interface Point {
  x: number;
  y: number;
}

export type RepanelOption = boolean | { panels: number };

export interface XFoilOptions {
  binaryPath?: string | undefined;
  timeoutMs?: number | undefined;
  workDir?: string | undefined;
  iterations?: number | undefined;
  repanel?: RepanelOption | undefined;
  keepFiles?: boolean | undefined;
  logger?: ((event: XFoilLogEvent) => void) | undefined;
  env?: Record<string, string> | undefined;
  backend?: Backend | undefined;
  /** Opt into resolving a bare `xfoil` executable on PATH. Defaults to false. */
  allowPathLookup?: boolean | undefined;
}

export type XFoilLogEvent =
  | { type: "script"; lines: string[] }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "spawn"; binary: string; cwd: string }
  | { type: "exit"; code: number | null; durationMs: number; timedOut: boolean };

export interface FlowCondition {
  reynolds?: number | undefined;
  mach?: number | undefined;
  ncrit?: number | undefined;
  xtr?: { top?: number | undefined; bottom?: number | undefined } | undefined;
  iterations?: number | undefined;
  flap?: { x: number; y: number; angle: number } | undefined;
}

export type AirfoilInput =
  | { naca: string }
  | { coordinates: Point[]; name?: string | undefined }
  | { dat: string; name?: string | undefined }
  | { datPath: string }
  | Airfoil;

export interface AnalyzeInput extends FlowCondition {
  airfoil: AirfoilInput;
  alpha?: number | undefined;
  cl?: number | undefined;
  cp?: boolean | undefined;
  boundaryLayer?: boolean | undefined;
  ramp?: boolean | { step: number } | undefined;
  repanel?: RepanelOption | undefined;
}

export interface AnalysisResult {
  alpha: number;
  cl: number;
  cd: number;
  cdp: number;
  cm: number;
  topXtr: number;
  botXtr: number;
  converged: boolean;
  cp?: CpDistribution | undefined;
  boundaryLayer?: BoundaryLayer | undefined;
  raw?: { stdout: string; script: string[]; dir?: string | undefined } | undefined;
}

export interface AlphaRange {
  start: number;
  end: number;
  step: number;
}

export interface PolarInput extends FlowCondition {
  airfoil: AirfoilInput;
  alpha?: AlphaRange | number[] | undefined;
  cl?: AlphaRange | undefined;
  cpAt?: number[] | undefined;
  repanel?: RepanelOption | undefined;
}

export interface Polar {
  airfoilName: string;
  reynolds: number;
  mach: number;
  ncrit: number;
  points: PolarPoint[];
  requested: number[];
  failed: number[];
  cp?: Record<number, CpDistribution> | undefined;
  raw?: { stdout: string; script: string[]; file: string; dir?: string | undefined } | undefined;
}

export interface PolarPoint {
  alpha: number;
  cl: number;
  cd: number;
  cdp: number;
  cm: number;
  topXtr: number;
  botXtr: number;
}

export interface CpDistribution {
  x: number[];
  cp: number[];
  points: ReadonlyArray<{ x: number; cp: number }>;
}

export interface BoundaryLayer {
  s: number[];
  x: number[];
  y: number[];
  ue: number[];
  dstar: number[];
  theta: number[];
  cf: number[];
  h: number[];
}

export interface RawOptions {
  inputFiles?: Record<string, string> | undefined;
  outputFiles?: string[] | undefined;
  timeoutMs?: number | undefined;
  keepFiles?: boolean | undefined;
}

export interface RawResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  files: Record<string, string>;
  timedOut: boolean;
  dir?: string | undefined;
}

export interface RunRequest {
  script: string[];
  inputFiles?: Record<string, string> | undefined;
  outputFiles: string[];
  timeoutMs: number;
  env?: Record<string, string> | undefined;
  keepFiles?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  files: Record<string, string>;
  timedOut: boolean;
  durationMs: number;
  dir?: string | undefined;
}

export interface Backend {
  run(req: RunRequest): Promise<RunResult>;
  version(): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface SessionPlan<T> {
  script: string[];
  inputFiles?: Record<string, string> | undefined;
  outputFiles: string[];
  collect: (result: RawResult) => T;
}

export interface Session {
  naca(d: string): Session;
  load(input: AirfoilInput): Session;
  pane(panels?: number): Session;
  raw(line: string): Session;
  oper(): OperSession;
}

export interface OperSession {
  visc(re: number): OperSession;
  inviscid(): OperSession;
  mach(m: number): OperSession;
  iter(n: number): OperSession;
  vpar(p: { ncrit?: number; xtr?: { top?: number; bottom?: number } }): OperSession;
  alfa(deg: number): OperSession;
  cl(cl: number): OperSession;
  aseq(start: number, end: number, step: number): OperSession;
  cseq(start: number, end: number, step: number): OperSession;
  pacc(): OperSession;
  cpwr(): OperSession;
  dump(): OperSession;
  collect(): SessionPlan<{ polar?: Polar; cps: CpDistribution[]; bls: BoundaryLayer[] }>;
  raw(line: string): OperSession;
}
