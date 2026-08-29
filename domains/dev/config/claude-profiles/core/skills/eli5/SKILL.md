---
name: eli5
description: Explain a topic like I'm a 5 year old — a dead-simple picture explainer published as an HTML Artifact (big inline-SVG pictures, few words, one idea per panel). Use when the user types /eli5 <topic>, asks "how does X actually work, simply", "explain like I'm five", or wants a throwaway picture to show a non-expert (family, a new hire, a stakeholder) — an Artifact for one conversation, not a page anyone keeps; 「説明ページを作って」 for the team is writeup 絵解き. Not for reference docs or deep dives (use writeup for a page that is kept), a quick in-chat view (use show-me), or anything about the codebase and its design in front of you — a design, a decision, or a mechanism a colleague asks about goes to writeup or show-me, however simply it is meant to be explained.
metadata:
  origin: Anthropic official eli5 skill (one-line prompt), extended
---

# eli5

Topic: $ARGUMENTS

Explain the topic to someone who knows nothing about it, as a **picture-first HTML Artifact**: big drawings, few words, one idea per screen. The reader should be able to retell it in one breath afterwards.

Default language follows the conversation (this harness: Japanese). If the argument contains `--en`, write in English.

## Non-negotiables

1. **Pictures carry the meaning, words only label them.** Every panel has one inline SVG drawing; text per panel ≤ 25 words (≤ 50 Japanese characters). If a panel needs more text, it is two ideas — split it.
2. **One concrete analogy, used all the way through.** Pick it in step 2 and never switch mid-page. Mixed metaphors are the #1 way these explainers fail.
3. **Zero jargon in the body.** Any term a 10-year-old would not know either gets its own panel or is cut. The real technical word may appear once, in a small "grown-ups call this…" caption, so the reader can google it.
4. **Truthful simplification.** Leave things out; never say things that are false. If the analogy breaks somewhere important, add one "…but not quite" panel instead of pretending.
5. **5–8 panels.** Fewer means the mechanism is missing; more means it is not an eli5.

## Workflow

### 1. Pin the mechanism before drawing anything

Write (for yourself, not the page) three bullets:
- the problem the thing solves
- the core move — the one mechanism that makes it work
- the most common misunderstanding

If you cannot fill these from what you already know, delegate a short lookup to a subagent; do not build on a guess.

### 2. Choose the analogy

Pick something from everyday physical life (kitchen, playground, post office, traffic…) that shares the *mechanism*, not just the vibe. Test it: does the analogy predict the common misunderstanding from step 1? If not, pick another.

### 3. Storyboard

Panels in this order, each a single sentence of "what it shows":

1. **Hook** — the everyday situation the reader already knows
2. **The problem** — what goes wrong without the thing
3–5. **The mechanism** — the analogy doing its work, one step per panel
6. **Back to reality** — the same drawing with the real names swapped in
7. *(optional)* **Not quite** — where the analogy stops being true
8. **Say it back** — the whole idea in one sentence the reader can repeat

### 4. Build the Artifact

- Load `artifact-design` (required) and `artifact-diagramming` (for the SVGs) before writing the file.
- One scrolling page, one panel per screen-ish section; panels stack vertically on narrow screens.
- Drawings are inline SVG with a handful of large shapes and thick strokes — no external images, no photos, no icon fonts. Use `currentColor` / CSS tokens so every drawing survives both light and dark theme. If the `writeup-kit` skill is installed (`../writeup-kit/kit/writeup.css` next to this skill, or `~/.claude/skills/writeup-kit/`), take the color and type tokens from it so explainers match the rest of the document family; do not use its components — pictures stay pictures.
- Type: one large friendly face, headline ≥ 2rem, body ≥ 1.25rem. No bullet lists, no tables, no code blocks in the body.
- Title: the topic as a short noun phrase. Favicon: one emoji matching the analogy.
- Write the file to the scratchpad and publish with the Artifact tool; give the user the link.

### 5. Verify before handing over

Re-read the page once as the reader and check:
- [ ] every panel has exactly one drawing and one idea
- [ ] no jargon outside the "grown-ups call this…" captions
- [ ] the analogy never changes
- [ ] nothing stated is actually false (step 1 bullets still hold)
- [ ] the "say it back" sentence alone is a correct summary

Fix what fails, republish to the same path, then report: the link, the analogy you chose, and what you deliberately left out.

## Options

- `--depth 10` / `--depth adult` — allow slightly more words per panel and one extra mechanism panel; the picture-first rule still applies.
- `--en` — write in English regardless of conversation language.
