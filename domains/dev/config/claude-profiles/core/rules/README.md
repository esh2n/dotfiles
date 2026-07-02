# Rules

Rules are composed by `claude-switch` into `~/.claude/rules/`:

- `common/` — language-agnostic principles, always installed (from core)
- `<language>/` — provided by language packs; present only when the pack is
  enabled (`claude-switch pack list`)

## Rule Priority

When language-specific rules and common rules conflict, **language-specific
rules take precedence** (specific overrides general). `common/` defines
universal defaults; enabled packs override them where language idioms differ.

## Rules vs Skills

- **Rules** define standards, conventions, and checklists that apply broadly
  (e.g., "80% test coverage", "no hardcoded secrets").
- **Skills** provide deep, actionable reference material for specific tasks
  (e.g., `python-patterns`, `golang-testing`). Rules tell you *what* to do;
  skills tell you *how*.

## Adding rules for a new language

Put them in `claude-profiles/packs/<lang>/rules/<lang>/` and start each file
with a reference to its common counterpart:

> This file extends [common/xxx.md](../common/xxx.md) with <Language> specific content.
