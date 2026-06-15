# Convergence Guide

XFOIL can fail to converge without crashing. This package reports that explicitly:

- `analyze()` returns `converged: false` when the requested operating point did not produce a polar row.
- `polar()` returns converged rows in `points` and missing requested values in `failed`.

That behavior matches XFOIL itself: non-converged sweep points are absent from the polar save file.

## Start With Conservative Inputs

Use a moderate Reynolds number, small Mach number, and a narrow alpha range first:

```ts
import { XFoil } from "xfoil";

const xf = new XFoil({ iterations: 200 });

const polar = await xf.polar({
  airfoil: { naca: "2412" },
  reynolds: 1_000_000,
  mach: 0.05,
  alpha: { start: -4, end: 10, step: 1 },
});

console.log(polar.points.length, polar.failed);
```

Broaden the sweep once the basic case behaves.

## Increase Iterations

The default iteration count is intentionally modest. Use a higher `iterations` value for difficult viscous cases:

```ts
const point = await xf.analyze({
  airfoil: { naca: "0012" },
  reynolds: 3_000_000,
  alpha: 12,
  iterations: 300,
});
```

## March Toward Hard Points

XFOIL often converges better when previous nearby operating points initialize the boundary layer. Prefer `polar()` sweeps over many unrelated single-point calls when exploring a range:

```ts
const polar = await xf.polar({
  airfoil: { naca: "0012" },
  reynolds: 1_000_000,
  alpha: { start: 0, end: 14, step: 0.5 },
  iterations: 250,
});
```

If only one high-alpha point matters, solve a smaller sweep around it and read the desired row from `points`.

## Use Forced Transition Deliberately

Forced transition can make comparisons repeatable, but unrealistic values can also make convergence worse. Use `xtr` only when you mean it:

```ts
const result = await xf.analyze({
  airfoil: { naca: "2412" },
  reynolds: 1_000_000,
  alpha: 4,
  xtr: { top: 0.3, bottom: 0.5 },
});
```

`xtr` values are chord fractions from `0` to `1`; omitted sides default to free transition.

## Keep Debug Artifacts

When diagnosing a case, enable logs or keep files:

```ts
const xf = new XFoil({
  keepFiles: true,
  logger: (event) => {
    if (event.type === "script") console.log(event.lines.join("\n"));
  },
});
```

`raw.dir` on returned results points at the preserved run directory. It contains XFOIL's native output files for inspection.

## Timeouts Are Safety Boundaries

Use `timeoutMs` to bound untrusted or exploratory geometry:

```ts
const xf = new XFoil({ timeoutMs: 20_000 });
```

Timeouts kill the XFOIL process tree and throw `XFoilTimeoutError`.

