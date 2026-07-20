# Upstream

Vendored from https://github.com/coji/natural-japanese

- Pinned commit: `9665ff1141e51b60faae67bb78a0e35e2e2dd14a`
- Vendored on: 2026-07-15
- Source path: `skills/natural-japanese/` (distribution copy; corpus/evals excluded)

## Update procedure

```sh
git clone --depth 1 https://github.com/coji/natural-japanese /tmp/nj
rsync -a --delete --exclude UPSTREAM.md /tmp/nj/skills/natural-japanese/ \
  "$DOTFILES_ROOT/domains/dev/config/claude-profiles/base/skills/natural-japanese/"
# update the pinned commit above, then:
claude-switch apply
```

Scripts run via `uv run` (PEP 723 inline deps). `semantic.py` is heavyweight
(torch + sentence-transformers, ~1GB model download on first run).
