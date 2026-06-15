import { Airfoil } from "xfoil/geometry";

export default function Page() {
  const airfoil = Airfoil.fromNACA("2412", { panels: 80 });
  const points = airfoil.coordinates.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`);

  return (
    <main>
      <h1>NACA 2412</h1>
      <pre>{points.slice(0, 8).join("\n")}</pre>
    </main>
  );
}
