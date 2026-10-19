# Upstream

Vendored from https://github.com/coji/natural-japanese

- Version: v1.6.0
- Pinned commit: `03bc944a0c4a9f0b2a66eab065b30de5c529bf08` (main, 2026-10-16; the
  `v1.6.0` tag is `a739fee`, and `skills/natural-japanese/` is identical between them)
- Vendored on: 2026-10-19 (previous pin `9665ff1141e51b60faae67bb78a0e35e2e2dd14a`, 2026-07-15)
- Source path: `skills/natural-japanese/` (distribution copy; the repository's corpus/ and
  evals/ are excluded)

## Update procedure

```sh
git clone --depth 1 https://github.com/coji/natural-japanese /tmp/nj
rsync -a --delete --exclude UPSTREAM.md --exclude evals/ \
  --exclude references/patterns-en.md --exclude scripts/__pycache__/ \
  /tmp/nj/skills/natural-japanese/ "$DOTFILES_ROOT/harness/skills/natural-japanese/"
# re-apply the local changes below, update the pinned commit above, then:
jig apply --target claude --write
```

Scripts run via `uv run` (PEP 723 inline deps). `semantic.py` is heavyweight
(torch + sentence-transformers, ~1GB model download on first run).

## Local changes

Identical to upstream: `scripts/` (all `.py` files and `fixtures/`, byte for byte) and
`assets/style-profile-template.md` (a Japanese template for a user-facing output file,
kept as data).

Translated to English (ruling 2026-09-23-model-facing-english.md): the instruction prose,
headings and frontmatter description of `SKILL.md`, `references/diagnose.md`,
`references/manual-checklist.md` and `references/doctypes/*.md`. Japanese example
sentences, word lists, 「」-quoted patterns, fenced templates, before/after blockquotes and
material paragraphs stay Japanese as data. Section numbers (§1–§7) are unchanged, because
`lint.py` output refers to `SKILL.md §3`.

Differs from upstream, with the reason:

- `SKILL.md` frontmatter keeps `metadata: namespaces: [doc]` (this repository's skill
  namespace convention) and the description keeps an "Out of scope" sentence (technical
  document structure, Markdown formatting), which upstream dropped in v1.6.0; it keeps
  the negative case in `evals/trigger-cases.json` routed to other skills.
- `SKILL.md` defines `SK` and calls the scripts by absolute path with a fallback to the
  dotfiles checkout, so they work from any working directory (upstream uses
  `scripts/...` relative to the skill).
- `SKILL.md` §4 names `writeup-kit`'s Node lint as a fallback when `uv` is unavailable.
  Before this sync it was the preferred lint; it is now a fallback because it ports the
  older lint (fewer detectors, IPADIC) and has no paragraph-by-paragraph list, which
  v1.6.0's §3 requires.
- `SKILL.md` ends with a pointer to `references/patterns-en.md`.
- `references/patterns-en.md` (English AI-writing pattern catalog) and `evals/`
  (`trigger-cases.json`, `_judge.json`: trigger-routing cases against this repository's
  other skills) are local files, not from upstream.
