---
name: eli5
description: Explain a topic plainly to an adult who is new to it — a picture-first explainer published as an HTML Artifact (one diagram per panel, the real technical terms kept and explained where they first appear, no analogies). Use when the user types /eli5 <topic>, asks "how does X actually work, simply", "explain like I'm five", or wants a throwaway picture to show someone outside the field (a new hire, a stakeholder) — an Artifact for one conversation, not a page anyone keeps; 「説明ページを作って」 for the team is the writeup kind 絵解き (picture explainer). Not for reference docs or deep dives (use writeup for a page that is kept), a quick in-chat view (use show-me), or anything about the codebase and its design in front of you — a design, a decision, or a mechanism a colleague asks about goes to writeup or show-me, however simply it is meant to be explained.
metadata:
  namespaces: [doc]
  origin: Anthropic official eli5 skill (one-line prompt), rewritten for the house writing rules
---

# eli5

Topic: $ARGUMENTS

Explain the topic to a capable adult (about thirty) who is new to the field, as a **picture-first HTML Artifact**: one diagram per panel, short text, one idea per panel. The name is kept for the trigger; the reader is not a child. The reader should be able to retell the mechanism in their own words, using the real terms, afterwards.

Default language follows the conversation (this harness: Japanese). If the argument contains `--en`, write in English. Japanese text follows the `plain-japanese` skill.

## Non-negotiables

1. **Diagrams carry the structure, words name the parts.** Every panel has one inline SVG diagram of the real thing: its parts, the flow between them, its states. Text per panel ≤ 40 words (≤ 80 Japanese characters). If a panel needs more, it is two ideas: split it.
2. **No analogies, metaphors or personification.** Draw and name the actual components and what they do. A kitchen, a post office or a component that "wants" or "thinks" never stands in for the mechanism (`rules/common/90-writing.md`).
3. **Keep the technical terms.** Use the term the field uses, and explain it in the same or the next sentence where it first appears, by what it does. Never replace it with a softer word, and never collect terms in a glossary or a prerequisites panel at the top.
4. **Move between the general and the specific.** Each mechanism panel pairs the general rule with one concrete instance (real names, real values, a real command or request). Do not label panels 「抽象」 or 「具体」; let the pairing show.
5. **Truthful simplification.** Leave things out; never say things that are false. Say in one line what was left out when it matters.
6. **5–8 panels.** Fewer means the mechanism is missing; more means it belongs in a writeup.

## Workflow

### 1. Pin the mechanism before drawing anything

Write (for yourself, not the page) three bullets:
- the problem the thing solves
- the core move: the one mechanism that makes it work
- the most common misunderstanding

If you cannot fill these from what you already know, delegate a short lookup to a subagent; do not build on a guess.

### 2. Choose the concrete instance

Pick one real case that shows the mechanism end to end (a real request, a real file, real numbers). It runs through every mechanism panel, so the reader follows one thing from start to finish. Test it: does it make the common misunderstanding from step 1 visible? If not, pick another.

### 3. Storyboard

Panels in this order, each a single sentence of "what it shows":

1. **The situation** — where the reader meets this thing, with the real names
2. **The problem** — what goes wrong without it, shown on the concrete instance
3–5. **The mechanism** — one step per panel: the general rule and the instance going through it, terms explained where they first appear
6. **The misunderstanding** — the common wrong picture next to the right one
7. *(optional)* **Limits** — where the mechanism does not apply, or what was left out
8. **Say it back** — the whole idea in one sentence, using the real terms

### 4. Build the Artifact

- Load `artifact-design` (required) and `artifact-diagramming` (for the SVGs) before writing the file.
- One scrolling page, one panel per screen-ish section; panels stack vertically on narrow screens.
- Diagrams are inline SVG: boxes, arrows, timelines, state transitions, with labels in the real terms. No clip-art, no photos, no icon fonts. Use `currentColor` / CSS tokens so every drawing survives both light and dark theme. If the `writeup-kit` skill is installed (`${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/writeup-kit/kit/writeup.css`), take the color and type tokens from it so explainers match the rest of the document family; do not use its components — diagrams stay diagrams.
- Type: headline ≥ 2rem, body ≥ 1.1rem. A short code line or a small table is allowed when it is the concrete instance itself.
- Title: the topic as a short noun phrase. Icon: one plain word for the subject.
- Write the file to the scratchpad and publish with the Artifact tool; give the user the link.

### 5. Verify before handing over

Re-read the page once as the reader and check:
- [ ] every panel has exactly one diagram and one idea
- [ ] no analogy, metaphor or personification anywhere
- [ ] every technical term is explained where it first appears, and none was swapped for a softer word
- [ ] each mechanism panel shows the general rule and the concrete instance
- [ ] nothing stated is actually false (step 1 bullets still hold)
- [ ] the "say it back" sentence alone is a correct summary

For Japanese, run the `plain-japanese` checks on the page text. Fix what fails, republish to the same path, then report: the link, the concrete instance you chose, and what you deliberately left out.

## Options

- `--depth expert` — allow more words per panel and one extra mechanism panel; the diagram-first rule still applies.
- `--en` — write in English regardless of conversation language.
