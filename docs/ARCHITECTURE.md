# Architecture

How the `xfoil` package is structured and how a call flows from TypeScript to the XFOIL process and back. See [Decisions](DECISIONS.md) for the *why* and [API](API.md) for the public surface.

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Consumer code (Node server / script / Next.js server action)          │
│      import { XFoil } from "xfoil"                                      │
└───────────────┬────────────────────────────────────────────────────────┘
                │  analyze() / polar() / session() / raw()
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  xfoil (MIT, the published wrapper)                                     │
│                                                                        │
│  High-level API ──► Command builder ──► Backend ──► Output parsers      │
│  (analyze/polar)    (XFOIL scripts)     (process)   (typed results)     │
│        │                                   │                            │
│        └────────── geometry (pure TS) ◄────┘  parsers (pure TS)         │
└───────────────┬────────────────────────────────────────────────────────┘
                │  spawn(binary, cwd=tmp), write stdin, read files
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  @xfoil/<platform> (GPL)  →  headless XFOIL executable                  │
│  runs in a private temp dir, writes polar/Cp/BL files, exits           │
└──────────────────────────────────────────────────────────────────────┘
```

The browser only ever sees the pure-TS leaves (`xfoil/geometry`, `xfoil/parsers`); execution lives behind the `Backend` seam.

## 2. Module layout (`packages/xfoil/src`)

```
src/
├── index.ts              # Node entry: re-exports XFoil + geometry + parsers + types + errors
├── geometry/             # PURE TS — browser-safe (entry: xfoil/geometry)
│   ├── index.ts
│   ├── airfoil.ts        # Airfoil class (coordinates, toDat, normalize, repanel, metrics)
│   ├── naca.ts           # NACA 4- and 5-digit coordinate generation
│   └── dat.ts            # Selig/Lednicer detection + serialization helpers
├── parsers/              # PURE TS — browser-safe (entry: xfoil/parsers)
│   ├── index.ts
│   ├── polar.ts          # parsePolar: header metadata + data rows
│   ├── cp.ts             # parseCp
│   ├── dump.ts           # parseDump (boundary layer)
│   ├── coordinates.ts    # parseCoordinates (.dat)
│   └── numeric.ts        # tolerant Fortran number tokenizer ("*****" -> NaN)
├── core/                 # NODE-ONLY
│   ├── xfoil.ts          # XFoil class: analyze/polar/session/raw/version/isAvailable
│   ├── commands.ts       # pure command-script builders (string[] generators)
│   ├── session.ts        # fluent low-level session builder
│   ├── run.ts            # orchestration: temp dir + backend + file collection
│   └── options.ts        # defaults, option normalization/validation
├── backend/              # NODE-ONLY
│   ├── backend.ts        # Backend interface
│   ├── node-native.ts    # spawn-based implementation
│   └── resolve-binary.ts # binary resolution (option → env → @xfoil/* → PATH)
├── errors.ts             # error hierarchy (shared)
└── types.ts              # shared public types (shared)
```

**Dependency rule (enforced in CI):** `geometry/**` and `parsers/**` and `types.ts`/`errors.ts` must not import from `core/**` or `backend/**` or any `node:` built-in. `core`/`backend` may import everything. This keeps the browser-safe subpaths provably pure.

## 3. Data flow — a `polar()` call

```
polar(input)
  1. options.ts      normalize + validate input, merge defaults
  2. geometry        if coordinates/dat/Airfoil → produce Selig .dat text
  3. run.ts          mkdtemp() private dir; write airfoil.dat (if needed) + choose
                     unique output filenames (polar.txt, [cp_*.txt], [bl_*.txt])
  4. commands.ts     build the XFOIL command script (string[]) for this plan
  5. backend         spawn(binary, { cwd: tmp }); write script to stdin; end stdin;
                     enforce timeoutMs; capture stdout/stderr; await exit
  6. run.ts          read the output files from tmp
  7. parsers         parsePolar(polarText) → points + metadata
  8. run.ts          compute requested[] vs converged → failed[]; assemble Polar
  9. run.ts          cleanup tmp (unless keepFiles); resolve
```

Every step except 5 is pure/deterministic and unit-testable in isolation. Step 5 is the only place the process is touched and is the single integration seam.

## 4. The `Backend` seam

```ts
export interface RunRequest {
  /** Lines fed to XFOIL stdin, in order. */
  script: string[];
  /** Files to materialize in the run dir before launch (e.g. airfoil.dat). */
  inputFiles?: Record<string, string>;
  /** Output filenames to read back after exit. */
  outputFiles: string[];
  /** Hard wall-clock bound; process is killed on expiry. */
  timeoutMs: number;
  /** Extra environment for the child. */
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** outputFiles that existed, by name → contents. Missing files are absent. */
  files: Record<string, string>;
  timedOut: boolean;
  durationMs: number;
}

