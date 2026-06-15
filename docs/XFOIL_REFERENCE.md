# XFOIL Reference (as encoded by this library)

A focused, implementation-oriented reference for the exact XFOIL interactions the driver depends on. This is the contract between `commands.ts` / parsers and the real program. Locally validated items are covered by the gated real-binary integration tests; remaining platform/fixture gaps are listed in the checklist.

> Pinned version for v1: **XFOIL 6.99**. Authors: Mark Drela & Harold Youngren. License: GPL-2.0-or-later.

## 1. Interaction model

XFOIL is a nested-menu REPL reading commands from stdin. Top level prompt is `XFOIL   c>`. Submenus are entered by name and exited with a blank line. When stdin is piped, XFOIL executes commands until EOF, then exits. Key implications the driver relies on:

- **Feed the whole script, then close stdin.** A trailing newline per command; a blank line exits a submenu.
- **Graphics must not engage.** XFOIL links Xplot11 (X11). We compile a **headless** build with graphics stubbed (see [Binary Distribution](BINARY_DISTRIBUTION.md)); additionally we send `PLOP` → `G F` → blank as defense in depth. With graphics off there are no "hit <return>" plot pauses.
- **Avoid overwrite prompts.** Writing to an existing file can prompt `y/n`. We always use **fresh unique filenames** in a private temp dir, so this never triggers.
- **Convergence is silent in files.** Non-converged points are simply absent from the polar save file; we diff requested vs present to compute `failed[]`.

## 2. Top-level commands used

| Command | Form | Purpose |
| --- | --- | --- |
| `NACA` | `NACA 2412` | Generate a 4/5-digit NACA section (XFOIL panels it). |
| `LOAD` | `LOAD airfoil.dat` | Load coordinates from a file (then a name prompt may appear). |
| `PANE` | `PANE` | Re-panel current geometry with default node distribution (~140 nodes). |
| `PPAR` | submenu | Change paneling parameters (e.g. node count `N`). |
| `GDES` | submenu | Geometry design operations; used for flap deflection. |
| `OPER` | submenu | Operating-point analysis (the workhorse). |
| `PLOP` | submenu | Plotting options; used to disable graphics (`G`). |
| `SAVE` | `SAVE out.dat` | Save current coordinates. |
| `QUIT` | `QUIT` | Exit. |

### PLOP (graphics off)
```
PLOP
G F        ← toggle graphics-enable flag off (older builds: bare "G" toggles; default is on→off)
           ← blank line returns to top menu
```
(With a headless build this is belt-and-suspenders, but harmless and protective if a system binary is ever substituted.)

### PPAR (panel count)
```
PPAR
N          ← choose node-count parameter
200        ← set number of panel nodes
           ← blank: accept PPAR changes
           ← blank: return to top menu after repaneling
```
The split `N` / value sequence is required; `N 200` on one line leaves later commands inside `PPAR` on XFOIL 6.99. The node-count path is the only `PPAR` path the high-level API uses, and only when `repanel: { panels }` is set.

### GDES FLAP (deflection)
`flap` is a geometry operation and must run before entering `OPER`:
```
GDES
FLAP
0.75       ← hinge x/c
0          ← hinge y/c
10         ← deflection angle (deg, + = down)
EXEC       ← commit buffer geometry to current airfoil
           ← blank: return to top menu
```
This prompt order is validated against the pinned Darwin arm64 XFOIL 6.99 build.

## 3. OPER submenu

Entered with `OPER`. Commands used (arguments may be given inline):

