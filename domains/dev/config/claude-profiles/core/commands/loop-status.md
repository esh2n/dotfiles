# Loop Status Command

Inspect active loop state, progress, and failure signals.

## When to Use

- An autonomous loop is running and you want its current phase and last successful checkpoint
- Failing checks or time/cost drift require a continue/pause/stop decision
- You want periodic refreshes with state-change alerts (`--watch`)

## Usage

`/loop-status [--watch]`

## What to Report

- active loop pattern
- current phase and last successful checkpoint
- failing checks (if any)
- estimated time/cost drift
- recommended intervention (continue/pause/stop)

## Watch Mode

When `--watch` is present, refresh status periodically and surface state changes.

## Arguments

$ARGUMENTS:
- `--watch` optional
