import { XFoil } from "xfoil";

const xf = new XFoil({
  allowPathLookup: true,
  timeoutMs: 30_000,
});

const result = await xf.analyze({
  airfoil: { naca: "2412" },
  alpha: 4,
  cp: true,
  mach: 0.1,
  reynolds: 1_000_000,
});

console.log({
  cd: result.cd,
  cl: result.cl,
  cm: result.cm,
  converged: result.converged,
  cpPoints: result.cp?.points.length ?? 0,
});
