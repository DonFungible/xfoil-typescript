import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    cli: "src/cli.ts",
    geometry: "src/geometry/index.ts",
    index: "src/index.ts",
    parsers: "src/parsers/index.ts",
  },
  format: ["esm", "cjs"],
  minify: false,
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "node20",
});