export interface Backend {
  run(req: RunRequest): Promise<RunResult>;
  /** Probe: resolve a binary + read its version banner. */
  version(): Promise<string>;
  isAvailable(): Promise<boolean>;
}
```

- **`NodeNativeBackend`** (v1): resolves the binary, `mkdtemp`s a run dir, writes `inputFiles`, `spawn`s with `cwd` = run dir and **no shell**, writes `script.join("\n") + "\n"` to stdin then `end()`s it, races exit against `timeoutMs` (kills the process tree on timeout, honoring `AbortSignal`), reads `outputFiles`, and cleans up.
- **`WasmBackend`** (future): same contract over an Emscripten module with an in-memory FS. Public API unchanged. (ADR-0007.)

The `XFoil` class depends only on `Backend`, so tests can inject a `FakeBackend` that returns canned files — letting the entire orchestration layer be tested without a real binary.

## 5. Binary resolution (`resolve-binary.ts`)

Order (first hit wins), per ADR-0006:

1. `options.binaryPath` (constructor or per-call).
2. `process.env.XFOIL_BINARY_PATH`.
3. `require.resolve("@xfoil/<platform>/<exe>")` where `<platform>` = `${process.platform}-${process.arch}` mapped to package names (`win32-x64`, `darwin-arm64`, …) and `<exe>` is `xfoil` or `xfoil.exe`.
4. (Opt-in, documented) `xfoil` on `PATH`.

If none resolve → `XFoilBinaryNotFoundError` naming `${platform}-${arch}`, the packages searched, and remediation (`XFOIL_BINARY_PATH`, supported-platform list, link to docs). The resolved path + executable bit are validated once and cached on the instance.

## 6. Command builder (`commands.ts`)

Pure functions from a typed *plan* to `string[]`. They encode the exact XFOIL menu sequences (see [XFOIL Reference](XFOIL_REFERENCE.md)). Sketch:

```ts
function buildPolarScript(p: PolarPlan): string[] {
  const s: string[] = [];
  s.push("PLOP", "G F", "");                 // defensive graphics-off (also compiled out)
  if (p.naca) s.push(`NACA ${p.naca}`);
  else s.push(`LOAD ${p.datFile}`, p.airfoilName ?? "");
  if (p.repanel) s.push("PANE");
  s.push("OPER");
  if (p.reynolds != null) s.push(`VISC ${p.reynolds}`);
  if (p.mach) s.push(`MACH ${p.mach}`);
  if (p.iterations) s.push(`ITER ${p.iterations}`);
  if (p.reynolds != null && (p.ncrit != null || p.xtr)) {
    s.push("VPAR");
    if (p.ncrit != null) s.push(`N ${p.ncrit}`);
    if (p.xtr) s.push(`XTR ${p.xtr.top ?? 1} ${p.xtr.bottom ?? 1}`);
    s.push("");                              // exit VPAR
  }
  s.push("PACC", p.polarFile, "");           // accumulate → save file, no dump file
  if (p.range) s.push(`ASEQ ${p.range.start} ${p.range.end} ${p.range.step}`);
  else for (const a of p.alphas!) s.push(`ALFA ${a}`);
  s.push("PACC");                            // toggle accumulation off (flush/close)
  s.push("", "QUIT");                        // leave OPER, quit
  return s;
}
```

These builders are 100% unit-tested by asserting the produced line array — no binary required. Numeric formatting is centralized (fixed decimals, locale-independent) to avoid `toString` surprises.

## 7. Geometry & parsers (pure TS)

- **`Airfoil`** holds an ordered `Point[]` (Selig convention: TE → upper → LE → lower → TE) plus a name. Factory methods: `fromNACA`, `fromDat`, `fromCoordinates`. Instance methods: `toDat`, `normalize`, `repanel` (cosine spacing), `bounds`, `maxThickness`, `maxCamber`. No I/O, no Node deps.
- **NACA generation** implements the standard 4-digit thickness/camber equations (and 5-digit), with cosine-clustered x. Used for client rendering; XFOIL's own `NACA` command is used for *analysis* fidelity (ADR note: we don't feed our generated NACA into XFOIL by default to stay byte-faithful to XFOIL's paneling).
- **Parsers** are tolerant, pure functions over text. `numeric.ts` splits Fortran whitespace-delimited fields and maps overflow tokens (`*****`, `NaN`, `Inf`) to JS `NaN`/`Infinity`. Each parser locates its header row by content (not line number) so minor version drift doesn't break it.

## 8. Concurrency & isolation

- Each call uses its own `mkdtemp` dir as CWD and unique filenames → **no global state**, safe to run many `XFoil` calls concurrently in one process.
- No file-overwrite prompts ever occur (fresh names), removing a class of hangs.
- A future `XFoilPool` (roadmap) bounds parallelism (e.g. to CPU count) for large sweeps; the core stays pool-agnostic.

## 9. Lifecycle & cleanup

- The run dir is created before spawn and removed in a `finally` — covering success, throw, timeout, and abort.
- On timeout/abort the process **tree** is killed (Unix: kill process group; Windows: `taskkill /T` semantics) so no orphaned XFOIL lingers.
- `keepFiles: true` skips cleanup and returns the dir path for debugging.

## 10. Packaging & build outputs

`tsup` produces, for each entry (`index`, `geometry`, `parsers`):

- ESM (`.js`) + CJS (`.cjs`) + types (`.d.ts` / `.d.cts`).

`package.json` (wrapper) shape:

```jsonc
{
  "name": "xfoil",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":          { "types": "./dist/index.d.ts",    "import": "./dist/index.js",    "require": "./dist/index.cjs" },
    "./geometry": { "types": "./dist/geometry.d.ts", "import": "./dist/geometry.js", "require": "./dist/geometry.cjs" },
    "./parsers":  { "types": "./dist/parsers.d.ts",  "import": "./dist/parsers.js",  "require": "./dist/parsers.cjs" }
  },
  "engines": { "node": ">=20" },
  "optionalDependencies": {
    "@xfoil/darwin-arm64": "1.0.0",
    "@xfoil/darwin-x64":   "1.0.0",
    "@xfoil/linux-x64":    "1.0.0",
    "@xfoil/linux-arm64":  "1.0.0",
    "@xfoil/win32-x64":    "1.0.0"
  }
}
```

A binary package (`@xfoil/linux-x64/package.json`):

```jsonc
{
  "name": "@xfoil/linux-x64",
  "version": "1.0.0",
  "license": "GPL-2.0-or-later",
  "os": ["linux"],
  "cpu": ["x64"],
  "files": ["xfoil", "LICENSE", "SOURCE_OFFER.md", "VERSION"],
  "xfoilVersion": "6.99"
}
```

`os`/`cpu` make npm skip non-matching optional deps automatically.

## 11. Repository layout (pnpm monorepo)

```
xfoil/                          # repo root (private workspace)
├── pnpm-workspace.yaml
├── package.json                # root scripts (build, test, lint, release)
├── tsconfig.base.json
├── biome.json                  # or .eslintrc + .prettierrc
├── LICENSE                     # MIT (wrapper)
├── README.md
├── docs/                       # these documents
├── packages/
│   ├── xfoil/                  # the published MIT wrapper
│   │   ├── src/  test/  package.json  tsup.config.ts
│   └── binaries/
│       ├── darwin-arm64/       # @xfoil/darwin-arm64 (binary + GPL files)
│       ├── darwin-x64/
│       ├── linux-x64/
│       ├── linux-arm64/
│       └── win32-x64/
├── build/                      # XFOIL compilation (see Binary Distribution)
│   ├── patches/                # modern-gfortran patches
│   ├── stub-plotlib/           # no-op Xplot11 replacement
│   ├── Dockerfile.linux        # linux x64/arm64 (manylinux-style)
│   ├── build-macos.sh
│   └── build-windows.ps1       # mingw-w64 cross or native
├── examples/
│   ├── node-basic/
│   ├── batch-sweep/
│   └── nextjs-app/
└── .github/workflows/
    ├── ci.yml                  # lint + unit + (integration where a binary exists)
    ├── build-binaries.yml      # the per-platform build matrix → artifacts
    └── release.yml             # Changesets version + publish (provenance)
```

## 12. Why this shape

- **One seam to the outside world** (`Backend`) → the risky part (process/binary) is small, swappable (WASM later), and fully mockable.
- **Pure core** (commands + parsers + geometry) → the bulk of the logic is deterministic and testable without XFOIL, so CI is fast and contributors are productive without a local build.
- **Strict purity boundary** for browser subpaths → the React use case is guaranteed by construction and enforced in CI, not by convention.
- **Binaries as data packages** → the GPL surface is isolated, install is frictionless, and the build matrix is decoupled from the wrapper's release cadence.
