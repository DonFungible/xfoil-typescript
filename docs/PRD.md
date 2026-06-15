# Product Requirements Document — `xfoil` (TypeScript)

| | |
| --- | --- |
| **Status** | Alpha implementation — macOS arm64 binary staged; cross-platform binary validation and release/publish gates pending |
| **Owner** | Don (don@don.dev) |
| **Last updated** | 2026-06-15 |
| **Target first release** | `xfoil@1.0.0` |
| **Related docs** | [Architecture](ARCHITECTURE.md) · [API](API.md) · [Binary Distribution](BINARY_DISTRIBUTION.md) · [Roadmap](ROADMAP.md) · [Decisions](DECISIONS.md) |

---

## 1. Summary

`xfoil` is an npm package that lets any JavaScript/TypeScript developer run XFOIL — the standard subsonic airfoil analysis and design tool — with a single `npm install xfoil` and an idiomatic, fully typed, promise-based API. It ships prebuilt **headless** XFOIL binaries per platform (no compiler, no X11, no manual install), drives them safely and deterministically, and returns structured results. Pure-TypeScript geometry and parser modules are additionally usable in the browser, so the same package serves a Node backend and a React frontend.

The product thesis in one sentence: **a regular XFOIL user should be able to `npm install xfoil` and do everything they do in XFOIL, identically, from TypeScript.**

## 2. Problem statement & motivation

XFOIL is indispensable for low-Reynolds and subsonic airfoil work (UAVs, sailplanes, turbines, props, education), but consuming it programmatically is painful:

1. **Installation friction.** Users must obtain or compile a Fortran program. Prebuilt binaries are scattered, often Windows-only, often require X11 at runtime, and there is no canonical Node/JS distribution.
2. **Interactive-only interface.** XFOIL is a nested text-menu REPL designed for a human at a terminal. Automating it means hand-scripting stdin, knowing the exact prompt sequence, and handling silent failure modes (non-convergence, file-overwrite prompts, plot pauses).
3. **Headless fragility.** XFOIL links the X11-based Xplot11 library. On a server with no display it can hang or refuse to run unless graphics are disabled — a detail most users discover the hard way.
4. **Output scraping.** Results live in fixed-width text files (polar save files, `Cp` dumps, BL dumps) that each need a bespoke parser; numeric overflow prints as `*****`.
5. **No types, no ergonomics.** There is no typed contract for "give me Cl/Cd/Cm at this Re, Mach, α," nor a way to know which points converged.

Existing JS options are thin or absent; Python has wrappers but they still assume a locally installed binary. There is a clear gap for a batteries-included, typed, cross-platform npm package.

## 3. Goals and non-goals

### 3.1 Goals (v1.0)

- **G1 — Frictionless install.** `npm install xfoil` yields a working analysis on macOS (arm64/x64), Linux (x64/arm64), and Windows (x64) with no system prerequisites beyond Node ≥ 20.
- **G2 — Capability parity for analysis.** Single-point and polar analysis with full control of viscous/inviscid mode, Reynolds, Mach, Ncrit, forced transition, and iteration limits; extraction of Cp and boundary-layer data.
- **G3 — Idiomatic, typed API.** Promise-based; strongly typed inputs/outputs; explicit, structured convergence reporting; thrown errors that are catchable and discriminable.
- **G4 — Determinism & safety.** Each run is isolated (private temp dir, unique filenames), bounded (timeout + process kill), and free of interactive hangs (graphics compiled out; no unanswered prompts).
- **G5 — Frontend-safe subpaths.** `xfoil/geometry` and `xfoil/parsers` are pure TS, side-effect-free, and import cleanly in browser bundles (no `node:` built-ins reachable).
- **G6 — Escape hatch.** A documented low-level fluent session API and a raw-command interface so power users can reach 100% of XFOIL even where the high-level API stops.
- **G7 — Open-source ready.** MIT-licensed wrapper, GPL-compliant binary distribution, complete docs, examples, typed `.d.ts`, CI across all platforms, semantic-versioned releases with provenance.

### 3.2 Non-goals (v1.0)

