# Architecture Decision Records

Lightweight ADRs capturing the load-bearing decisions for `xfoil`. Each: context → decision → consequences. Status is **Accepted** unless noted.

---

## ADR-0001 — Execution model: drive the native XFOIL binary

**Context.** XFOIL is a Fortran program. We can (a) drive the native binary via child process, (b) compile it to WebAssembly, (c) ship only parsers/geometry, or (d) port the physics to TS.

**Decision.** v1 drives the **native binary** via `child_process`. Porting the solver (d) is infeasible/undesirable; parsers-only (c) doesn't meet the "run XFOIL from TS" goal; WASM (b) is high-effort and deferred (ADR-0007).

**Consequences.** Server/Node-only execution in v1. Requires per-platform binaries (ADR-0002) and careful process handling (ADR-0005). Full fidelity to real XFOIL.

---

## ADR-0002 — Binary delivery: per-platform optional dependencies (esbuild model)

**Context.** The product requirement is "`npm install xfoil` just works," with no compiler, no manual XFOIL install, and ideally no install-time network or postinstall scripts (works under `--ignore-scripts`, offline mirrors, corporate proxies).

**Decision.** Ship prebuilt binaries as **platform-specific packages** (`@xfoil/darwin-arm64`, `@xfoil/darwin-x64`, `@xfoil/linux-x64`, `@xfoil/linux-arm64`, `@xfoil/win32-x64`) declared as **`optionalDependencies`** of `xfoil`, each guarded by `os`/`cpu` fields so npm installs only the matching one. Resolution at runtime via `require.resolve("@xfoil/<platform>/xfoil")`. Alternatives — postinstall download, lazy first-run download — were rejected for adding install/runtime network failure modes.

**Consequences.** Best UX and offline behavior. Cost: a CI build matrix and 5+ published packages per release. Binaries change rarely (pinned XFOIL version), so churn is low. An `optionalDependencies` miss (npm bug/odd platform) must degrade to a clear error (ADR-0008) and an override (ADR-0006).

---

## ADR-0003 — Licensing: MIT wrapper, GPL binaries isolated and compliant

**Context.** XFOIL is GPL-2.0. We want the wrapper to be permissively licensed (MIT) for broad adoption, without violating the GPL.

**Decision.** The `xfoil` package and all TypeScript source are **MIT**. The XFOIL binaries are redistributed in **separate `@xfoil/<platform>` packages**, each licensed **GPL-2.0** with the full license text, copyright notice (Drela, Youngren), and a written offer of source (we also host the exact source + build scripts used). The wrapper invokes XFOIL as a **separate process** (fork/exec) — mere aggregation — so the MIT code is not a derivative work of XFOIL.

**Consequences.** Clean separation; consumers who only take the MIT wrapper's source aren't encumbered, but the installed binary remains GPL (as XFOIL always is). SPDX metadata set correctly per package. A licensing review is on the launch checklist. *(Good-faith engineering decision, not legal advice.)*

---

## ADR-0004 — Packaging: dual entry points, browser-safe subpaths, ESM+CJS

**Context.** The package must serve a Node backend *and* be importable in a React/Vite/Next client without dragging `node:child_process` into the browser bundle.

**Decision.** Three public entry points via the `exports` map:
- `xfoil` — full API, **Node-only** (execution + geometry + parsers re-exported).
- `xfoil/geometry` — **pure TS, browser-safe** (NACA, `.dat` I/O, `Airfoil`).
- `xfoil/parsers` — **pure TS, browser-safe** (file parsers).

Pure-TS modules never import Node built-ins. Ship dual **ESM + CJS** with correct `types`/`import`/`require` (and `browser`) conditions. `sideEffects: false`. A CI check fails the build if a `node:`/`child_process` reference leaks into the browser-safe subpaths.

**Consequences.** One install serves both runtimes. Slightly more build config (tsup multi-entry). Strong guarantee against accidental Node leakage.

---

## ADR-0005 — Headless, isolated, bounded execution

