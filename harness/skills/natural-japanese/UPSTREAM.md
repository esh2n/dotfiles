# Upstream

Vendored from https://github.com/coji/natural-japanese

- Pinned commit: `9665ff1141e51b60faae67bb78a0e35e2e2dd14a`
- Vendored on: 2026-07-15
- Source path: `skills/natural-japanese/` (distribution copy; corpus/evals excluded)

## Update procedure

```sh
git clone --depth 1 https://github.com/coji/natural-japanese /tmp/nj
rsync -a --delete --exclude UPSTREAM.md /tmp/nj/skills/natural-japanese/ \
  "$DOTFILES_ROOT/harness/skills/natural-japanese/"
# update the pinned commit above, then:
jig apply --target claude --write
```

Scripts run via `uv run` (PEP 723 inline deps). `semantic.py` is heavyweight
(torch + sentence-transformers, ~1GB model download on first run).

## Local changes

SKILL.md instructions rendered in English (2026-09-23, ruling 2026-09-23-model-facing-english.md); references/ and scripts/ untouched. Re-apply after an upstream sync.