- **NG1 — Browser-side solving.** XFOIL runs server-side only in v1; a WebAssembly backend is a roadmap item, not v1 (see [DECISIONS ADR-0007](DECISIONS.md)).
- **NG2 — Reimplementing XFOIL's physics in TS.** We orchestrate the real binary; we do not port the panel/IBL solver.
- **NG3 — A GUI / plotting library.** We return data; visualization is the consumer's job (though geometry output is plot-ready).
- **NG4 — Inverse/geometry design (GDES/MDES), multi-element, or non-XFOIL tools (AVL, MSES).** Deferred or out of scope.
- **NG5 — Bundling a Fortran toolchain** for users to build their own binary at install time.

## 4. Target users & personas

| Persona | Description | Primary need |
| --- | --- | --- |
| **Aero web-app developer ("Dana")** | Builds interactive aerodynamics tools / teaching apps in React/Next.js. | Run polars on the server, render airfoils + Cp on the client, all from one typed package. |
| **Simulation/optimization engineer ("Sam")** | Runs large α/Re sweeps, airfoil optimization loops, or design-space exploration from Node scripts. | Fast, scriptable, reliable batch analysis with convergence info and no per-run install. |
| **Researcher / educator ("Riley")** | Uses XFOIL in notebooks/teaching, wants reproducible results without environment setup. | "It just works" cross-platform; structured data to plot. |
| **XFOIL power user ("Quinn")** | Knows XFOIL's menus cold. | Parity — a way to do *anything* XFOIL does, including raw commands. |

## 5. Use cases / user stories

- **U1.** As Dana, I call `xf.polar(...)` in a Next.js server action and get a typed `Polar` to send to the client, while importing `xfoil/geometry` in my client component to draw the airfoil — without my bundler pulling in `child_process`.
- **U2.** As Sam, I sweep 40 Reynolds numbers × 60 α in a script; each run is isolated and bounded, failures surface as data (`failed` α list) not crashes, and I can run several concurrently.
- **U3.** As Riley, I `npm install xfoil` on a fresh laptop with no Fortran/X11 and immediately get Cl/Cd/Cm for NACA 2412.
- **U4.** As Quinn, I drop to `xf.session(s => s.oper().visc(1e6).aseq(-5,15,0.5))` or `xf.raw(["OPER","ITER 200", ...])` to do something the typed API doesn't model.
- **U5.** As any user, when a point doesn't converge, I get an explicit signal (`converged: false` / `polar.failed`) rather than silently wrong numbers.
- **U6.** As Dana, I load a custom `.dat` airfoil from a file upload, validate/normalize it with `xfoil/geometry` on the client, then analyze it on the server.

## 6. Product principles

1. **It just works, or it tells you why.** No silent failures; no hidden system prerequisites. Errors are specific and actionable.
2. **Typed contracts over text.** Every input and output has a type; raw text is available but never required.
3. **Parity with an escape hatch.** The high-level API covers the common 90%; the low-level API guarantees the last 10%.
4. **Isolated and bounded by default.** Every invocation is sandboxed in a temp dir and cannot hang forever.
5. **Frontend-safe by construction.** Pure-TS modules never reach for Node built-ins; packaging enforces it.
6. **Faithful to XFOIL.** We don't "improve" the physics or defaults silently; XFOIL's defaults are XFOIL's, and any deviation is documented.

## 7. Functional requirements

Priorities use MoSCoW: **M**ust / **S**hould / **C**ould / **W**on't (v1).

### 7.1 Installation & binary management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | `npm install xfoil` installs a working binary for macOS arm64/x64, Linux x64/arm64, Windows x64 via per-platform optional dependencies. | M |
| FR-1.2 | Binaries are headless (no X11/display dependency) and self-contained (no external shared-lib requirements beyond the OS baseline). | M |
| FR-1.3 | Binary resolution order: `XFOIL_BINARY_PATH` env / constructor option → installed `@xfoil/<platform>` package → clear error with remediation. | M |
| FR-1.4 | A helpful, typed error (`XFoilBinaryNotFoundError`) is thrown if no binary is available, naming the platform and how to fix it. | M |
| FR-1.5 | `XFoil.isAvailable()` and `XFoil.version()` let consumers probe the environment. | S |
| FR-1.6 | `--ignore-scripts`-safe: install must not depend on postinstall network access (optional-dependency model satisfies this). | M |