**Context.** XFOIL links X11 (Xplot11) and is an interactive REPL; naive automation hangs (plot windows, "hit return" pauses, file-overwrite prompts) and pollutes the CWD.

**Decision.** (1) Build XFOIL **headless** — replace Xplot11 with a no-op stub at compile time so there is no X11 dependency and no plotting at all (ADR in [Binary Distribution](BINARY_DISTRIBUTION.md)). Also defensively issue `PLOP`/graphics-off in scripts. (2) Run each invocation in a **private temp directory** as CWD with **unique filenames**, so overwrite prompts never occur and concurrent runs don't collide. (3) Feed the full command script to stdin and end it; **bound** every run with `timeoutMs` and a guaranteed kill + cleanup.

**Consequences.** No hangs, safe concurrency, reproducible runs. Requires a custom build (worth it). Temp-dir lifecycle must be robust on throw/timeout.

---

## ADR-0006 — Binary resolution precedence & override

**Context.** Users may want their own XFOIL build (custom version, patched, exotic platform).

**Decision.** Resolve in order: (1) explicit `binaryPath` constructor option, (2) `XFOIL_BINARY_PATH` env var, (3) installed `@xfoil/<platform>` package, (4) (documented, opt-in) a binary on `PATH`. First hit wins.

**Consequences.** Power users and unusual platforms aren't blocked; default path stays zero-config.

---

## ADR-0007 — WebAssembly backend is deferred behind a `Backend` seam

**Context.** A browser-side WASM XFOIL would be powerful but is a large, risky build effort (Emscripten + LAPACK + plot stubs + filesystem shimming) and isn't required for v1's use cases (analysis is server-side).

**Decision.** Define a minimal `Backend` interface (`run(script, files) → { stdout, files }`) and implement only `NodeNativeBackend` in v1. A `WasmBackend` can be added later **without changing the public API**.

**Consequences.** Small upfront abstraction cost; large future optionality. Keeps v1 focused.

---

## ADR-0008 — Errors are typed and discriminable; failures surface as data where they are data

**Context.** XFOIL fails in distinct ways: binary missing, process timeout/crash, non-convergence, bad geometry.

**Decision.** A small error hierarchy (`XFoilError` → `XFoilBinaryNotFoundError`, `XFoilTimeoutError`, `XFoilProcessError`, `XFoilParseError`, `XFoilInputError`). **Non-convergence is not an error** — it is reported as data (`converged: false`, `polar.failed[]`), because a partially converged polar is a valid, useful result.

**Consequences.** Consumers can `catch` precisely and branch on convergence without try/catch. Predictable control flow.

---

## ADR-0009 — Naming & versioning

**Context.** The user wants the package to be `xfoil`. Verified unpublished on npm 2026-06-15; re-check with `pnpm check:npm-names` before reserving/publishing because registry state can change.

**Decision.** Publish the wrapper as **`xfoil`**; binaries under the **`@xfoil`** scope. Reserve both immediately. Fallbacks if unavailable at publish: wrapper `xfoil-ts` / `node-xfoil`; scope `@xfoil-ts/*`. Use **semantic versioning** with **Changesets**; binary packages are versioned in lockstep with a documented XFOIL-version field in their metadata. npm publishes use **provenance**.

**Consequences.** Memorable install (`npm i xfoil`). Lockstep versioning keeps wrapper/binary compatibility simple.

---

## ADR-0010 — Tooling: pnpm monorepo, tsup, Vitest, GitHub Actions

**Context.** We have one TS package, several binary packages, shared build scripts, and a cross-platform test/build need.

**Decision.** **pnpm workspaces** monorepo; **tsup** for ESM+CJS+`.d.ts`; **Vitest** for unit tests (+ integration tests gated on a present binary); **GitHub Actions** for the build-binaries matrix, the test matrix, and Changesets-driven publish. **Biome** (or ESLint+Prettier) for lint/format; **typedoc** for API docs.

**Consequences.** Standard, well-supported toolchain; minimal custom glue. Contributors get a familiar setup.
