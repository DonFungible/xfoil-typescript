# Custom Airfoils

`xfoil` accepts NACA designations, in-memory coordinate arrays, raw `.dat` text, paths to `.dat` files, and `Airfoil` instances from `xfoil/geometry`.

## Coordinate Order

The geometry helpers normalize to Selig order:

1. trailing edge on the upper surface,
2. upper surface toward the leading edge,
3. lower surface back to the trailing edge.

Lednicer files are also accepted and converted internally.

## Load Raw `.dat` Text

```ts
import { XFoil } from "xfoil";

const dat = `Demo foil
1.0000  0.0000
0.5000  0.0600
0.0000  0.0000
0.5000 -0.0600
1.0000  0.0000
`;

const result = await new XFoil().analyze({
  airfoil: { dat },
  reynolds: 500_000,
  alpha: 2,
});
```

## Load a File Path

```ts
const polar = await new XFoil().polar({
  airfoil: { datPath: "./airfoils/e387.dat" },
  reynolds: 1_000_000,
  alpha: { start: -4, end: 10, step: 1 },
});
```

The wrapper reads the file itself and writes a safe short filename into XFOIL's private temp directory, so spaces or platform path separators do not reach the XFOIL command script.

## Use Geometry Helpers First

```ts
import { Airfoil } from "xfoil/geometry";
import { XFoil } from "xfoil";

const airfoil = Airfoil.fromDat(dat).normalize().repanel(180);

const result = await new XFoil().analyze({
  airfoil,
  reynolds: 1_000_000,
  alpha: 5,
});
```

Use `normalize()` when the input may not be unit chord. Use `repanel()` when the point density is sparse, noisy, or clustered poorly.

## Re-paneling Behavior

High-level solver calls re-panel loaded coordinates by default. Override that per instance or per call:

```ts
const xf = new XFoil({ repanel: { panels: 180 } });

await xf.analyze({
  airfoil: { dat },
  alpha: 3,
  repanel: false,
});
```

For raw experimental geometry, start with re-paneling enabled. Disable it only when preserving exact input paneling is important.

