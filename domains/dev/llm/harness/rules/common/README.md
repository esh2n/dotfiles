# rules/common/

Empty until milestone 2 of the generator (see `../../jig/README.md`).

This is where the language-agnostic rules go — the source the generated
`~/.claude/AGENTS.md` (and `CLAUDE.md → AGENTS.md`) is rendered from, with the
language-specific rules in sibling directories keyed by `paths:` frontmatter
instead of by a pack switch
(`../decisions/2026-09-22-config-layout-no-personal-layer.md`).

Today those rules still live at
`domains/dev/config/claude-profiles/core/rules/` and
`packs/<lang>/rules/<lang>/`, and `~/.claude/rules` is still a `yoki-switch`
symlink. Milestone 1 generates nothing for it.

Two things the generated AGENTS.md carries besides the rules themselves, both
already implemented as a renderer and shown in `jig apply --target claude`'s
dry-run preview:

- one line pointing at `../research/INDEX.md` — read the index before
  researching, do not re-investigate settled facts
  (`../decisions/2026-09-22-writeup-markdown-source-two-builds.md`)
- one bold line per accepted decision note, linking it
  (`../decisions/2026-09-22-decision-records.md`)
