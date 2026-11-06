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

The generated AGENTS.md carries one more line besides these rules: a bold
line pointing at both indexes, `../knowledge/INDEX.md` (settled facts) and
`../research/INDEX.md` (research of the last 14 days) — read them before
researching, do not re-investigate settled facts. jig renders it because the
links must be absolute.

Decision notes (`../decisions/`) are not rendered into AGENTS.md
(accepted by the owner, 2026-11-06). A requirement every
session must follow is written here, in a skill, or as a guard rule or test;
never in a decision note alone.

Everything here is written in English: it is read by the model, not the owner.
Codex truncates AGENTS.md at 32 KiB, so the generator reports the byte size and
warns past that line.
