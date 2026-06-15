# Browser Geometry

The main `xfoil` entry point is Node-only because it spawns a native process. The `xfoil/geometry` and `xfoil/parsers` subpaths are pure TypeScript and safe for browser bundles.

## Generate an Airfoil in a Client Component

```ts
import { Airfoil } from "xfoil/geometry";

const airfoil = Airfoil.fromNACA("2412", { panels: 120 });
const points = airfoil.coordinates;
```

Those points can be rendered with SVG, Canvas, WebGL, or any charting library.

## Parse User-Provided Coordinates

```ts
import { Airfoil } from "xfoil/geometry";

export function parseUploadedDat(text: string) {
  return Airfoil.fromDat(text).normalize();
}
```

Run this in the browser to validate and preview a shape before sending it to a server action or API route for XFOIL analysis.

## Keep Solver Calls on the Server

In frameworks such as Next.js, import `xfoil` only from server code:

```ts
"use server";

import { XFoil } from "xfoil";

export async function getPolar(naca: string) {
  return new XFoil().polar({
    airfoil: { naca },
    reynolds: 1_000_000,
    alpha: { start: -4, end: 12, step: 1 },
  });
}
```

Client code can import `xfoil/geometry` to draw the airfoil while the server action imports `xfoil` to run the native binary.

## Bundle Guard

The repository has a purity guard for the browser-safe subpaths. It fails CI if `geometry`, `parsers`, or shared pure modules import Node built-ins such as `node:child_process`.