### 7.2 Airfoil input

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Accept a NACA 4- or 5-digit designation (`{ naca: "2412" }`), generated by XFOIL's own `NACA` command for fidelity. | M |
| FR-2.2 | Accept explicit coordinates (`{ coordinates: Point[] , name? }`) written to a temp `.dat` and `LOAD`ed. | M |
| FR-2.3 | Accept raw `.dat` content (`{ dat: string }`) and a file path (`{ datPath: string }`). | M |
| FR-2.4 | Accept an `Airfoil` instance from `xfoil/geometry`. | M |
| FR-2.5 | Optional re-paneling control (on/off, panel count via `PPAR`). Default: re-panel loaded coordinates. | S |
| FR-2.6 | Validate inputs (NACA digit count, coordinate ordering/closure) before invoking XFOIL, with clear errors. | S |

### 7.3 Operating-point analysis (`analyze`)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Analyze at a prescribed angle of attack (`alpha`) or prescribed lift coefficient (`cl`). | M |
| FR-3.2 | Viscous (when `reynolds` given) or inviscid (when omitted); set `mach` (default 0). | M |
| FR-3.3 | Set `ncrit` (default 9) and forced transition `xtr.top` / `xtr.bottom` via `VPAR`. | M |
| FR-3.4 | Set viscous iteration limit (`iterations`, default 100) via `ITER`. | M |
| FR-3.5 | Return `{ alpha, cl, cd, cdp, cm, topXtr, botXtr, converged }`. | M |
| FR-3.6 | Optionally capture pressure distribution (`cp: true` → `CPWR`). | M |
| FR-3.7 | Optionally capture boundary-layer dump (`boundaryLayer: true` → `DUMP`). | M |
| FR-3.8 | Optionally apply a flap deflection (`flap: { x, y, angle }` → `FLAP`). | S |
| FR-3.9 | Report convergence explicitly; never return fabricated values for a failed point. | M |
| FR-3.10 | Optional continuation/ramp to aid convergence at high α (run intermediate α first). | C |

### 7.4 Polar sweeps (`polar`)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Sweep α as a range (`{ start, end, step }`) via `ASEQ`, or as an explicit `number[]` via repeated `ALFA`. | M |
| FR-4.2 | Sweep Cl as a range via `CSEQ`. | S |
| FR-4.3 | Accumulate results to a polar save file (`PACC`) and parse them. | M |
| FR-4.4 | Return `Polar` with metadata (name, Re, Mach, Ncrit), `points[]`, `requested[]`, and `failed[]` (requested but not converged). | M |
| FR-4.5 | Same flow controls as `analyze` (viscous, Mach, Ncrit, xtr, iterations, flap). | M |
| FR-4.6 | Optionally capture Cp at specific α within the sweep (`cpAt: number[]`). | C |

### 7.5 Geometry (pure TS, `xfoil/geometry`)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Generate NACA 4-digit coordinates in pure TS (`Airfoil.fromNACA`). | M |
| FR-5.2 | Generate NACA 5-digit coordinates in pure TS. | S |
| FR-5.3 | Parse `.dat` in both Selig and Lednicer formats (`Airfoil.fromDat`). | M |
| FR-5.4 | Serialize to Selig `.dat` (`af.toDat()`). | M |
| FR-5.5 | Helpers: cosine re-paneling, normalization (chord/LE/TE), bounds, thickness/camber estimate. | S |
| FR-5.6 | Be browser-safe: no `node:` imports, no side effects, tree-shakeable. | M |