| Command | Form | Effect |
| --- | --- | --- |
| `VISC` | `VISC 1000000` | Toggle viscous on and set Reynolds number inline. |
| `RE` | `RE 1e6` | Set/Change Reynolds number. |
| `MACH` | `MACH 0.1` | Set Mach number. |
| `ITER` | `ITER 200` | Set viscous iteration limit. |
| `VPAR` | submenu | BL parameters: Ncrit (`N`), forced transition (`XTR`). |
| `ALFA` | `ALFA 5` | Solve at angle of attack (deg). |
| `CL` | `CL 0.6` | Native prescribed-lift solve. The high-level single-point `cl` API uses `CSEQ` instead, because direct `CL` can fail to write a polar row on XFOIL 6.99. |
| `ASEQ` | `ASEQ -5 15 0.5` | Sequence of alphas (start end inc). |
| `CSEQ` | `CSEQ 0 1.2 0.05` | Sequence of Cls. |
| `INIT` | `INIT` | Toggle BL initialization (reset between hard points). |
| `PACC` | `PACC` | Toggle polar accumulation; prompts for save & dump filenames. |
| `CPWR` | `CPWR cp.txt` | Write current x vs Cp to file. |
| `DUMP` | `DUMP bl.txt` | Write boundary-layer data (s,x,y,Ue,Dstar,Theta,Cf,…) to file. |

### VPAR (Ncrit and forced transition)
```
OPER
VPAR
N 9             ← set Ncrit
XTR 0.4 0.6     ← forced transition x/c (top bottom); 1.0 = free transition
                ← blank: exit VPAR
```

### PACC (polar accumulation)
Toggling `PACC` **on** prompts for two optional filenames:
```
OPER
PACC
polar.txt       ← polar SAVE filename (the file we parse)
                ← blank: no DUMP filename
ASEQ -5 15 0.5  ← run the sweep; each converged point is appended to polar.txt
PACC            ← toggle OFF (flush/close the file)
```
The driver responds positionally (filename, then blank) and uses a fresh temp directory to avoid overwrite prompts.

## 4. Canonical generated scripts

### Single point, viscous, with Cp + BL
```
PLOP
G F

NACA 2412
PANE
OPER
VISC 1000000
MACH 0.1
ITER 200
VPAR
N 9

PACC
polar1.txt

ALFA 5
CPWR cp.txt
DUMP bl.txt
PACC

QUIT
```
*(A single-point Cl/Cd/Cm can also be read from a 1-row PACC file; using PACC for one point gives us a uniform parser. Cp/BL reflect the last solved point.)*

### Single prescribed-lift point
High-level `analyze({ cl })` emits a tiny lift sequence from `0` to the requested `cl`, with an increment chosen so the target is exact and no larger than `0.1`:
```
PLOP
G F

NACA 0012
OPER
VISC 1000000
ITER 100
PACC
polar.txt

CSEQ 0 0.25 0.0833333333333
PACC

QUIT
```
This is more reliable than direct `CL 0.25` for XFOIL 6.99 because direct `CL` may iterate to the target but fail to append a converged polar row.

### Polar sweep, viscous
```
PLOP
G F

NACA 0012
PANE
OPER
VISC 3000000
ITER 200
PACC
polar.txt

ASEQ -8 18 0.5
PACC

QUIT
```

### Loaded coordinates
Replace `NACA …` with:
```
LOAD airfoil.dat
            ← (possible name prompt: send blank or the name)
PANE
```

## 5. File formats

### 5.1 Polar save file (PACC)
```

       XFOIL         Version 6.99

 Calculated polar for: NACA 2412

 1 1 Reynolds number fixed          Mach number fixed

 xtrf =   1.000 (top)        1.000 (bottom)
 Mach =   0.000     Re =     1.000 e 6     Ncrit =   9.000

   alpha    CL        CD       CDp       CM     Top_Xtr  Bot_Xtr
  ------ -------- --------- --------- -------- -------- --------
  -5.000  -0.3120   0.00601   0.00208  -0.0613   0.7755   0.2447
   0.000   0.2520   0.00557   0.00128  -0.0521   0.6094   0.5063
   ...
```
Parser (`parsePolar`):
- Extract `name` from `Calculated polar for:`.
- Extract `Mach`, `Re` (note spaced sci-notation `1.000 e 6` → `1.0e6`), `Ncrit` via regex.
- Locate the header row containing `alpha` and `CL`; skip the `----` rule; parse following numeric rows into 7 columns `[alpha, cl, cd, cdp, cm, topXtr, botXtr]`.
- Overflow tokens `*****` → `NaN`.

