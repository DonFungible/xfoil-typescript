# Binary Distribution

How `npm install xfoil` ends up with a working, headless XFOIL executable — and how that stays GPL-compliant. The Phase 0 spike has validated XFOIL 6.99 on macOS arm64; cross-platform artifact validation remains the release gate (see [Roadmap](ROADMAP.md)).

## 1. Goals

1. **Self-contained binaries** — no X11, no display, no `gfortran` runtime, no external data files. Run on a bare server/container.
2. **Frictionless delivery** — the right binary installs automatically via `npm install xfoil`, offline-safe, no postinstall network, no compiler.
3. **GPL-compliant** — XFOIL is GPL-2.0-or-later; we redistribute binaries lawfully and keep the MIT wrapper unencumbered.
4. **Reproducible** — pinned XFOIL version + pinned toolchain + scripted build, identical artifacts from CI.

## 2. The headless build (the crux)

XFOIL links **Xplot11**, an X11-based plotting library. A stock build depends on `libX11` and will try to open a display — fatal or hang-prone on servers. Two parts solve this:

### 2.1 Stub the plot library
Replace Xplot11 with a **no-op stub** that satisfies every symbol XFOIL calls (`PLINIT`, `PLOT`, `PLFLUSH`, `NEWPEN`, `PLCHAR`, `GETCOLOR`, …) with empty Fortran subroutines. XFOIL then links and runs with **zero graphics and zero X11 dependency**; all plotting calls become inert. The driver additionally sends `PLOP`/`G F` (defense in depth).

- The exact XFOIL 6.99 symbol set is committed in `build/stub-plotlib/stub.f`; `scripts/build-xfoil-binary.mjs` re-enumerates unresolved symbols during every build and fails if the stub drifts.
- Build XFOIL against the stub instead of `libPlt`/`libXplot11`.
- *(Fallback if stubbing proves incomplete: build real Xplot11 but force the "no display" path and statically link, accepting an `libX11` dependency only as a last resort — strongly preferred to avoid.)*

### 2.2 Modern gfortran patches
XFOIL is Fortran 77 with argument-mismatch patterns that **gfortran ≥ 10 rejects by default**. Build with:
```
FFLAGS = -O2 -fdefault-real-8 -std=legacy -fallow-argument-mismatch
```
Keep any source patches in `build/patches/` (minimal, documented, applied to the pinned tarball). XFOIL 6.99's provided gfortran makefile uses the double-precision build path, so the scripted build keeps `-fdefault-real-8`.

### 2.3 Static, self-contained linking
Statically link the GCC Fortran runtime so target machines need no `gfortran`:
```
LDFLAGS = -static-libgfortran -static-libgcc -static-libquadmath   # Linux/Windows
```
- **Linux:** prefer a near-fully-static binary (`-static` where viable) built against an **old glibc baseline** (manylinux-style container) so it runs on a wide range of distros. Verify with `ldd` (ideally "not a dynamic executable" or only `linux-vdso`).
- **macOS:** static system libs aren't allowed; statically link the **gfortran runtime** only. Verify with `otool -L` that nothing beyond system frameworks remains.
- **Windows:** mingw-w64 gfortran; `-static` to fold in `libgfortran`/`libquadmath`/`libwinpthread`. Verify with `Dependencies`/`dumpbin`.

### 2.4 Runtime data
Confirm in the spike that the pinned XFOIL needs **no external data file** at runtime (the Orr-Sommerfeld / e^n database should be compiled in). If any data file is required, **bundle it inside the binary package** and point XFOIL at it via CWD/temp staging. Self-containment is a release gate.

## 3. Build matrix & toolchains

