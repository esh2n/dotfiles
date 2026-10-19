---
name: semantic-html
description: Use when writing or reviewing HTML or template markup and a semantics or accessibility question comes up — a div or span with a click handler, a link that runs an action, an icon button with no name, an input labelled only by its placeholder, skipped heading levels, unlabelled landmarks, missing or meaningless alt text, ARIA roles on native elements, aria-hidden on something focusable, a hand-built modal, positive tabindex, a data table without th, async messages with no live region, or a WCAG 2.2 criterion to check in a diff. Covers the accessibility tree, ARIA rules, focus management, forms, tables, and which tools catch what (html-validate, axe, Lighthouse) and what still needs a person.
metadata:
  namespaces: [lang/html]
  verified: 2026-10
---

# Semantic HTML

Writing or reviewing HTML, templates or rendered markup: read
`references/review-standard.md` first — the single semantic HTML and
accessibility review standard (items with sources, WCAG 2.2 criteria that a
diff can show, the accessibility tree model, tool mapping) shared by the
writer and `code-reviewer`. CSS-side accessibility (focus outlines, reduced
motion, zoom-safe units, reflow) is in
`css-modern/references/review-standard.md`; JSX component structure is in
`react-patterns`.

## Rules of thumb

- Use the native element before ARIA: `<button>` for actions, `<a href>`
  for navigation, `<label>` for inputs, `<dialog>` with `showModal()` for
  modals, `<table>` with `<th>` for data.
- Every control has a role, an accessible name and a current state.
- Everything works by keyboard, in DOM order, with visible focus that is
  never lost when content changes.
- Automated tools catch only part of the problems. A clean axe or
  html-validate run is not a pass; keyboard, screen-reader and zoom checks
  on the rendered page need a person.

## Related

- `css-modern` — CSS review standard and native replacements
- `react-patterns` — the same rules applied in JSX components
- `human-interface-guidelines` — cognitive and interaction evaluation
- `e2e-testing` — running axe in Playwright on rendered pages
