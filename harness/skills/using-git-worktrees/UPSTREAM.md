# Upstream

Vendored from https://github.com/obra/superpowers (MIT, see LICENSE)

- Pinned commit: `5bf4e78011075bcfc0dc295f0724994cd123ee71` (2026-09-19)
- Vendored on: 2026-09-23
- Source path: `skills/using-git-worktrees/SKILL.md` (the directory holds only that file upstream)
- Ruling: `../../rules/decisions/2026-09-22-skills-add-two-drop-duplicates-move-assets.md`
  (read in full before vendoring; no scripts, no network calls, no paths outside the target repo)

## Local changes

- Step 2 "Project Setup": package managers follow the language overrides in
  `rules/common/40-languages.md` — lockfile-detected Node manager (pnpm/bun/npm/yarn,
  frozen lockfile), `uv sync` instead of pip/poetry — and a note that install runs
  third-party build scripts (run sandboxed or after consent; no lockfile → ask).

## Update procedure

```sh
gh api repos/obra/superpowers/contents/skills/using-git-worktrees/SKILL.md \
  --jq .content | base64 -d > /tmp/SKILL.md
diff /tmp/SKILL.md "$DOTFILES_ROOT/harness/skills/using-git-worktrees/SKILL.md"
# re-apply the local change above, update the pinned commit, then: jig apply --target claude --write
```
