# Binary Build Workspace

This directory holds the headless XFOIL build assets described in
`docs/BINARY_DISTRIBUTION.md`.

Implemented:

1. XFOIL 6.99 is pinned by URL and SHA-256 in `scripts/build-xfoil-binary.mjs`.
2. `stub-plotlib/stub.f` contains the exact no-op plotlib symbol set required by
   the XFOIL 6.99 object files.
3. `GPL-2.0.txt` is copied into staged binary packages.
4. `pnpm build:xfoil -- --target <platform-arch>` downloads, verifies, builds,
   smoke-tests, numerical-golden-tests, dependency-scans, and stages a package.
5. `node scripts/verify-binary-packages.mjs --target <platform-arch>` rejects
   placeholder or incomplete binary packages before upload/publish.
6. `pnpm smoke:packed-install -- --target <platform-arch>` packs the wrapper and
   matching binary package, installs them into a clean temp project with
   `--ignore-scripts`, and verifies `xfoil doctor` plus a runtime `polar()`.
7. `pnpm verify:release-metadata` checks lockstep versions, optional
   dependencies, release docs, workflow presence, and license/source-offer
   metadata.
8. `scripts/smoke-published-install.mjs` verifies the public npm install path
   after a real publish.

Release-gating work still required:

1. Validate the GitHub Actions binary matrix on Linux x64/arm64, macOS x64, and
   Windows x64.
2. Validate packed-install and published-install smoke across all supported OSes
   in GitHub Actions.
3. Complete the licensing review before publishing GPL binary packages.
