---
title: Workspace CLI (mado)
description: Profile switcher that swaps WM + sketchybar + borders as one set.
---

A CLI that switches the WM (AeroSpace / Paneru / OmniWM) together with
sketchybar / borders as one set. All WMs stay installed; only the running
state changes. The active profile is machine-local state
(`~/.local/state/mado/`) and is never committed.

## Profiles

| Profile | WM | sketchybar | borders |
|---------|----|-----------|---------|
| `loop` (default) | Loop (on-demand snapper) | on | on |
| `paneru` | Paneru (sliding tiling) | on | on |
| `aerospace` | AeroSpace (fixed grid) | on | on |
| `omniwm` | OmniWM (built-in bar / borders) | off | off |
| `none` | none (plain macOS) | on | off |

## Commands

| Command | What it does |
|---------|-------------|
| `mado` | Interactive menu (switch / status / stop / layout / info) |
| `mado use <profile>` | Switch sets (idempotent; re-run converges to the declared state = restart) |
| `mado use` | Re-apply the current profile |
| `mado use <profile> --dry-run` | Show planned actions without executing |
| `mado status` | Recorded profile vs actually running processes |
| `mado list` | List profiles |
| `mado stop` | Stop all WMs and managed services |
| `mado layout` | Layout save / restore menu (aerospace only) |
| `mado info` | Window / workspace / monitor info (aerospace only) |

`mado layout` / `mado info` were absorbed from the retired `ws` CLI and
depend on the AeroSpace CLI, so they only work while the aerospace profile
is active.

## Legacy commands

| Command | What it does |
|---------|-------------|
| `brdr` / `brds` / `brdk` | Borders restart / start / stop |
| `sbr` / `sbs` / `sbk` | Sketchybar restart / start / stop |
| `wsls` / `wsstart` / `wsrestart` / `wsstop` | Thin wrappers over mado |
