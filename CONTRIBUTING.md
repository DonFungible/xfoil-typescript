# Contributing

Thanks for helping make `xfoil` reliable. The repository is a pnpm workspace:

```sh
pnpm install
pnpm check
```

Most tests do not need a real XFOIL binary. Integration tests are gated and run
only when a binary resolves through `new XFoil({ binaryPath })`,
`XFOIL_BINARY_PATH`, or a platform package.

## Common Commands

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm package:check
```

## Binary Work

The TypeScript wrapper is MIT licensed. XFOIL binaries are GPL artifacts and are
kept in separate `@xfoil/<platform>` packages. When changing binary build logic:

- Use the pinned upstream source and record the exact version.
- Keep patches minimal and committed under `build/patches/`.
- Include GPL license text, attribution, `SOURCE_OFFER.md`, and the exact build
  scripts used for every binary release.
- Run the acceptance gates in `docs/BINARY_DISTRIBUTION.md`.

## Pull Requests

Add tests for behavior changes, keep browser-safe modules free of Node imports,
and include a changeset for user-visible changes.
