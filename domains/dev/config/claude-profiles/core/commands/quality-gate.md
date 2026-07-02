# Quality Gate Command

Run the ECC quality pipeline on demand for a file or project scope.

## When to Use

- You want formatter, lint, and type checks run on demand instead of waiting for hooks
- You need a concise remediation list for a specific file or directory
- Auto-fixing (`--fix`) or failing on warnings (`--strict`) is desired

## Usage

`/quality-gate [path|.] [--fix] [--strict]`

- default target: current directory (`.`)
- `--fix`: allow auto-format/fix where configured
- `--strict`: fail on warnings where supported

## Pipeline

1. Detect language/tooling for target.
2. Run formatter checks.
3. Run lint/type checks when available.
4. Produce a concise remediation list.

## Notes

This command mirrors hook behavior but is operator-invoked.

## Arguments

$ARGUMENTS:
- `[path|.]` optional target path
- `--fix` optional
- `--strict` optional
