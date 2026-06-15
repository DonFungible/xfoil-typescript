import { XFoil } from "xfoil";

const xf = new XFoil({
  allowPathLookup: true,
  iterations: 200,
});

const reynoldsNumbers = [250_000, 500_000, 1_000_000];
const polars = await Promise.all(
  reynoldsNumbers.map((reynolds) =>
    xf.polar({
      airfoil: { naca: "0012" },
      alpha: { end: 12, start: -4, step: 1 },
      reynolds,
    }),
  ),
);

for (const polar of polars) {
  console.log(
    `Re=${polar.reynolds}: ${polar.points.length} converged, ${polar.failed.length} failed`,
  );
}
