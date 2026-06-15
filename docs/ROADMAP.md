# Roadmap

Phased plan from zero to a published, open-source `xfoil@1.0.0`, then beyond. The TypeScript wrapper and the macOS arm64 headless binary spike are implemented. The remaining release gate is validating/staging every supported platform artifact in CI — if a platform proves infeasible, scope and platform support adjust before publishing 1.0.

**Current alpha status (2026-06-15):** monorepo tooling, the `xfoil` wrapper package, pure geometry/parsers, Node backend, binary resolver, command builders, `raw()`/`session()`, examples, package checks, launch guides, a reproducible XFOIL 6.99 builder, the exact plotlib stub, a staged `@xfoil/darwin-arm64` binary, packed-install/published-install smoke tooling, TypeDoc/GitHub Pages workflow, Changesets publish with npm provenance enabled, package-level `prepublishOnly` safety guards, shared target metadata, and workflow consistency verification are implemented. Real-binary integration tests now cover Darwin arm64 polar/Cp/BL, explicit `PPAR`, forced transition, flap via `GDES`, alpha ramping, failed-point reporting, concurrent solver isolation, and single-point/sequence Cl solves. Backend timeout handling is covered by a deterministic process test. Cross-platform binary artifacts, remote all-OS validation, a full release dry run, and licensing review remain open.

Effort is rough relative sizing (S/M/L), not calendar commitments.

## Phase 0 — Build spike & feasibility (gate) · L

**Goal:** prove we can produce a self-contained, headless XFOIL binary and pin the interaction contract. Nothing else starts until this is green.

