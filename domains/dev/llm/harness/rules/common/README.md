# rules/common/

The always-on rules: `jig apply --target claude` concatenates every `*.md`
here, in file-name order, into the generated `~/.claude/AGENTS.md` (with
`CLAUDE.md → AGENTS.md`). This README is skipped. The two-digit prefix is the
reading order; no file carries `paths:` frontmatter, because these load
unconditionally.

Language-specific rules live in sibling directories (`../go/`, `../python/`,
…), each file keyed by `paths:` frontmatter, and are delivered as
`~/.claude/rules/<lang>` links instead — never rendered into AGENTS.md
(`../decisions/2026-09-22-config-layout-no-personal-layer.md`). `common/` is
never linked there, or it would load twice.

Two things the generated AGENTS.md carries besides these rules:

- one line pointing at `../research/INDEX.md` — read the index before
  researching, do not re-investigate settled facts
  (`../decisions/2026-09-22-writeup-markdown-source-two-builds.md`)
- one bold line per accepted decision note, its `rule:` line copied verbatim
  (`../decisions/2026-09-22-decision-records.md`,
  `../decisions/2026-09-23-model-facing-english.md`)

Everything here is written in English: it is read by the model, not the owner.
Codex truncates AGENTS.md at 32 KiB, so the generator reports the byte size and
warns past that line.
