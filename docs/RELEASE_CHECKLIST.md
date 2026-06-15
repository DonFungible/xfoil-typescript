# Release Checklist

This checklist is the final manual gate before publishing `xfoil@1.0.0`.

## 1. Names And Registry Access

- Run `pnpm check:npm-names`.
- Reserve or publish the `xfoil` package name.
- Reserve or publish the `@xfoil` scope packages:
  - `@xfoil/darwin-arm64`
  - `@xfoil/darwin-x64`
  - `@xfoil/linux-arm64`
  - `@xfoil/linux-x64`
  - `@xfoil/win32-x64`
- Confirm `NPM_TOKEN` has publish rights for the wrapper and every binary package.

## 2. Local Package Gates

- Run `pnpm install --frozen-lockfile`.
- Run `pnpm check`.
- Run `pnpm docs:api`.
- Run `pnpm verify:release-metadata`.
- Run `pnpm verify:workflows`.
- On the current platform, run `pnpm smoke:packed-install -- --target <platform-arch>`.
- Confirm package-level publish guards behave as expected before all artifacts are staged:
  - `pnpm --filter @xfoil/<current-platform> exec npm run prepublishOnly` passes for a staged binary package.
  - `pnpm --filter xfoil exec npm run prepublishOnly` fails while any binary package is still `pending`, then passes only after all matrix artifacts are staged.

## 3. Binary Matrix Gates

Each target must pass in GitHub Actions:

- `node scripts/build-xfoil-binary.mjs --target <platform-arch>`
- `node scripts/verify-binary-packages.mjs --target <platform-arch>`
- `pnpm --filter xfoil test:integration`
- `pnpm smoke:packed-install -- --target <platform-arch>`

Do not publish while any binary package still has `VERSION` or `xfoilVersion` set to `pending`.
Each binary package has a `prepublishOnly` guard that runs `scripts/verify-binary-packages.mjs --target <platform-arch>`, and the wrapper has a `prepublishOnly` guard that runs the full release metadata and binary-package verification. These are backstops for manual or misordered publishes; the release workflow still runs the explicit gates before `changeset publish`.

## 4. Licensing Review

Before publishing GPL binary packages:

- Confirm wrapper package metadata is `MIT`.
- Confirm every binary package metadata is `GPL-2.0-or-later`.
- Confirm every released binary package includes the full GPL text as `LICENSE`.
- Confirm every released binary package includes `SOURCE_OFFER.md` with the pinned XFOIL source URL, SHA-256, local build script, plot stub, and written offer.
- Confirm README attribution says this is an independent wrapper and is not affiliated with or endorsed by the XFOIL authors or MIT.
- Record review sign-off outside the repository if a legal reviewer is involved.

## 5. Publish And Post-Publish Smoke

The `release.yml` workflow must:

- build and verify every binary package,
- assemble staged artifacts in the publish job,
- run `pnpm verify:binary-packages`,
- run `pnpm check`,
- publish with Changesets and `--provenance`,
- run `scripts/smoke-published-install.mjs` on every supported OS after a real publish.

If post-publish smoke fails, deprecate the broken package version immediately and publish a fixed patch.
