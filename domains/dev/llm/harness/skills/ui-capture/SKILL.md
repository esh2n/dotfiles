---
name: ui-capture
description: Use when the user wants a screenshot or short GIF of a web UI for a PR description, writeup document, or Artifact — a running or headlessly-launchable web app, not a native macOS app (Tauri/Swift apps steal the user's screen and are out of scope). Symptoms include "スクショ撮って", "GIF にして", "動きを撮って" about a web page, or a request to attach visual evidence of a UI change to a PR or design doc.
metadata:
  namespaces: [web/ui, doc]
---

# ui-capture

## Overview

ui-capture holds only one executable (`bin/capture.mjs`), which drives a web UI
in headless Chromium and writes PNG / GIF. The split of responsibilities is
clear: **the calling project decides how the app is launched** (dev server, mock
backend, fixtures); **this skill drives the browser and encodes**.

There are 2 ways to hand over the launch: pass an already running URL with
`--url`, or declare the launch command in the project's `.ui-capture.json`
manifest and let capture.mjs start it itself. In both cases **neither
capture.mjs nor the calling agent guesses the launch command** — with no
manifest and no `--url`, it does not attempt a launch; it reports "no launch
method" and stops with exit 2.

Only web UIs (anything Playwright can capture headlessly) are in scope. Native
macOS apps (a Tauri palette, Swift Core, etc.) need AppKit / Accessibility and
are out of scope — launching them steals esh2n's screen anyway.

## Zero-dependency rule

This skill has no `node_modules` of its own. Any extra install lives outside
the skill (one machine-shared place).

- **playwright** resolves in 3 stages (in this order).
  1. The calling project's `node_modules`
     (`require.resolve('playwright', { paths: [process.cwd()] })`) —
     always prefer the version the project pins, when it has one
  2. `$UI_CAPTURE_PLAYWRIGHT=/path/to/node_modules/playwright` — explicit
     (for tests, or layouts not reachable from node_modules)
  3. The shared install `~/.local/share/ui-capture/node_modules/playwright`
     — set up once per machine by `bin/setup.mjs` (next section). The last
     resort for products without Node (Go, Swift, etc.). When used, pin
     `PLAYWRIGHT_BROWSERS_PATH` to `browsers/` inside the same directory
     before importing (so the npm package and Chromium versions match)
  If none resolves, fail with exit 3 (playwright not found) and an explicit
  error pointing at `bin/setup.mjs`.
- **ffmpeg** is taken from PATH (the 2-pass WebM → GIF conversion,
  `palettegen`/`paletteuse`). If absent, do not let the GIF fail silently:
  emit `gif: { status: "skipped", reason: "ffmpeg not found on PATH" }` in the
  summary JSON and exit 0 (the PNGs were captured, so it is not fatal).

## Initial setup (once per machine)

To capture from non-Node products as well, once per machine:

```bash
node "$SELF/bin/setup.mjs"
```

This installs playwright (pinned 1.61.1) and Chromium (in `browsers/` inside
the same directory) under `~/.local/share/ui-capture/`. The npm package and
Chromium versions must always match, so both are confined to this one
directory and only setup.mjs rewrites it (no double management with nix —
ui-capture design decision point 2). Idempotent — if the same version is
already present, nothing is downloaded again. The absolute path and version of
the node used at setup are recorded in `~/.local/share/ui-capture/meta.json`
(used for the reason in the next section).

`--upgrade` reinstalls at the pinned version; `--upgrade --playwright
<version>` bumps the version and reinstalls (`--playwright` alone is not
allowed — to avoid installing a stray version by mistake). Without npm, or with
Node below 22, it fails with a clear message (exit 7 and exit 6 respectively).

For products that have no Node in the project and do not use the shared
install (including developing this skill itself), setup.mjs is unnecessary —
`--url`, or the playwright in the project's own `node_modules`, suffices.

## Node version (run through `bin/ui-capture`, recommended)

mise switches tool versions by cwd. Launching a capture from `.ui-capture.json`
inside a repo that pins an old Node (Playwright's supported floor is 22) can
make capture.mjs itself run on that old Node — the app's dev server and the
capture process are separate processes, so they are not coupled, but
**the Node version running capture.mjs** does matter.

To avoid this, go through the thin launcher `bin/ui-capture`:

```bash
"$SELF/bin/ui-capture" --url http://127.0.0.1:PORT --scenario scenario.json --out ./out
```

`bin/ui-capture` resolves node in this order, then `exec`s `capture.mjs`
with it:

1. `$UI_CAPTURE_NODE` (the explicit escape hatch)
2. The node recorded in `~/.local/share/ui-capture/meta.json` (written by
   `bin/setup.mjs` at setup)
3. `command -v node` (whatever is on PATH)

Calling `node "$SELF/bin/capture.mjs" ...` directly still works — the caller's
Node is used as-is (fine when cwd pins 22 or newer). capture.mjs also checks
`process.version` at startup and, below 22, points at `bin/ui-capture` and
`$UI_CAPTURE_NODE` and exits 6 (it never silently runs on an old Node).

## Procedure

### 1. Find how the project launches

First look for "how does this project start its web UI":

- The project's own skills (`<repo>/.claude/skills/` etc.)
- mise tasks / package.json scripts (`mise run dev`, `pnpm dev`, etc.)
- The launcher used by existing acceptance / quality-gate scripts (arekore
  example: `apps/viewer/test/quality/mock-daemon.ts` + `serve.ts` — serves the
  production-built `dist/` statically with a mock daemon. Import the same
  helper and take `site.url`)

Once found, hand it to capture.mjs by one of the two routes. **Do not invent
a new launch method** — reuse what exists.

**Route A — launch it yourself and pass `--url`.** Start the launcher you found
**yourself, in the background**, and pass the resulting URL as `--url`. Suited
to one-off captures, an app that is already running, or a launcher that is
awkward to call from a script (an interactive CLI, etc.).

**Route B — write a `.ui-capture.json` manifest and let capture.mjs launch.**
`node "$SELF/bin/capture.mjs" init` scaffolds one (it proposes the
`dev`/`start`/`serve` scripts it found and fills in the best candidate; it
runs nothing — `url`/`ready` are checked and filled by hand). Written once at
the project root, capture.mjs handles launch through cleanup from then on (it
is both "the one who starts" and "the one who tidies up"). Format in the next
section. When the project has no `.ui-capture.json` and no `--url` is passed,
capture.mjs guesses nothing and exits 2 with
`起動手段なし: --url か .ui-capture.json を用意する` — this is intended; do not
work around it, add the manifest on the project side.

SAFETY: never pass `headless: false`. Never use `open`, `osascript`, or
anything that opens a real browser window. capture.mjs enforces this (it
always calls `chromium.launch()` with no arguments), but the launcher side
(route A's self-written launch code, route B's `launch` command) must keep the
same discipline.

### 2. Write the scenario file (JSON — JSON rather than YAML, for zero-dep)

Write a file in the format below and pass it with `--scenario`.

### 3. Run capture.mjs

Prefer `bin/ui-capture` (see "Node version" above). Calling `node bin/capture.mjs`
directly gives the same result as long as cwd pins Node 22 or newer.

```bash
# Route A (--url)
"$SELF/bin/ui-capture" --url http://127.0.0.1:PORT --scenario scenario.json --out ./out

# Route B (.ui-capture.json; omit --project to search upward from cwd)
"$SELF/bin/ui-capture" --project . --scenario scenario.json --out ./out
```

Main flags (all optional, defaults in parentheses): `--project` (directory to
start searching for `.ui-capture.json`; default cwd), `--width` (1280),
`--height` (800), `--scale` (2, `deviceScaleFactor`), `--gif-fps` (10),
`--gif-width` (800), `--theme light|dark` (emulates `prefers-color-scheme`),
`--timeout` (5000, ms. The default timeout passed to `page.setDefaultTimeout()`
— applies to every step without an explicit timeout: selector waits, clicks,
`goto`, etc.), `--dry-run` (executes and writes nothing; only checks scenario
validity and the step count).

Prints one JSON summary to stdout (files captured, byte sizes, GIF length,
`launched` (whether it launched from the manifest itself), `playwright` (where
it resolved — `"project" | "env" | "shared"`), warnings for exceeding the
8MB/8s budget). The `--dry-run` summary also includes `playwright`, but a
failed resolution does not fail the dry run itself (it is just `null` — the
contract is to check scenario validity only).

Exit codes: 0=success, 2=invalid arguments or scenario (including neither
`--url` nor `.ui-capture.json` present), 3=playwright cannot be resolved,
4=step execution failed (which step and which selector go to stderr),
5=the manifest's `launch` did not reach readiness before the timeout (60s),
or the `launch` command itself could not start, 6=the running Node is below
22 (use a node 22+ via `bin/ui-capture` or `$UI_CAPTURE_NODE`).

### 4. Hand over to writeup

Copy the output into `<slug>-assets/` and reference it from `.wu-shot` (one
`<img>` per figure, `alt` required. A GIF works as-is via `<img src="x.gif">`
— browsers and GitHub both autoplay it. Details in the `.wu-shot` section of
writeup-kit's `references/components.md`).

### 5. Size budget

Keep the `.wu-shot` total under 8MB and the whole page under the Artifact
limit of 16MB (the same budget as writeup-kit). The GIF defaults are set for
this budget: fps 10, width 800, about 8 seconds. Split a long flow into
several GIFs — do not cram it into one.

## Scenario format

```json
{
  "steps": [
    { "goto": "/" },
    { "press": "Meta+KeyK" },
    { "fill": ["role=combobox", "検索語"] },
    { "wait": 300 },
    { "waitFor": "role=listbox" },
    { "shot": "search-open" },
    { "press": "Escape" },
    { "hover": ".row" }
  ],
  "gif": { "name": "search-flow" }
}
```

Steps run one at a time, in order. Each line has **exactly one** of these keys:

| Key | Meaning |
|---|---|
| `goto` | Navigate to a path relative to `--url`, or to an absolute URL |
| `click` | Click the selector |
| `fill` | `[selector, text]` — type into that element |
| `press` | Key string passed as-is to `page.keyboard.press()` (e.g. `Meta+KeyK`, `Escape`) |
| `wait` | Wait the given milliseconds |
| `waitFor` | Wait until the selector becomes visible |
| `shot` | Write a PNG. Takes a name. Optional `clip` (selector) crops to that element's bounding box |
| `hover` | Hover over the selector |

With `gif` present, one GIF is written from a recording of the whole scenario.
The procedure has 4 stages:

1. Create the context with `recordVideo` (recording per context)
2. Run every step
3. Close the context to finalize the WebM
4. Convert to GIF with ffmpeg's 2 passes (`palettegen`/`paletteuse`)

Omit `gif` for a PNG-only run.

A scenario with both `gif` and `shot` is run in 2 passes automatically so the
recording stays clean (the recording-only first pass skips shots; the
still-only second pass records no video and takes the shots). Runtime roughly
doubles — the app is not restarted.

## Project manifest (`.ui-capture.json`)

One per project root. **Do not commit it** — `.ui-capture.json` is in the
dotfiles global gitignore, so it never shows
in `git status`. Create it once per checkout and per machine (ui-capture design
decision point 1 — option A. The "outside the repo" alternative was rejected
this time: an unsynced `~/.config/work` does not carry to other machines, and
A's operation already has precedent in the harness).

capture.mjs walks upward from `--project` (default cwd) and uses the first
`.ui-capture.json` found. The walk stops at the directory containing `.git`
(file or directory) — that directory itself is checked, but nothing above it
(another repository) is. If it never meets a `.git`, it walks to the
filesystem root as before and gives up.

```json
{
  "launch": "pnpm --filter @arekore/viewer exec tsx test/quality/serve-only.ts",
  "url": "http://127.0.0.1:41999",
  "ready": "serving on",
  "stop": "pkill -f serve-only.ts"
}
```

| Field | Required | Meaning |
|---|---|---|
| `launch` | required | Launch command run in the shell (the string as-is, `spawn(cmd, { shell: true })`) |
| `url` | required | Base URL the scenario captures against once launch is done |
| `ready` | required | Readiness test. A string waits until that substring appears on `launch`'s stdout/stderr. `{ "http": "/path" }` waits until `url + path` returns HTTP 200. Either way the timeout is 60 seconds (exit 5) |
| `stop` | optional | Stop command run after capture. If omitted, `SIGTERM` is sent to the process group `launch` created (spawned with `detached: true`, so the whole group stops) |
| `env` | optional | Extra environment variables for `launch`/`stop` (merged over `process.env`) |

### Scaffolding — `capture.mjs init`

Instead of writing by hand in a new project:

```bash
node "$SELF/bin/capture.mjs" init
# to overwrite an existing one:
node "$SELF/bin/capture.mjs" init --force
```

Writes a `.ui-capture.json` scaffold at the repo root (the directory found by
searching upward from cwd for `.git`; exit 2 if none). **Runs nothing** — it
only collects `dev`/`start`/`serve` scripts from the root and `apps/*`
`package.json` files as candidates and fills the best one (root `dev` first)
into `launch`. `url` and `ready` are environment-dependent and cannot be
guessed, so they stay as placeholders — fill them by hand from the candidate
list on stdout. If `.ui-capture.json` already exists, it stops with exit 2
and does not overwrite unless `--force` is given.

Whether capture succeeds or fails, capture.mjs always stops the processes it
started at the end (cleanup in `finally`; no lingering resident process).

## Common failures

- **Trying to make capture.mjs guess the launch command with neither `--url`
  nor `.ui-capture.json`** — capture.mjs never guesses a launch command.
  Choose route A (launch yourself and pass `--url`) or route B (write
  `.ui-capture.json`). On exit 2 "no launch method", do not work around it:
  add the manifest or pass `--url`.
- **Improvising a launch command of your own in `.ui-capture.json`'s `launch`**
  — put the existing dev server / mise task / acceptance-script launcher in
  `launch` as-is. Do not invent a launch procedure the project does not have.
- **Setting `headless: false` to open the screen "for checking"** — never.
  esh2n's screen is in use while the agent works; do not take it.
- **Writing a human-readable notation (`⌘K`) straight into `press`** — write
  a string Playwright's `keyboard.press()` understands (`Meta+KeyK` etc.).
- **GIF too long / too large** — several flows crammed into one scenario blow
  the 8 seconds / 8MB. Give each flow its own `gif.name` and run multiple times.
- **Giving up on "playwright not found" after just reading the error** — if the
  project has no `node_modules`, point at it explicitly with
  `UI_CAPTURE_PLAYWRIGHT` or run `node bin/setup.mjs` once and use the shared install.
- **Assuming the GIF is mandatory where ffmpeg is absent** — the skip is the
  normal path (exit 0). PNGs alone are often a sufficient deliverable.
- **Calling `node bin/capture.mjs` directly inside a repo that pins an old Node** —
  via `bin/ui-capture` it is pinned to the harness's Node. If calling directly,
  confirm cwd pins 22 or newer (on exit 6, switch to `bin/ui-capture`).
