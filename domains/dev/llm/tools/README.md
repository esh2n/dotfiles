# tools/

Executable projects that a skill drives but must not carry. A skill under
`../harness/skills/<name>/` holds procedure (`SKILL.md`, `references/`);
anything with `node_modules`, vendored binaries, build output or a deploy
target lives here and is referenced from the skill through
`$DOTFILES_ROOT` (`${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/<tool>`),
never by a path relative to the skill
(`../harness/rules/decisions/2026-09-22-skills-add-two-drop-duplicates-move-assets.md`).

| Directory | What it is | Driven by |
|---|---|---|
| `artifact-worker/` | Cloudflare Worker (R2 + D1 + Access) that hosts private artifact pages; `pnpm install`, deploy with `scripts/setup.mjs` | `yoki-artifact` (its CLI stays in the skill's `bin/`) |
| `grilling-render/` | Renders a grilling round document to one HTML page and collects answers locally; `pnpm install` (elkjs, yaml) | `grilling` |
| `writeup-kit/` | The writeup design kit: CLIs (`bin/`), CSS and template (`kit/`), vendored elk + lindera (`vendor/`), tests; nothing to install | `writeup`, `show-me`, `eli5`, `grilling` (skill docs stay in `harness/skills/writeup-kit/`) |

The dopa-shorts Remotion project moved the same way, to
`domains/creative/dopa-shorts/video/`.
