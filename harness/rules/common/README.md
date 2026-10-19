# rules/common/

The always-on rules: `jig apply --target claude` concatenates every `*.md`
here, in file-name order, into the generated `~/.claude/AGENTS.md` (with
`CLAUDE.md → AGENTS.md`). This README is skipped. The two-digit prefix is the
reading order; no file carries `paths:` frontmatter, because these load
unconditionally.

Language-specific guidance does not live under `rules/` at all: it is in the
language's skill (`../../skills/<lang>-patterns`, `<lang>-testing`, …), which
every harness receives through its skills mount
(`../decisions/2026-09-23-language-rules-fold-into-skills.md`; the earlier
`rules/<lang>/` + `paths:` delivery reached Claude Code only). `rules/` holds
only `common/`, `decisions/`, `knowledge/` and `research/`; `common/` is never
linked under `~/.claude/rules`, or it would load twice.

Two things the generated AGENTS.md carries besides these rules:

- one bold line pointing at both indexes, `../knowledge/INDEX.md` (settled
  facts) and `../research/INDEX.md` (research of the last 14 days) — read them
  before researching, do not re-investigate settled facts
  (`../decisions/2026-09-22-writeup-markdown-source-two-builds.md`,
  `../decisions/2026-09-27-records-flow-and-stock.md`)
- one plain line per accepted decision note, `- <rule> (<file>)`, its `rule:`
  line copied verbatim; the notes' directory is named once per section. A note
  with `scope: repo` under its `rule:` line goes only into the dotfiles
  checkout's own untracked AGENTS.md
  (`../decisions/2026-09-23-model-facing-english.md`,
  `../decisions/2026-10-18-decision-scope.md`)

Everything here is written in English: it is read by the model, not the owner.
Codex truncates AGENTS.md at 32 KiB, so the generator reports the byte size and
warns past that line.
