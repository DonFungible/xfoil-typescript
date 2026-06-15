# API Specification

The complete public surface of `xfoil@1.x`. Types are normative — implementation must match. Entry points:

- `xfoil` — Node-only: `XFoil`, all of geometry & parsers (re-exported), types, errors.
- `xfoil/geometry` — browser-safe: `Airfoil`, `naca`, geometry types.
- `xfoil/parsers` — browser-safe: `parsePolar`, `parseCp`, `parseDump`, `parseCoordinates`.

> Conventions: angles in **degrees**, lengths normalized to **unit chord**, all numerics `number`. `NaN` denotes a value XFOIL printed as overflow (`*****`). Every async method returns a `Promise`.

---

## 1. `XFoil` (entry: `xfoil`)

```ts
class XFoil {
  constructor(options?: XFoilOptions);

  /** Single operating point (prescribed alpha OR cl). */
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;

  /** Polar sweep over alpha (range or list) or cl (range). */
  polar(input: PolarInput): Promise<Polar>;

  /** Fluent low-level session mirroring XFOIL menus. */
  session<T>(build: (s: Session) => SessionPlan<T>): Promise<T>;

  /** Raw escape hatch: feed command lines, get stdout + files written. */
  raw(commands: string[], options?: RawOptions): Promise<RawResult>;

  /** XFOIL version string from the resolved binary, e.g. "6.99". */
  version(): Promise<string>;

  /** True if a usable binary resolves on this machine. */
  isAvailable(): Promise<boolean>;
}
```

### 1.1 `XFoilOptions`

```ts
interface XFoilOptions {
  /** Explicit path to an xfoil executable. Highest precedence. */
  binaryPath?: string;
  /** Hard per-run wall-clock limit (ms). Default 60_000. */
  timeoutMs?: number;
  /** Base dir for per-run temp dirs. Default os.tmpdir(). */
  workDir?: string;
  /** Default viscous iteration limit (ITER). Default 100. */
  iterations?: number;
  /** Re-panel loaded coordinates. true | false | { panels: number }. Default true. */
  repanel?: boolean | { panels: number };
  /** Keep the temp run dir (returns its path on results) for debugging. Default false. */
  keepFiles?: boolean;
  /** Receive structured log/debug events. */
  logger?: (event: XFoilLogEvent) => void;
  /** Extra environment for the child process. */
  env?: Record<string, string>;
  /** Inject a custom backend (testing / future WASM). */
  backend?: Backend;
}

type XFoilLogEvent =
  | { type: "script"; lines: string[] }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "spawn"; binary: string; cwd: string }
  | { type: "exit"; code: number | null; durationMs: number; timedOut: boolean };
```

### 1.2 Shared flow condition

```ts
interface FlowCondition {
  /** Reynolds number. Omit ⇒ inviscid analysis. */
  reynolds?: number;
  /** Mach number. Default 0. */
  mach?: number;
  /** Transition criterion Ncrit (viscous only). Default 9. */
  ncrit?: number;
  /** Forced transition locations x/c (0..1). */
  xtr?: { top?: number; bottom?: number };
  /** Viscous iteration limit. Overrides instance default. */
  iterations?: number;
  /** Flap deflection: hinge at (x,y) chord-fraction, angle in degrees (+down). */
  flap?: { x: number; y: number; angle: number };
}
```

### 1.3 Airfoil input

```ts
type AirfoilInput =
  | { naca: string }                                  // "2412" | "23012" — uses XFOIL's NACA cmd
  | { coordinates: Point[]; name?: string }           // explicit points
  | { dat: string; name?: string }                    // raw .dat content
  | { datPath: string }                               // path to a .dat file
  | Airfoil;                                           // instance from xfoil/geometry

interface Point { x: number; y: number; }
```

### 1.4 `analyze`