### 5.2 Cp file (CPWR)
Two columns, `x` and `Cp`, possibly with a `#`-prefixed header:
```
 #    x        Cp
   1.00000   0.24517
   0.99619   0.18213
   ...
```
Parser (`parseCp`): skip `#`/non-numeric lines; column 0 = `x`, last numeric column = `cp`. This accepts both the two-column viscous/inviscid files emitted by the pinned Darwin arm64 XFOIL 6.99 build and three-column variants.

### 5.3 Boundary-layer dump (DUMP)
Columns (header `#`-prefixed):
```
#    s        x        y     Ue/Vinf    Dstar     Theta      Cf       H
  0.00000  1.00000  0.00126  0.0000   0.00000   0.00000   0.000   0.000
  ...
```
Parser (`parseDump`): skip header; map the leading columns → `{ s, x, y, ue, dstar, theta, cf, h }`. The pinned Darwin arm64 XFOIL 6.99 build emits a mix of 8- and 12-column data rows; the parser intentionally consumes the first 8 and ignores extra columns.

### 5.4 Coordinate `.dat` files
- **Selig:** optional name line, then a single ordered loop TE→upper→LE→lower→TE.
- **Lednicer:** name line, then a counts line (e.g. `61.  61.`), then upper surface LE→TE, blank, lower surface LE→TE.
`parseCoordinates` detects the format (presence of a counts line / point-ordering) and normalizes to Selig order.

## 6. Known pitfalls (and how the driver handles them)

| Pitfall | Handling |
| --- | --- |
| X11/plot window opens or hangs headless | Compile-out graphics (stub plotlib) + `PLOP G F`. |
| "Hit <return> to continue" pauses | Eliminated by graphics-off. |
| File-overwrite `y/n` prompt | Unique filenames in a fresh temp dir. |
| Non-convergence silently drops points | Diff requested vs polar rows → `failed[]`; `INIT` between hard points optionally. |
| Numeric overflow prints `*****` | Tolerant numeric parser → `NaN`. |
| Spaced sci-notation `1.000 e 6` | Dedicated regex in `parsePolar`. |
| Long/space-containing paths confuse XFOIL | CWD = temp dir; reference files by short relative names. |
| Windows EOL / path separators | Normalize EOLs on read; POSIX-style short names in the temp dir. |
| Hard high-α start fails to converge | Optional `ramp` (march intermediate α); `ASEQ` already marches with continuation. |
| Direct single-point `CL` may not write a polar row | `analyze({ cl })` uses `CSEQ 0 target step` with continuation and selects the requested target row. |

## 7. Phase 0 validation checklist

Before freezing `commands.ts` and the parsers for 1.0, run the real pinned binary on every supported platform and capture fixtures/transcripts for:
- [x] PACC save/dump prompt ordering (`PACC`, polar filename, blank dump filename) on Darwin arm64.
- [x] `VISC <Re>` sets Re inline on Darwin arm64.
- [x] PPAR node-count sub-prompt sequence on Darwin arm64.
- [x] FLAP prompt order (`GDES`, `FLAP`, x, y, angle, `EXEC`) on Darwin arm64.
- [x] CPWR column count for viscous and inviscid Darwin arm64 output (2 numeric columns).
- [x] DUMP column count for viscous Darwin arm64 output (8 or 12 numeric columns; first 8 parsed).
- [x] Polar header spacing accepted by parser and real-binary integration on Darwin arm64.
- [x] Direct `CL` vs `CSEQ` behavior for reachable single-point Cl on Darwin arm64.
- [x] Behavior of `CSEQ` when a target Cl is unreachable on Darwin arm64 (`failed[]` reports the missing target without throwing).
- [x] Inviscid polar file shape on Darwin arm64 (`Re = 0`, transition columns zeroed).
- [ ] Repeat the locally confirmed prompt sequences on Linux, macOS x64, and Windows artifacts.

Each captured artifact should become either a parser fixture under `packages/xfoil/test/fixtures/` or a gated real-binary integration assertion.