### 7.6 Parsers (pure TS, `xfoil/parsers`)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | `parsePolar(text)` → `Polar` (header metadata + rows; tolerate `*****` as `NaN`). | M |
| FR-6.2 | `parseCp(text)` → `{ x[], cp[] }`. | M |
| FR-6.3 | `parseDump(text)` → boundary-layer arrays (`s,x,y,ue,dstar,theta,cf,h`). | M |
| FR-6.4 | `parseCoordinates(text)` → `{ name, points[] }` (Selig/Lednicer). | M |
| FR-6.5 | Parsers are pure functions, browser-safe, and individually unit-tested against fixtures. | M |

### 7.7 Low-level / parity

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | Fluent `session()` mirroring XFOIL menus (`.oper()`, `.visc()`, `.alfa()`, `.aseq()`, `.pacc()`, `.gdes()`, …). | S |
| FR-7.2 | `raw(commands, opts)` that feeds arbitrary command lines and returns stdout + any files written in the run dir. | M |
| FR-7.3 | Hooks/option to capture raw stdout/stderr and the generated command script for debugging (`debug`/`onStdout`). | S |
| FR-7.4 | `keepFiles` option to retain the temp run directory for inspection. | S |

### 7.8 Configuration

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | `XFoil` constructor options: `binaryPath`, `timeoutMs`, `workDir`, `iterations`, `repanel`, `keepFiles`, `logger`, `env`. | M |
| FR-8.2 | Per-call overrides of relevant defaults. | M |
| FR-8.3 | Sensible, documented defaults matching XFOIL where applicable. | M |