```ts
interface AnalyzeInput extends FlowCondition {
  airfoil: AirfoilInput;
  /** Prescribe angle of attack (deg). Exactly one of alpha|cl. */
  alpha?: number;
  /** Prescribe lift coefficient. Exactly one of alpha|cl. */
  cl?: number;
  /** Also capture pressure distribution (CPWR). Default false. */
  cp?: boolean;
  /** Also capture boundary-layer dump (DUMP). Default false. */
  boundaryLayer?: boolean;
  /** Ramp through intermediate alphas to aid convergence. Default false. */
  ramp?: boolean | { step: number };
  /** Override repanel for this call. */
  repanel?: boolean | { panels: number };
}

interface AnalysisResult {
  alpha: number;       // deg
  cl: number;
  cd: number;
  cdp: number;         // pressure drag component
  cm: number;          // quarter-chord moment
  topXtr: number;      // top transition x/c
  botXtr: number;      // bottom transition x/c
  converged: boolean;
  cp?: CpDistribution;
  boundaryLayer?: BoundaryLayer;
  /** Raw artifacts when debugging. */
  raw?: { stdout: string; script: string[]; dir?: string };
}
```

For robustness with XFOIL 6.99, `analyze({ cl })` is implemented as a short `CSEQ` continuation from `0` to the requested lift coefficient and returns the requested target row. Direct native `CL` solves can reach the target but fail to append a polar row in some viscous cases.

### 1.5 `polar`

```ts
interface PolarInput extends FlowCondition {
  airfoil: AirfoilInput;
  /** Alpha sweep: inclusive range or explicit list (deg). One of alpha|cl. */
  alpha?: AlphaRange | number[];
  /** Cl sweep: inclusive range. One of alpha|cl. */
  cl?: { start: number; end: number; step: number };
  /** Capture Cp at these alphas during the sweep (extra runs). */
  cpAt?: number[];
  repanel?: boolean | { panels: number };
}

interface AlphaRange { start: number; end: number; step: number; }

interface Polar {
  airfoilName: string;
  reynolds: number;       // NaN if inviscid
  mach: number;
  ncrit: number;
  points: PolarPoint[];   // converged points, in sweep order
  requested: number[];    // requested alpha (or cl) values
  failed: number[];       // requested but did not converge
  cp?: Record<number, CpDistribution>; // keyed by alpha, if cpAt used
  raw?: { stdout: string; script: string[]; file: string; dir?: string };
}

interface PolarPoint {
  alpha: number; cl: number; cd: number; cdp: number; cm: number;
  topXtr: number; botXtr: number;
}
```

### 1.6 Distributions

```ts
interface CpDistribution {
  x: number[];
  cp: number[];
  points: ReadonlyArray<{ x: number; cp: number }>;
}

interface BoundaryLayer {
  s: number[];      // arc length
  x: number[];      // x/c
  y: number[];      // y/c
  ue: number[];     // edge velocity Ue/Vinf
  dstar: number[];  // displacement thickness δ*
  theta: number[];  // momentum thickness θ
  cf: number[];     // skin friction coefficient
  h: number[];      // shape factor H
}
```

### 1.7 Low-level: `session` and `raw`

```ts
interface RawOptions {
  inputFiles?: Record<string, string>;  // materialized in the run dir
  outputFiles?: string[];               // read back after exit
  timeoutMs?: number;
  keepFiles?: boolean;
}
interface RawResult {
  stdout: string; stderr: string; exitCode: number | null;
  files: Record<string, string>; timedOut: boolean; dir?: string;
}

/** Fluent builder mirroring XFOIL menus; terminal methods declare outputs to parse. */
interface Session {
  naca(d: string): Session;
  load(input: AirfoilInput): Session;
  pane(panels?: number): Session;
  oper(): OperSession;
  raw(line: string): Session;          // drop a literal command anywhere
}
interface OperSession {
  visc(re: number): OperSession;
  inviscid(): OperSession;
  mach(m: number): OperSession;
  iter(n: number): OperSession;
  vpar(p: { ncrit?: number; xtr?: { top?: number; bottom?: number } }): OperSession;
  alfa(deg: number): OperSession;
  cl(cl: number): OperSession;
  aseq(start: number, end: number, step: number): OperSession;
  cseq(start: number, end: number, step: number): OperSession;
  pacc(): OperSession;                  // toggle accumulation (auto-managed file)
  cpwr(): OperSession;                  // capture Cp of current point
  dump(): OperSession;                  // capture BL of current point
  collect(): SessionPlan<{ polar?: Polar; cps: CpDistribution[]; bls: BoundaryLayer[] }>;
  raw(line: string): OperSession;
}
```

`session()` is sugar over `raw()` + the parsers; it exists so power users get parity with an XFOIL session without remembering exact prompt sequencing. Example:

