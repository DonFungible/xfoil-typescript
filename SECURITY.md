# Security Policy

Report security issues privately to Don at don@don.dev.

Please include the package version, platform, Node version, whether a bundled or
custom XFOIL binary was used, and a minimal reproduction if possible.

The wrapper avoids shell interpolation and runs XFOIL in private temp
directories with per-run timeouts. The `raw()` API intentionally executes
caller-provided XFOIL commands; treat it as trusted-code execution.
