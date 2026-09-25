# Upstream

Vendored from https://github.com/obra/superpowers (MIT, see LICENSE)

- Pinned commit: `5bf4e78011075bcfc0dc295f0724994cd123ee71` (2026-09-19)
- Vendored on: 2026-09-23
- Source path: `skills/verification-before-completion/SKILL.md` (the directory holds only that file upstream)
- Ruling: `../../rules/decisions/2026-09-22-skills-add-two-drop-duplicates-move-assets.md`
  (read in full before vendoring; no scripts, no network calls, no paths outside the target repo)

## Local changes

- None. Verbatim.

## Update procedure

```sh
gh api repos/obra/superpowers/contents/skills/verification-before-completion/SKILL.md \
  --jq .content | base64 -d > "$DOTFILES_ROOT/harness/skills/verification-before-completion/SKILL.md"
# update the pinned commit, then: jig apply --target claude --write
```