| Package | OS | Arch | CI runner | Toolchain |
| --- | --- | --- | --- | --- |
| `@xfoil/linux-x64` | linux | x64 | ubuntu + old-glibc container | gfortran in manylinux-style image |
| `@xfoil/linux-arm64` | linux | arm64 | arm64 runner (or QEMU) | gfortran |
| `@xfoil/darwin-arm64` | darwin | arm64 | macos-14 (arm64) | Homebrew gcc/gfortran |
| `@xfoil/darwin-x64` | darwin | x64 | macos-15-intel (x64) | Homebrew gcc/gfortran |
| `@xfoil/win32-x64` | win32 | x64 | windows-latest or cross | mingw-w64 gfortran |

The build entry point is `scripts/build-xfoil-binary.mjs`, invoked by `.github/workflows/build-binaries.yml`. It verifies the upstream archive SHA-256 (`5c0250643f52ce0e75d7338ae2504ce7907f2d49a30f921826717b8ac12ebe40`), compiles against `build/stub-plotlib/stub.f`, runs smoke/golden/self-containment gates, and stages `packages/binaries/<platform>/`.

Release metadata is checked by `scripts/verify-release-metadata.mjs`; staged binary packages are checked by `scripts/verify-binary-packages.mjs`; tarball installs are checked by `scripts/smoke-packed-install.mjs`; and published registry installs are checked by `scripts/smoke-published-install.mjs`.

## 4. Acceptance gates per binary (before publish)

Every built binary must pass, in CI, on its target OS:
1. **Smoke run (headless):** drive a NACA 0012 viscous polar with **no DISPLAY set**; assert a non-empty, parseable polar file and expected column count.
2. **Numerical golden check:** compare Cl/Cd/Cm at the committed cases in `build/golden/xfoil-6.99.json` within tolerance (`|ΔCl| < 1e-3`, `|ΔCd| < 1e-4`, `|ΔCm| < 1e-3`) — guards against a miscompiled solver.
3. **Self-containment:** `ldd`/`otool -L`/dependency scan shows no disallowed dynamic deps; no `libX11`.
4. **No-hang:** the run completes well under the timeout (no plot/prompt stalls).
5. **Exec bit / launchability:** binary is executable and reports a version banner.

A binary that fails any gate blocks the release.

## 5. Packaging the binaries

Each `@xfoil/<platform>` package:
```jsonc
// @xfoil/linux-x64/package.json
{
  "name": "@xfoil/linux-x64",
  "version": "1.0.0",
  "description": "Prebuilt headless XFOIL binary for linux-x64 (GPL-2.0).",
  "license": "GPL-2.0-or-later",
  "os": ["linux"],
  "cpu": ["x64"],
  "files": ["xfoil", "LICENSE", "SOURCE_OFFER.md", "VERSION", "README.md"],
  "xfoilVersion": "6.99"
}
```
- `os`/`cpu` → npm installs only the matching optional dependency; others are skipped silently.
- `files` includes the binary plus the GPL compliance set (§7).
- The executable bit is set in the artifact; the resolver also `chmod +x`'s defensively at first use (npm has historically been inconsistent about preserving mode).
- Placeholder packages with `xfoilVersion: "pending"` are release-blocking; `scripts/verify-binary-packages.mjs` rejects them before publish.
- Each binary package has a `prepublishOnly` guard that verifies its own staged artifact. The wrapper package has a `prepublishOnly` guard that verifies release metadata and all binary packages, so `xfoil` cannot publish until every `@xfoil/*` artifact has been staged and checked.

