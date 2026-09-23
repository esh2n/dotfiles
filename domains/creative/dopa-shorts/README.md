# dopa-shorts

Assets of the `dopa-shorts` skill (text to 9:16 short video). The skill
itself — script grammar, workflow, example script — stays at
`$DOTFILES_ROOT/domains/dev/llm/harness/skills/dopa-shorts/`; this directory
holds what a skill must not carry.

- `video/` — the Remotion renderer (React + zod + tsx). The script schema of
  record is `video/src/schema.ts`. Install and bootstrap once:

  ```bash
  cd "${DOTFILES_ROOT:-$HOME/dotfiles}/domains/creative/dopa-shorts/video"
  pnpm install && pnpm bootstrap   # bootstrap downloads the character art
  ```

  Then `pnpm voice <script.json>`, `pnpm render <script.json> [--draft]`,
  `pnpm test`, `pnpm typecheck`. `node_modules/`, `out/` and `.cache/` are
  git-ignored; BGM under `video/public/bgm/` is supplied by hand.
