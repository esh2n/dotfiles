# skills/

One flat tree: `<name>/SKILL.md` plus whatever references the skill needs.
`jig apply --target claude` links each directory into `~/.claude/skills/<name>`
(a managed directory, so Claude Code's own `synced/` entry survives); other
harnesses get it from milestone 3 of the generator (`../jig/README.md`).

Rulings that shape this directory:

- no `core`/`packs`/`personal` split and no per-machine pack switch — every
  skill is present, the judgment service picks per task
  (`../rules/decisions/2026-09-22-config-layout-no-personal-layer.md`)
- no `commands/`: a slash command is a skill with
  `disable-model-invocation: true`; a model-only background skill is
  `user-invocable: false`
  (`../rules/decisions/2026-09-22-commands-are-skills.md`)
- a skill holds procedure, never build artifacts or media: the renderers and
  projects that used to sit inside `grilling`, `writeup-kit`, `artifact`
  and `dopa-shorts` live under `domains/dev/llm/tools/` and
  `domains/creative/`, referenced through `$DOTFILES_ROOT`
  (`../rules/decisions/2026-09-22-skills-add-two-drop-duplicates-move-assets.md`)
- vendored skills carry `UPSTREAM.md` with the pinned commit and the local
  changes (`natural-japanese`, `using-git-worktrees`,
  `verification-before-completion`)
- instructions are English; a skill about Japanese keeps Japanese examples
  (`../rules/decisions/2026-09-23-model-facing-english.md`)

Retired in the move (recoverable from git before 4bde085): `writing-skills`
(duplicate of skill-creator), `continuous-learning-v2` (a separate memory
system, `2026-09-22-memory-files-only.md`), and the commands `cost-report`
(read the yoki metrics log), `instinct-status` and `learn` (the same memory
system), `plan` (the harness's plan mode covers it,
`2026-09-23-plan-by-size-grill-default.md`) and `quality-gate` (the Stop gate
hook covers it, `2026-09-22-format-on-edit-gate-on-stop.md`).

Retired with yoki (2026-09-23): `yoki-agent` and `yoki-graph` (their engine
was the yoki-graph runtime; a workflow script now runs on the harness itself),
`cost-tracking` (its data source was yoki's metrics log; LiteLLM's Prometheus
metrics replace it). `yoki-artifact` was renamed `artifact` and stays until the
writeup private build exists.