## 8. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-1 | **Portability** | Verified on macOS (arm64, x64), Linux (x64, arm64; glibc baseline documented), Windows (x64). Node 20/22/24/LTS. |
| NFR-2 | **Performance** | Library overhead (spawn + script gen + parse) < ~50 ms beyond XFOIL's own runtime for a typical polar; no busy-waiting. |
| NFR-3 | **Reliability** | No interactive hangs; every run bounded by `timeoutMs` (default 60 s) with guaranteed process kill and temp-dir cleanup, even on throw. |
| NFR-4 | **Concurrency** | Safe to run N instances concurrently (isolated temp dirs, no shared CWD/global files). |
| NFR-5 | **Security** | Inputs that flow into the command stream / filenames are validated/sanitized; no shell interpolation (spawn without a shell); see [Engineering → Security](ENGINEERING.md#security). |
| NFR-6 | **DX** | First-class types, JSDoc on all public symbols, zero required config, copy-paste examples, helpful errors. |
| NFR-7 | **Bundle hygiene** | `xfoil/geometry` + `xfoil/parsers` contain no `node:` references; verified by a bundler/lint check in CI. Main entry is tree-shakeable (`sideEffects: false`). |
| NFR-8 | **Footprint** | Main JS package is small (KBs); each platform binary package is a single self-contained executable (low single-digit MB). Only one platform package installs per machine. |
| NFR-9 | **Compatibility** | Dual ESM + CJS output with correct `exports` conditions and types for both. |
| NFR-10 | **Maintainability** | Pure functions for parsing/script-gen (unit-testable without the binary); the binary is reached only through one `Backend` seam. |
| NFR-11 | **Observability** | Optional structured logging and debug capture of the exact command script and raw output. |
| NFR-12 | **Licensing** | MIT wrapper; GPL binaries isolated and compliant; SPDX metadata correct on every package. |

## 9. Scope

### In scope for v1.0
Core analysis (`analyze`) and polars (`polar`); viscous/inviscid, Re, Mach, Ncrit, forced transition, iterations; Cp + BL extraction; flap deflection; pure-TS geometry (NACA 4/5, `.dat` I/O, helpers); parsers; fluent + raw low-level APIs; per-platform prebuilt headless binaries; dual entry points; full docs/tests/CI/release.

### Deferred (see [Roadmap](ROADMAP.md))
Geometry & inverse design (GDES/MDES); multi-point/optimization helpers; worker pool + result cache; CLI; WebAssembly backend; bundled Orr-Sommerfeld custom databases; additional NACA series / CST / Bézier-PARSEC parameterizations.

### Out of scope
Browser-side solving in v1; reimplementing XFOIL physics; GUI/plotting; non-XFOIL tools.

## 10. Success metrics

- **Install success:** ≥ 99% of `npm install xfoil` → working `analyze()` across the supported matrix (measured in CI on every platform; community-reported install issues tracked).
- **Time-to-first-result:** A new user runs a NACA polar in < 5 minutes from `npm install` (validated by the README quickstart + an example).
- **Correctness:** Numerical results match a locally built reference XFOIL within tight tolerance on a golden-case suite (see [Engineering → Testing](ENGINEERING.md)).
- **Robustness:** Zero hangs in the integration matrix; non-convergence always surfaced as data.
- **Adoption (post-launch):** downloads/week, GitHub stars/issues resolution time; share of issues that are install-related trending to ~0.

## 11. Prior art / competitive landscape

- **Python wrappers** (e.g. `xfoil` on PyPI, `aeropy`, `xfoil-python`): assume a locally installed binary; no bundled cross-platform distribution; not usable from JS.
- **Hand-rolled child-process scripts:** common, fragile, undocumented, per-project.
- **NeuralFoil / surrogate models:** complementary (fast approximations), not a replacement for running XFOIL.
- **No established npm package** delivers XFOIL itself. The differentiators here: bundled headless binaries via the esbuild model, typed API with convergence reporting, and frontend-safe subpaths. (See [Roadmap](ROADMAP.md) for how a WASM backend could later subsume the binary.)

## 12. Risks & assumptions

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Headless static XFOIL build is harder than expected (X11/Xplot11 removal, modern gfortran) | High | Medium | **Phase 0 build spike** before committing the API; stub plot library; `-std=legacy -fallow-argument-mismatch`; document in [Binary Distribution](BINARY_DISTRIBUTION.md). |
| GPL compliance misstep | High | Low | Isolate binaries in separate GPL packages with license + written offer; legal-style review; mere-aggregation posture documented. |
| `@xfoil` npm scope/`xfoil` name unavailable at publish time | Medium | Low | `xfoil` is currently unpublished (verified 2026-06-15). Reserve name + scope early; fallbacks listed in [DECISIONS ADR-0009](DECISIONS.md). |
| Output-format drift across XFOIL versions | Medium | Low | Pin a known XFOIL version per release; tolerant parsers; fixtures from the pinned version. |
| Convergence/edge-case handling in automation | Medium | Medium | Explicit convergence reporting; optional ramp; raw escape hatch; large fixture suite. |
| Windows quirks (paths, line endings, process kill) | Medium | Medium | CI on Windows from day one; short temp filenames; normalize EOLs; `taskkill`-equivalent via `tree-kill` semantics. |
| Maintenance burden of 5+ binary packages | Medium | Medium | Fully automated build/release matrix; binaries change rarely (pin XFOIL version). |

**Assumptions:** XFOIL source remains GPL and buildable with gfortran; Node ≥ 20 in target environments; consumers running analysis have a Node runtime (server/CLI), not a pure browser.

## 13. Licensing & compliance (summary)

- Wrapper: **MIT**. Binary packages: **GPL-2.0-or-later** (XFOIL), distributed separately with full license text and source offer. Correct SPDX on each package. Attribution to Drela & Youngren prominent. Full treatment in [Binary Distribution → Licensing](BINARY_DISTRIBUTION.md#licensing--gpl-compliance) and [DECISIONS ADR-0003](DECISIONS.md). *(Good-faith summary; not legal advice — a licensing review is a launch checklist item.)*

## 14. Open questions

1. Exact glibc baseline for the Linux build (manylinux-style target?) — resolve in Phase 0.
2. Should `analyze` auto-ramp for convergence by default, or opt-in? (Lean: opt-in to stay faithful to XFOIL.)
3. Ship a tiny smoke-test binary invocation as an optional `postinstall --verify`, or keep install side-effect-free? Resolved for v1: keep install side-effect-free and provide `npx xfoil --doctor` for explicit verification.
4. Bundle ARM Windows / musl Linux in v1 or defer? (Lean: defer; document.)
5. Pin XFOIL 6.99 vs 6.996 for v1 (6.996 is newest as of 2026-01). (Lean: latest buildable; record in DECISIONS.)
