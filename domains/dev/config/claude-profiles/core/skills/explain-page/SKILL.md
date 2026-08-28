---
name: explain-page
description: Deprecated. Formerly wrote Markdown with custom directives for the explain-pages viewer. Use the writeup skill instead for any document that should be kept (設計 / 決定記録 / 調査まとめ / 参考資料まとめ / PBI 資料 / 絵解き / 作業メモ / 議事録), show-me for an in-chat view, or eli5 for a beginner picture explainer. Only invoke this skill when the user explicitly asks for the old explain-pages format.
---

# explain-page (deprecated)

This skill is retired. Its store (`~/.local/share/explain-pages/pages/`, 198
Markdown pages) was migrated on 2026-08-28 into the writeup store
(`~/.local/share/writeup/`, HTML pages on writeup-kit; 11 pages that used
`:::aggregate` / `:::board` / `:::dddboard` / `:::html` are frozen under
`legacy/`). The React viewer in the explain-pages repository is no longer
maintained.

Use instead:

- `writeup` — a durable page in the store (kind-based sections, lint,
  self-check, git history, publish).
- `show-me` — the smallest in-chat view of the current topic.
- `eli5` — a picture explainer for non-experts.

If the user insists on the old format, tell them it is deprecated and offer
to produce the same content as a writeup page.
