# Bring Your Own XFOIL Binary

The final `xfoil` release installs a matching `@xfoil/<platform>` optional dependency automatically. Until every platform artifact is published, or when you need a custom solver build, point the wrapper at your own executable.

## Explicit Constructor Path

```ts
import { XFoil } from "xfoil";

const xf = new XFoil({
  binaryPath: "/opt/xfoil/bin/xfoil",
});

console.log(await xf.version());
```

`binaryPath` has the highest precedence and is the best choice for applications.

## Environment Variable

```sh
XFOIL_BINARY_PATH=/opt/xfoil/bin/xfoil node run-polar.mjs
```

This is useful in CI and local shells.

## Opt Into `PATH` Lookup

By default, the resolver does not run arbitrary `xfoil` commands found on `PATH`. Opt in explicitly:

```ts
const xf = new XFoil({ allowPathLookup: true });
```

Use this for developer machines where a trusted system XFOIL is already installed.

## Doctor Command

Run the support diagnostic before filing an issue:

```sh
npx xfoil --doctor
npx xfoil doctor --json
```

The command prints the detected platform, expected optional dependency package, resolved binary path, XFOIL version, and a small NACA 0012 smoke test.

## Expected Build Characteristics

A compatible binary should:

- report XFOIL version `6.99`,
- run with no display server,
- avoid X11 prompts or plot pauses,
- complete a NACA 0012 viscous polar headlessly,
- avoid external runtime files unless your wrapper deployment provides them.

The repository build script, `scripts/build-xfoil-binary.mjs`, produces the intended headless build by linking XFOIL against the no-op plot stub in `build/stub-plotlib/stub.f`.