- [x] Pin XFOIL 6.99 source by URL + SHA-256; record license version from headers (`GPL-2.0-or-later`).
- [ ] Build on Linux with gfortran + `-fallow-argument-mismatch -std=legacy`; capture needed patches.
- [x] Enumerate Xplot11 symbols; implement `stub-plotlib`; link headless; confirm **no libX11**, no display needed on macOS arm64.
- [x] Statically link gfortran runtime on macOS arm64; verify self-containment (`otool -L` shows only `libSystem`).
- [x] Smoke-run a NACA 0012 polar headless; add gated integration tests for polar, Cp, and BL.
- [ ] Complete the remaining open questions in [XFOIL Reference §7](XFOIL_REFERENCE.md#7-phase-0-validation-checklist) (cross-platform prompt repeats; Darwin arm64 prompt order, CPWR/DUMP shapes, unreachable Cl behavior, and inviscid polar shape are validated).
- [ ] Reproduce the build on Linux, macOS x64, and Windows (mingw-w64); note per-platform deltas.

**Exit criteria:** a headless binary on ≥ Linux+macOS that passes the [acceptance gates](BINARY_DISTRIBUTION.md#4-acceptance-gates-per-binary-before-publish), plus committed fixtures. **If blocked:** evaluate fallbacks (real Xplot11 + static X11; xvfb is rejected for portability) and adjust platform matrix.

## Phase 1 — Pure-TS core (no binary) · M

Buildable and fully testable offline; ships value to the browser immediately.

- [x] Monorepo scaffold (pnpm, tsconfig.base, tsup, Vitest, Biome) per [Architecture §11](ARCHITECTURE.md#11-repository-layout-pnpm-monorepo).
- [x] `geometry`: `Airfoil`, NACA 4 (then 5), `.dat` Selig/Lednicer parse + serialize, normalize/repanel/metrics.
- [x] `parsers`: `parsePolar`, `parseCp`, `parseDump`, `parseCoordinates`, `parseFortranNumbers` — implemented against synthetic fixtures and exercised by gated real-binary integration tests.
- [x] `errors`, `types`.
- [x] Unit tests + purity guard + `publint`/`attw` green for `xfoil/geometry` and `xfoil/parsers`.

**Exit:** `xfoil/geometry` and `xfoil/parsers` are publishable, browser-safe, ≥ 90% covered.

## Phase 2 — Execution core (Node) · M

- [x] `Backend` interface + `NodeNativeBackend` (spawn, temp dir, stdin script, timeout, tree-kill, file collection).
- [x] `resolve-binary` (option → env → `@xfoil/*` → PATH) + `XFoilBinaryNotFoundError`.
- [x] `commands.ts` builders (single point, polar range/list, inviscid/viscous, VPAR, flap, loaded coords, repanel) — unit-tested as `string[]`.
- [x] `XFoil.analyze` / `polar` / `version` / `isAvailable` orchestration.
- [x] `FakeBackend` + orchestration unit tests.
- [x] Integration tests (gated) against the Phase 0 binary.
- [x] Convergence/`failed[]` logic; Cp + BL capture.

**Exit:** `analyze` and `polar` work end-to-end on a local binary; integration suite green on Linux+macOS.

## Phase 3 — Low-level parity & polish · S

- [x] `raw()` escape hatch (+ output-file collection).
- [x] Fluent `session()` / `OperSession` over `raw()` + parsers.
- [x] Flap, forced transition, ramp option, and single-point Cl behavior finalized against the staged Darwin arm64 binary.
- [x] `logger`/debug capture (`script`, `stdout`, lifecycle events); `keepFiles`.
- [x] Input validation + `XFoilInputError` coverage.

**Exit:** feature matrix for v1 complete; type-level tests for the public API pass.

## Phase 4 — Binary packaging & CI/CD · L

- [x] `build-binaries.yml` matrix (linux x64/arm64, darwin arm64/x64, win32 x64) with scripted build, staging, integration tests, and artifacts; remote validation pending.
- [x] `@xfoil/<platform>` packages (os/cpu, GPL `LICENSE`, `SOURCE_OFFER.md`, `VERSION`) scaffolded.
- [x] Wire `optionalDependencies`; runtime resolution verified for missing-binary fallback and staged `@xfoil/darwin-arm64` locally.
- [x] `npx xfoil --doctor` support command with JSON mode and real-binary smoke test.
- [x] `ci.yml` (unit + packaging on all OS/Node; integration where a binary exists).
- [x] Packed-install smoke script (`pnpm smoke:packed-install`) for wrapper + platform tarballs; remote all-OS validation pending in the binary matrix.
- [x] `release.yml`: binary matrix gates, staged artifact assembly, Changesets lockstep versioning, and npm provenance config; live dry-run/publish validation pending.

**Exit:** a dry-run release publishes to a test registry and `npm install xfoil` → working `analyze()` on every supported platform.

## Phase 5 — Docs, examples, launch · M

- [x] TypeDoc API generation + GitHub Pages workflow.
- [x] Launch guides (convergence, custom airfoils, BYO binary, browser geometry).
- [x] Examples: `node-basic`, `batch-sweep`, `nextjs-app`.
- [x] CONTRIBUTING / SECURITY / CoC / templates / CODEOWNERS.
- [ ] **Licensing review sign-off** (GPL compliance, SPDX, source offer, attribution).
- [ ] Reserve `xfoil` + `@xfoil` on npm; publish `1.0.0`.
- [ ] Announce (README badges, a short writeup, relevant communities).

**Exit:** `xfoil@1.0.0` live on npm with green CI, docs site, and examples.

## Post-1.0

### v1.1 — Geometry & inverse design · L
- [ ] `GDES` operations (camber/thickness scaling, TE gap, blending) via geometry session.
- [ ] `MDES` mixed-inverse / full-inverse surface-speed design.
- [ ] Richer `Airfoil` ops (CST / Bézier-PARSEC parameterization, blend two airfoils).

### v1.2 — Throughput & ergonomics · M
- [ ] `XFoilPool` (bounded concurrency) for large sweeps.
- [ ] Result caching (keyed by airfoil+conditions).
- [ ] Polar CLI: `npx xfoil polar --naca 2412 --re 1e6 ...`.
- [ ] Streaming polar results (emit points as they converge).

### v1.3+ — Reach & extras · L
- [ ] Additional platforms: linux musl, win-arm64, linux-armv7.
- [ ] `WasmBackend` exploration (browser-side solving behind the existing `Backend` seam; ADR-0007) — would let `analyze`/`polar` run with no server.
- [ ] Optional bundled standard-airfoil database (UIUC) behind a separate data package.
- [ ] Hinge-moment, multi-Re polar grids, drag-polar fitting helpers.

## Versioning summary

| Version | Contents |
| --- | --- |
| `0.x` | Pre-release during Phase 0–4; API may move. |
| `1.0.0` | Core analysis + polars, Cp/BL, geometry, parsers, low-level APIs, 5 platforms, full docs. |
| `1.1` | GDES/MDES design. |
| `1.2` | Pool, cache, CLI, streaming. |
| `1.3+` | More platforms, WASM backend, data packages, analysis helpers. |

Wrapper and `@xfoil/*` binaries are released in lockstep; a pinned-XFOIL-version bump is at least a minor release with refreshed fixtures and a changelog note if numerics shift.
