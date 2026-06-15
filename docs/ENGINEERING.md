# Engineering: Testing, CI/CD, Release, Security

Operational plan for building, verifying, and shipping `xfoil`. See [Architecture](ARCHITECTURE.md) for module structure and [Binary Distribution](BINARY_DISTRIBUTION.md) for the binary build matrix.

## 1. Testing strategy

A three-tier pyramid. The point of the pure-core architecture is that **most logic is testable without a binary**, so CI is fast and contributors are productive offline.

### 1.1 Unit tests (no binary) — the bulk
Run everywhere, every PR, in milliseconds. Cover the deterministic core:

- **Command builders (`commands.ts`)** — assert the exact `string[]` produced for representative plans (single point, polar range, polar list, inviscid, viscous + VPAR, flap, loaded coords, repanel). Locks the XFOIL interaction contract.
- **Parsers (`parsers/*`)** — golden fixtures captured from the real binary: polar (viscous & inviscid), Cp (viscous & inviscid), BL dump, Selig `.dat`, Lednicer `.dat`. Plus adversarial inputs: `*****` overflow, spaced sci-notation, missing trailing newline, CRLF, extra header whitespace, empty polar (all failed). Assert exact parsed values.
- **Geometry (`geometry/*`)** — NACA 4/5 coordinates vs reference points (closed loop, LE/TE, symmetry for 00xx); `.dat` round-trip (`fromDat(toDat(x)) ≈ x`); `normalize`/`repanel` invariants (chord, point count, monotonic x on each surface).
- **Orchestration (`core/run.ts`, `xfoil.ts`)** — with an injected **`FakeBackend`** returning canned files: verify analyze/polar assemble correct results, compute `failed[]`, honor options, route errors. No process involved.
- **Resolution (`resolve-binary.ts`)** — precedence order with mocked fs/env; correct `XFoilBinaryNotFoundError` content.
- **Backend process control (`NodeNativeBackend`)** — deterministic stalled-process fixture verifies timeout and process-tree kill behavior without relying on XFOIL to hang.
- **Errors** — each error type constructed and discriminable; non-convergence is *not* thrown.

### 1.2 Integration tests (real binary) — gated
Tagged `*.int.test.ts`, skipped automatically when no binary resolves (`describe.skipIf(!binary)`), so local runs without a build still pass. In CI they run on each platform **after** that platform's binary is built.

- Round-trip a NACA 2412 viscous polar; assert monotonic-ish Cl(α), plausible Cd, presence of expected α.
- Single point with `cp` + `boundaryLayer`; assert array shapes and physical sanity (Cp = 1 near stagnation; θ ≥ 0).
- Loaded custom `.dat`; inviscid vs viscous; forced transition shifts `topXtr`.
- Convergence reporting: a deliberately hard high-α case yields `failed[]` entries without throwing.
- Concurrency: run N polars in parallel; assert isolation (no file collisions, all succeed).
- Timeout escalation through `XFoil.analyze`/`polar`: covered with backend-level timeout tests plus orchestration tests for `XFoilTimeoutError`.