```ts
const { polar } = await xf.session((s) =>
  s.naca("2412").pane().oper().visc(1e6).mach(0.1).iter(200)
   .vpar({ ncrit: 7 }).aseq(-5, 15, 0.5).collect()
);
```

---

## 2. `xfoil/geometry` (browser-safe)

```ts
class Airfoil {
  readonly name: string;
  readonly coordinates: ReadonlyArray<Point>; // Selig order: TE→upper→LE→lower→TE

  static fromNACA(designation: string, opts?: { panels?: number }): Airfoil; // 4 & 5 digit
  static fromCoordinates(points: Point[], name?: string): Airfoil;
  static fromDat(text: string): Airfoil;        // detects Selig vs Lednicer

  toDat(): string;                              // Selig format, name header line
  normalize(): Airfoil;                         // chord=1, LE at origin, TE on x-axis
  repanel(panels: number): Airfoil;             // cosine-clustered re-sampling
  bounds(): { minX: number; maxX: number; minY: number; maxY: number };
  maxThickness(): { value: number; x: number }; // t/c and its location
  maxCamber(): { value: number; x: number };
}

/** Functional NACA generator (used by Airfoil.fromNACA). */
function naca(designation: string, opts?: { panels?: number }): Point[];
```

> Note: `Airfoil`/`naca` are for client-side rendering and validation. For *analysis*, pass `{ naca: "2412" }` to `analyze`/`polar` so XFOIL generates and panels the section itself (byte-faithful to XFOIL). You *can* pass an `Airfoil` to analysis; it is serialized and `LOAD`ed.

---

## 3. `xfoil/parsers` (browser-safe)

```ts
function parsePolar(text: string): Polar;                 // PACC save file
function parseCp(text: string): CpDistribution;           // CPWR output
function parseDump(text: string): BoundaryLayer;          // DUMP output
function parseCoordinates(text: string): { name: string; points: Point[] };

/** Low-level helper, also exported for custom formats. */
function parseFortranNumbers(line: string): number[];     // "*****" → NaN
```

All parsers are pure, synchronous, and total: they never throw on well-formed XFOIL output and degrade to `NaN` on overflow tokens. Malformed input throws `XFoilParseError` with context.

---

## 4. Errors (entry: `xfoil`)

```ts
class XFoilError extends Error {}                  // base
class XFoilBinaryNotFoundError extends XFoilError {// no binary resolved
  platform: string; searched: string[];
}
class XFoilTimeoutError extends XFoilError {       // exceeded timeoutMs
  timeoutMs: number; stdout: string;
}
class XFoilProcessError extends XFoilError {       // nonzero/crash exit
  exitCode: number | null; stdout: string; stderr: string;
}
class XFoilParseError extends XFoilError {         // unreadable output
  file?: string; snippet?: string;
}
class XFoilInputError extends XFoilError {}        // invalid input (bad NACA, no alpha/cl, etc.)
```

**Non-convergence is not an error.** It is reported via `AnalysisResult.converged === false` and `Polar.failed`. Errors are reserved for environmental/usage faults.

---

## 5. End-to-end examples

```ts
import { XFoil } from "xfoil";
const xf = new XFoil({ timeoutMs: 30_000, iterations: 200 });

// Cl/Cd/Cm + pressure distribution at a fixed alpha
const a = await xf.analyze({ airfoil: { naca: "2412" }, reynolds: 1e6, mach: 0.1, alpha: 5, cp: true });
if (a.converged) drawCp(a.cp!);

// Cl-prescribed point with forced transition and a flap
await xf.analyze({
  airfoil: { naca: "23012" }, reynolds: 2e6, cl: 0.6,
  xtr: { top: 0.4, bottom: 0.6 }, flap: { x: 0.75, y: 0, angle: 10 },
});

// Polar over alpha; inspect non-converged points
const p = await xf.polar({ airfoil: { naca: "0012" }, reynolds: 3e6, alpha: { start: -8, end: 18, step: 0.5 } });
console.log(p.points.length, "converged;", p.failed, "failed");

// Custom airfoil from an upload (validated client-side, analyzed server-side)
import { Airfoil } from "xfoil/geometry";
const af = Airfoil.fromDat(uploadedText).normalize();
const r = await xf.analyze({ airfoil: af, reynolds: 5e5, alpha: 4, boundaryLayer: true });
```
