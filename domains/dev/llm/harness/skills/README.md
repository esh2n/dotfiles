# skills/

Empty until milestone 2 of the generator (see `../jig/README.md`).

The 88 skills still live at
`domains/dev/config/claude-profiles/{core,packs/*,personal}/skills/` and are
still delivered by `yoki-switch` through `~/.claude/.skills-merged` and
`~/.agents/skills`. Milestone 1 of the generator owns
`~/.claude/settings.json` only and leaves both of those symlink trees alone,
so moving the skills now would break delivery with nothing yet able to
replace it.

What milestone 2 moves here, and under which rulings:

- one flat tree, no `core`/`packs`/`personal` split
  (`../rules/decisions/2026-09-22-config-layout-no-personal-layer.md`)
- no `commands/` directory: a slash command is a skill with
  `disable-model-invocation: true`
  (`../rules/decisions/2026-09-22-commands-are-skills.md`)
- `writing-skills` dropped, `using-git-worktrees` and
  `verification-before-completion` added from obra/superpowers, and the ~600 MB
  of vendored assets moved out of the skills that carry them
  (`../rules/decisions/2026-09-22-skills-add-two-drop-duplicates-move-assets.md`)