### 1.3 Numerical golden tests (regression)
A committed table of `(airfoil, Re, Mach, α) → {cl, cd, cm}` reference values lives in `build/golden/xfoil-6.99.json`. `scripts/build-xfoil-binary.mjs` runs it in the binary build pipeline (see [Binary Distribution §4](BINARY_DISTRIBUTION.md#4-acceptance-gates-per-binary-before-publish)) to catch a miscompiled solver. Tolerances: `|ΔCl| < 1e-3`, `|ΔCd| < 1e-4`, `|ΔCm| < 1e-3`.

### 1.4 Packaging tests
- **Purity guard:** a script (in CI) bundles `xfoil/geometry` and `xfoil/parsers` with a browser-target bundler and **fails if any `node:`/`child_process` symbol appears** in the output. Also a static lint rule forbidding `node:` imports under `geometry/**` and `parsers/**`.
- **Exports/`attw`:** run `@arethetypeswrong/cli` and `publint` to verify `exports`, `types`, ESM/CJS resolution, and that all three entry points resolve under `node`, `bundler`, and `browser` conditions.
- **Install smoke (E2E):** in a clean container, `npm pack` the wrapper + a binary package, install the tarballs, and run a real `analyze()` — proves the optional-dependency resolution path end to end.

### 1.5 Coverage & quality bars
- Coverage gate on the pure core (target ≥ 90% lines for `commands`, `parsers`, `geometry`, `core`). Backend/process code is covered by integration tests, not line-coverage gated.
- Type-level tests (`tsd` or `expectTypeOf`) for the public API (discriminated unions, `alpha` xor `cl`).
- Tooling: **Vitest** (unit + integration), **Biome** (lint+format) or ESLint+Prettier, **tsc --noEmit** typecheck, **typedoc** API docs.

## 2. CI/CD (GitHub Actions)

### 2.1 `ci.yml` — every PR/push
```
matrix: { os: [ubuntu, macos, windows], node: [20, 22, 24] }
steps:
  - pnpm install
  - typecheck (tsc --noEmit)
  - lint (biome ci)
  - unit tests (vitest run)            # no binary needed
  - tooling tests (executable header inspector)
  - build (tsup)
  - publint + attw                     # packaging correctness
  - purity guard (browser bundle check)
  - integration tests IF a binary is available for the runner
```
Fast path (unit + packaging) runs without any binary, so PRs are quick.

### 2.2 `build-binaries.yml` — on demand / release
The per-platform matrix from [Binary Distribution §3](BINARY_DISTRIBUTION.md#3-build-matrix--toolchains). For each target: fetch pinned source → apply patches → build with stub plotlib → **run acceptance gates** (smoke, golden, self-containment, no-hang) → upload the executable as an artifact → stage into `packages/binaries/<platform>/`. Cached by `(xfoilVersion, toolchain, patches)` hash so binaries rebuild only when inputs change.

### 2.3 `release.yml` — publish
- **Changesets** drives versioning and changelog. A merged "Version Packages" PR triggers publish.
- The release workflow first runs the full binary build matrix, verifies each staged `@xfoil/<platform>` package with `scripts/verify-binary-packages.mjs`, and downloads those artifacts into the publish job.
- Publish order: `@xfoil/*` binary packages first, then `xfoil` (so the wrapper's `optionalDependencies` resolve).
- Package-level `prepublishOnly` guards repeat the critical checks: every binary package verifies its own staged executable, including portable Mach-O/ELF/PE OS+CPU header checks, and the wrapper verifies release metadata plus all binary packages. A local wrapper publish fails while any binary package is still `pending`.
- `scripts/verify-workflows.mjs` checks workflow target matrices, runner mappings, allowed action refs, release artifact download paths, and critical publish/smoke commands against the shared `scripts/xfoil-targets.mjs` target map.
- Changesets publish with npm provenance enabled through OIDC (`NPM_CONFIG_PROVENANCE=true`) for every package.
- Post-publish: `scripts/smoke-published-install.mjs` runs against the *published* packages on every supported OS; a failure triggers a deprecate/rollback runbook.
- Tag the repo with the XFOIL source snapshot used (GPL §3 compliance).

### 2.4 Branch & PR hygiene
- Trunk-based; PRs require green `ci.yml` + review.
- Conventional commits feeding Changesets.
- `CODEOWNERS`, PR template (checklist: tests, docs, changeset), issue templates (bug needs platform + Node + `--doctor` output).

## 3. Release process & versioning

- **SemVer.** Public API in [API.md](API.md) is the contract. Breaking changes → major. Pinned-XFOIL bump → at least minor (results can shift), documented in the changelog with a migration note if numerics move.
- Wrapper and `@xfoil/*` versioned **in lockstep** (ADR-0009); `xfoil@x.y.z` depends on `@xfoil/* @ x.y.z`.
- Pre-1.0: `0.x` betas during the build spike + API validation. `1.0.0` only after all platforms pass acceptance gates and the licensing review is signed off.
- **Deprecation policy:** one minor-version warning window before removing/renaming public API.
- **Changelog:** generated by Changesets; human-curated highlights per release.

## 4. Security

| Area | Control |
| --- | --- |
| **Command injection** | XFOIL commands are built from typed inputs by `commands.ts`; numeric fields are formatted, not concatenated from strings. The `raw()` escape hatch is explicitly caller-controlled and documented as such. |
| **Shell avoidance** | `spawn(binary, args, { shell: false })` — never `exec`/shell strings. No user data reaches a shell. |
| **Path/filename safety** | Output filenames are library-generated (unique, alphanumeric) inside a private `mkdtemp` dir; user-supplied `datPath` is read by us and rewritten to a safe temp name. Reject filenames with separators/whitespace in any path that reaches XFOIL. |
| **Resource bounds** | Hard `timeoutMs` with process-tree kill; no unbounded buffering (cap captured stdout, stream to logger). Document that untrusted geometry can still make XFOIL spin — the timeout is the backstop. |
| **Temp-dir lifecycle** | Created per run, removed in `finally` (success/throw/timeout/abort); `keepFiles` is opt-in and logged. |
| **Supply chain** | npm provenance enabled through OIDC; pinned, vendored XFOIL source; lockfile committed; Dependabot/renovate on dev deps; minimal runtime deps (ideally zero). |
| **Untrusted input posture** | Documented threat model: the library is safe to call with untrusted *numeric* parameters and *coordinate* data under the timeout; running fully attacker-controlled raw command scripts is the caller's responsibility. |
| **Binaries integrity** | Built only in CI from pinned source; provenance attestation; checksums recorded per release. |

## 5. Documentation deliverables

- **README** (quickstart, feature matrix, license) — done.
- **API docs** via TypeDoc, published to GitHub Pages by `.github/workflows/docs.yml`.
- **Examples**: `node-basic`, `batch-sweep`, `nextjs-app` (server action + client geometry).
- **Guides**: "Custom airfoils", "Understanding convergence & `failed`", "Using your own XFOIL build", "Browser-safe geometry" — done.
- **CONTRIBUTING.md**: monorepo setup, how to run unit tests without a binary, how to build a local binary for integration tests.
- **SECURITY.md**, **CODE_OF_CONDUCT.md**, issue/PR templates.

## 6. Definition of Done (per feature)
A feature is done when: types in [API.md](API.md) implemented; unit tests (incl. fixtures) green; integration test added if it touches the binary; docs + example updated; changeset added; purity guard still green; `publint`/`attw` clean.
