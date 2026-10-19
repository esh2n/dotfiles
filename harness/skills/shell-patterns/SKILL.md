---
name: shell-patterns
description: Use when writing or reviewing a bash, zsh or POSIX sh script, a shell function, a CI step's inline script, or a .sh/.bash/.zsh/.bats file — unquoted expansions, set -euo pipefail and where it does not fire, traps and temp-file cleanup, cd without a failure check, loops over ls or find output, eval, curl piped to a shell, bash 4+ features on macOS's bash 3.2, zsh's different word splitting, GNU vs BSD tool flags, or deciding whether a script has outgrown shell and belongs in Go.
metadata:
  namespaces: [lang/shell]
  verified: 2026-10
---

# Shell Patterns

Writing or reviewing bash, zsh or sh: read `references/review-standard.md`
first — the single shell review standard (items with sources, version gates,
the execution model, ShellCheck and shfmt mapping) shared by the writer and
`code-reviewer`.

## Rules of thumb

- Decide first whether it should be shell. In this repository a script stays
  shell only when it is a thin entry point that hands off to another program
  with no output helpers of its own (whatever its length), or when it must
  change the calling shell's state (`cd`, environment,
  prompt hooks); anything that prints, logs or reports errors to the user is
  a `dotctl` subcommand in Go
  (`harness/rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md`).
- Bash scripts start with `set -euo pipefail`. Treat it as a default that
  catches some failures, not a guarantee: it is ignored in conditions, in
  `&&`/`||` lists, for `local x=$(cmd)`, and inside command substitution.
  Check the commands whose failure matters explicitly (`cd -- "$d" || exit`).
- Double-quote every expansion (`"$var"`, `"$(cmd)"`, `"$@"`,
  `"${arr[@]}"`); use an array, not a string, for a list of arguments.
- Run `shfmt` and `shellcheck` before reading the diff by eye; ShellCheck
  does not parse zsh.
- The interactive shell is zsh: an unquoted `$var` is not split there, so a
  check that passes in zsh can still break under bash or sh.

## Related

- `defense-in-depth` — validating input at each boundary a script crosses
- `golang-patterns` — where a script goes once it outgrows shell (`dotctl`)
- `security-review` / `security-reviewer` — shell injection found in a diff