The wrapper declares them all as `optionalDependencies` (see [Architecture §10](ARCHITECTURE.md#10-packaging--build-outputs)).

## 6. Resolution & overrides (runtime)

`resolve-binary.ts` order (first hit wins):
1. `new XFoil({ binaryPath })` / per-call `binaryPath`.
2. `XFOIL_BINARY_PATH` env var.
3. `require.resolve("@xfoil/${platform}-${arch}/xfoil[.exe]")`.
4. (Opt-in, documented) `xfoil` on `PATH`.

If nothing resolves → `XFoilBinaryNotFoundError` with `{ platform, searched[] }` and remediation text (set `XFOIL_BINARY_PATH`, supported-platform list, docs link). This is the graceful path for unsupported platforms (e.g. musl, win-arm64 in v1) and lets advanced users supply their own build.

**`npx xfoil --doctor`** prints platform, expected platform package, resolved binary path, XFOIL version, searched locations, and a NACA 0012 smoke-test result for support triage. Add `--json` for machine-readable output.

## 7. Licensing & GPL compliance

> Good-faith engineering summary, **not legal advice**. A licensing review is a launch-checklist gate.

XFOIL is **GPL-2.0-or-later** (Mark Drela, Harold Youngren). Strategy:

1. **Separation.** The wrapper (`xfoil`, MIT) contains **no XFOIL code** and **no binary**. It invokes XFOIL as a **separate process** via `spawn` (fork/exec). Under the FSF's long-standing position, two programs communicating "at arm's length" via exec/pipes are **separate works** (mere aggregation); the MIT wrapper is therefore **not a derivative** of XFOIL. The wrapper imposes no link-time dependency on GPL code.
2. **Binaries are GPL, and labeled so.** Each `@xfoil/<platform>` package is **`GPL-2.0-or-later`** in its `license` field (confirm `-only` vs `-or-later` from the pinned source headers in Phase 0) and includes the **full GPL text** (`LICENSE`) and the **copyright notice** (Drela, Youngren).
3. **Source availability (GPL §3).** Redistributing a binary obliges us to provide the corresponding source. We satisfy this by:
   - Pinning the exact upstream XFOIL 6.99 archive URL and SHA-256 in the build script, plus committing the plot stub and any future patches in this repo, and
   - Shipping `SOURCE_OFFER.md` in every binary package with the precise upstream version, source checksum, our repo URL, the release git tag/commit, and a written offer to provide the source on request for ≥ 3 years.
4. **No added restrictions.** We don't relicense or restrict XFOIL; users retain all GPL rights to the binary and its source.
5. **Attribution.** Prominent credit to Drela & Youngren in README and each binary package; a clear "independent wrapper, not affiliated with/endorsed by the authors or MIT" notice.
6. **SPDX correctness.** `xfoil` → `MIT`; `@xfoil/*` → `GPL-2.0-or-later`. Root repo dual-noted.

Why a separate package (not bundling the binary into `xfoil`): it keeps the GPL artifact cleanly delineated, makes the license boundary obvious to tooling and auditors, and lets the MIT wrapper be vendored/copied by users without dragging GPL bits along.

## 8. Versioning the binaries

- Binary packages carry an `xfoilVersion` field and are **versioned in lockstep** with the wrapper (ADR-0009): a wrapper `x.y.z` depends on `@xfoil/* @ x.y.z`.
- Bumping the pinned XFOIL version is a deliberate, minor/major release with refreshed fixtures and golden checks.
- The wrapper validates at runtime (once) that the resolved binary's reported version is within the supported range and warns (not throws) on mismatch when a user-supplied `binaryPath` is used.

## 9. Risks specific to the build

| Risk | Mitigation |
| --- | --- |
| Plot-stub misses a symbol → link error | Enumerate symbols from `plotlib` in spike; CI link step catches regressions. |
| macOS static gfortran runtime issues | Pin Homebrew gcc; verify `otool -L`; gate on self-containment check. |
| glibc-too-new on Linux → runtime errors on older hosts | Build in old-glibc (manylinux-style) container; document baseline. |
| Windows pthread/runtime DLLs leak | `-static` with mingw-w64; dependency scan gate. |
| Miscompiled solver (wrong numbers, no crash) | Numerical golden check gate (§4.2). |
| Upstream source moves/changes URL | Vendor the exact tarball in-repo per release tag. |
| GPL "or-later" vs "only" mislabel | Read source headers in Phase 0; set SPDX accordingly; legal review. |
