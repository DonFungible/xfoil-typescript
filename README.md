# xfoil

> Run [XFOIL](https://web.mit.edu/drela/Public/web/xfoil/) — Mark Drela's classic subsonic airfoil analysis and design code — from TypeScript. The wrapper, parsers, geometry helpers, package tooling, and a headless XFOIL 6.99 binary builder are implemented.

```ts
import { XFoil } from "xfoil";

const xf = new XFoil();

const polar = await xf.polar({
  airfoil: { naca: "2412" },
  reynolds: 1_000_000,
  mach: 0.1,
  alpha: { start: -5, end: 15, step: 0.5 },
});

console.log(polar.points[0]); // { alpha: -5, cl: -0.31, cd: 0.0061, cm: -0.06, ... }
```

---

> [!IMPORTANT]
> **Current alpha status:** the TypeScript package is implemented and passes `pnpm check`, including typecheck, lint, unit tests, ESM/CJS build, `publint`, and Are The Types Wrong. A reproducible headless XFOIL 6.99 build script now stages a self-contained `@xfoil/darwin-arm64` binary, and integration tests pass against it. The remaining 1.0 release gate is validating/staging the other platform artifacts in CI plus final licensing review. On platforms without a staged package yet, solver calls can still use `new XFoil({ binaryPath })`, `XFOIL_BINARY_PATH`, or `allowPathLookup: true` with a system `xfoil`. `xfoil/geometry` and `xfoil/parsers` work without any binary.

---

## Why

XFOIL is the de-facto standard for low-speed airfoil analysis — but it is an interactive Fortran program from the 1980s driven by a text menu and X11 plots. Using it from a modern app means shelling out to a binary the user had to compile, scripting its stdin by hand, and scraping fixed-width output files. This library makes XFOIL a first-class TypeScript citizen:

- **Zero-friction install.** Prebuilt, headless, dependency-free XFOIL binaries ship as platform-specific optional dependencies (the [esbuild model](https://github.com/evanw/esbuild/blob/main/npm/esbuild/package.json)). `npm install xfoil` pulls only the binary for your OS/CPU. No `gfortran`, no X11, no `make`.
- **Identical capability.** Everything you can do in an XFOIL `OPER` / `GDES` session, you can do here — single-point analysis, polar sweeps, pressure distributions, boundary-layer dumps, NACA generation, flap deflection — plus a raw command escape hatch for parity with anything the high-level API doesn't cover.
- **Idiomatic & typed.** Promise-based, fully typed inputs and outputs, structured results instead of fixed-width text. Convergence is reported, not guessed.
- **Frontend-safe.** The pure-TypeScript geometry and parser modules import cleanly in a browser bundle (`xfoil/geometry`, `xfoil/parsers`) so a React app can render and validate airfoils on the client while analysis runs on the server.

## Install

```sh
npm install xfoil      # once published; or pnpm add xfoil / yarn add xfoil / bun add xfoil
```

In the final release, the matching prebuilt binary (`@xfoil/darwin-arm64`, `@xfoil/linux-x64`, `@xfoil/win32-x64`, …) is resolved automatically by npm. In this workspace, `@xfoil/darwin-arm64` is staged and verified; the other platform packages are produced by `pnpm build:xfoil -- --target <platform-arch>` in the binary CI matrix. Until every platform artifact is published, set `XFOIL_BINARY_PATH` or pass `new XFoil({ binaryPath })` when using an unstaged platform. See [Binary Distribution](docs/BINARY_DISTRIBUTION.md).

**Requirements:** Node.js ≥ 20. No other system dependencies.

For local development:

```sh
pnpm install
pnpm build:xfoil -- --target darwin-arm64 # optional: stage the current platform binary
pnpm check
```

To verify the binary resolver and run a tiny headless smoke test:

```sh
npx xfoil --doctor
npx xfoil doctor --json
```

## Quickstart

### Single operating point (Node)

```ts
import { XFoil } from "xfoil";

const xf = new XFoil();

const r = await xf.analyze({
  airfoil: { naca: "0012" },
  reynolds: 3_000_000,
  alpha: 6,
  cp: true,           // also capture the pressure distribution
  boundaryLayer: true // ...and the BL dump
});

console.log(r.cl, r.cd, r.cm, r.converged);
console.log(r.cp?.x, r.cp?.cp);          // pressure distribution
console.log(r.boundaryLayer?.cf);        // skin friction along the surface
```

### Polar sweep (Node)

```ts
const polar = await xf.polar({
  airfoil: { naca: "2412" },
  reynolds: 1e6,
  ncrit: 9,
  alpha: { start: -5, end: 15, step: 0.5 },
});

for (const p of polar.points) console.log(p.alpha, p.cl, p.cd);
console.log("did not converge at:", polar.failed); // alphas XFOIL dropped
```

### Geometry, in the browser (no XFOIL needed)

```ts
// xfoil/geometry is pure TypeScript — safe to import in React/Vite/Next client code
import { Airfoil } from "xfoil/geometry";

const af = Airfoil.fromNACA("2412", { panels: 200 });
plot(af.coordinates); // [{ x, y }, ...] ready for SVG/Canvas/Three.js
```

### Next.js (server action runs XFOIL, client renders it)

```ts
// app/actions.ts
"use server";
import { XFoil } from "xfoil";
export async function getPolar(naca: string) {
  return new XFoil().polar({ airfoil: { naca }, reynolds: 1e6, alpha: { start: -5, end: 15, step: 1 } });
}
```

```tsx
// app/page.tsx (client)
import { Airfoil } from "xfoil/geometry"; // client-safe
import { getPolar } from "./actions";     // runs on the server
```

## Feature matrix

| Capability | API | Current status |
| --- | --- | :---: |
| Single-point analysis (α or Cl) | `analyze()` | ✅ with supplied binary |
| Polar sweeps (α/Cl range or list) | `polar()` | ✅ with supplied binary |
| Viscous / inviscid, Re, Mach, Ncrit, forced transition | options | ✅ with supplied binary |
| Pressure distribution (Cp) | `analyze({ cp: true })` | ✅ with supplied binary |
| Boundary-layer dump | `analyze({ boundaryLayer: true })` | ✅ with supplied binary |
| NACA 4/5-digit generation (pure TS) | `xfoil/geometry` | ✅ |
| `.dat` I/O (Selig + Lednicer) | `xfoil/geometry` | ✅ |
| Output-file parsers | `xfoil/parsers` | ✅ |
| Low-level fluent session + raw commands | `session()`, `raw()` | ✅ |
| Flap deflection | `analyze({ flap })` | ✅ |
| Prebuilt platform binaries | `@xfoil/<platform>` | ✅ darwin-arm64 staged; matrix builder pending remote validation |
| Binary diagnostics | `npx xfoil --doctor` | ✅ |
| Geometry / inverse design (GDES/MDES) | — | ⏳ v1.1 |
| Worker pool, result cache, polar CLI | — | ⏳ v1.2 |

See the [Roadmap](docs/ROADMAP.md).

## How it works

The library spawns a **headless** XFOIL build (graphics stubbed out at compile time, so no X11/display is ever needed), feeds it a generated command script over stdin inside a private temp directory, lets it write its native output files (polar save file, Cp, BL dump), then parses those files into typed results. A `Backend` abstraction isolates process execution so a future WebAssembly backend can drop in without changing the public API. See [Architecture](docs/ARCHITECTURE.md).

## Documentation

| Doc | What's in it |
| --- | --- |
| [PRD](docs/PRD.md) | Vision, users, functional/non-functional requirements, scope, success metrics |
| [Architecture](docs/ARCHITECTURE.md) | Module design, process driver, backend abstraction, packaging, data flow |
| [API Specification](docs/API.md) | Full typed public API, every option and return type, examples, errors |
| [XFOIL Reference](docs/XFOIL_REFERENCE.md) | The command sequences and file formats the library encodes |
| [Guides](docs/GUIDES.md) | Convergence, custom airfoils, BYO binaries, browser-safe geometry |
| [Binary Distribution](docs/BINARY_DISTRIBUTION.md) | Headless build, per-platform packages, GPL compliance, resolution & overrides |
| [Engineering](docs/ENGINEERING.md) | Testing strategy, CI/CD, release process, security |
| [Release Checklist](docs/RELEASE_CHECKLIST.md) | Final publish gates, npm names, binary matrix, licensing review |
| [Roadmap](docs/ROADMAP.md) | Milestones, versioning, timeline |
| [Decisions](docs/DECISIONS.md) | Architecture Decision Records |

## License & attribution

- **This wrapper library** (the `xfoil` npm package and all TypeScript source) is **MIT** licensed.
- **XFOIL itself** is **GPL-2.0-or-later** by Mark Drela and Harold Youngren. The prebuilt binaries are redistributed in **separate** `@xfoil/<platform>` packages, each carrying the GPL text and a written offer of source, in compliance with the GPL. The wrapper invokes XFOIL as a separate process (mere aggregation), so the MIT wrapper is not a derivative work of XFOIL. See [Binary Distribution → Licensing](docs/BINARY_DISTRIBUTION.md#licensing--gpl-compliance). *(This is a good-faith summary, not legal advice.)*

XFOIL is the work of **Mark Drela (MIT)** and **Harold Youngren**. This project is an independent wrapper and is not affiliated with or endorsed by them or MIT.
