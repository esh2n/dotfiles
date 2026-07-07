---
name: code-review-discipline
description: Meta-discipline for how to judge and how to review code and design — not language rules, but the reasoning stance behind a review. Use when reviewing someone else's code, self-reviewing your own work before shipping, deciding whether a design decision is sound, weighing a trade-off, proposing an approach for approval, or judging AI/bot review comments. Applies in any language or project.
metadata:
  origin: extracted
---

# Code Review Discipline

How to judge, and how to review. This skill is about the reasoning stance that sits *above* any specific lint rule or language convention: what evidence you gather before forming an opinion, how you defend a claim, how you name a trade-off, and how you check your own work before handing it over. It is language- and project-agnostic.

The failure mode it guards against is confident, fast, ungrounded answers: skimming one example and generalizing, repeating "the existing code does it this way" as if that settled anything, stating a guess as a fact, and shipping your own work without turning the same scrutiny on it. Slow down at the point of judgment.

## When to Activate

- Reviewing a pull request or a diff (someone else's or your own).
- Self-reviewing before you open a PR, ask for review, or mark work complete.
- Deciding whether a design or modeling decision is sound.
- Weighing a trade-off and having to say which side you took.
- Proposing an approach and wanting sign-off before you build it.
- Reading AI or bot review comments and deciding which to act on.

---

## 1. Survey many existing examples before you judge — never decide from one

Before you claim "this is how the codebase does X," look at *every* place X occurs, not the first one you found. One example is an anecdote; the pattern only emerges across the full set. The first hit is often the outlier, the oldest, or itself a mistake nobody has fixed.

**Why it works.** A single example cannot tell you whether you are looking at a convention, an accident, or a deprecated approach. Surveying the whole set reveals the *distribution* — what most cases do, where they diverge, and why. Only then can your recommendation carry weight.

BAD:
> "The `lead_configuration` module stores this as a flat column, so we should too." (Looked at exactly one module.)

GOOD:
> "I checked all seven modules that persist this kind of value. Five use a flat column, two use a nested structure — and the two nested ones are precisely the cases where the value has sub-fields that are queried independently. Ours has sub-fields, so the nested form fits; the flat majority isn't comparable."

Practical rule: when the task is large, dispatch a search that enumerates *all* occurrences rather than eyeballing a couple. If you only looked at one or two, say so explicitly and mark the conclusion as provisional.

---

## 2. No cargo-cult — "the existing code does it this way" is not a reason

Copying an existing pattern *because it exists* is dangerous. The existing code may be wrong, may predate a better approach, or may have been correct only under constraints that no longer apply. Reason from first principles: *why* is it that way, and does that why still hold here?

**Why it works.** Precedent without a reason propagates mistakes forever and blocks improvement. When you can articulate the underlying reason, you can tell whether it transfers to the new case — and you can catch the cases where blindly following precedent would be a bug.

BAD:
> "The older aggregate didn't use the array type here, so I won't either."

GOOD:
> "The older aggregate avoids the array type — but *why*? It's not a blanket rule. It's a design trade-off about which of purity / completeness / performance it chose to sacrifice. In our case that constraint doesn't apply, so following the precedent here would be cargo-culting. Here's the first-principles reason to decide differently."

Treat every "we've always done it this way" as a question, not an answer. Distrust existing code deliberately and say what would make it *not* apply.

---

## 3. Back every claim with an authoritative primary source — never state a guess as a fact

A design rationale or a factual assertion ("the database does X," "this API guarantees Y") must be grounded in the official documentation or specification, not in your memory or intuition. Attach the source to the claim. If you are guessing, label it a guess.

**Why it works.** Primary sources are the ground truth; recollection drifts and confident-sounding guesses erode trust the moment one turns out wrong. A claim with a citation can be checked and reused; a bare claim has to be re-litigated every time.

BAD:
> "The engine keeps these transactions serialized so ordering is guaranteed." (Stated flatly, no source, actually an assumption.)

GOOD:
> "Per the engine's official concurrency docs [link], writes in a read-write transaction are committed atomically but the batch DML statements are *not* ordered parent-before-child — so we can't rely on child rows seeing the parent. If I've misread it, this is the paragraph to check."

Two habits: (a) when someone asks "is that a guess?", the honest answer must already have been visible in how you phrased it; (b) when you list options or trade-offs, confirm you actually enumerated *all* of them ("there are only two, right? — no, there's a third") rather than the first that came to mind.

---

## 4. Name the trade-off explicitly — say what competes and what you gave up

Every non-trivial design decision sacrifices something. Make the sacrifice explicit: what two (or three) properties are in tension, and which one you chose to drop. A useful framing is the "pick 2 of 3" trilemma — when three desirable properties cannot all hold at once, state which corner you cut.

**Why it works.** A decision presented without its trade-off looks free, and free decisions can't be reviewed — there's nothing to push back on. Naming the sacrifice turns "I did X" into "I did X, giving up Y to get Z," which a reviewer can actually agree or disagree with. It also documents *why* the alternative was rejected, so nobody reopens it later.

A concrete instance of the pattern (domain modeling): **purity** (the domain layer depends on no out-of-process service), **completeness** (all domain logic lives in one place and never leaks into outer layers), and **performance** — you can hold any two but not all three at once. A lazy-load, for example, buys performance and purity at the cost of completeness (logic leaks into the layer that triggers the load). Whichever you build, say which corner you dropped.

BAD:
> "I added lazy loading here." (Silent about what it costs.)

GOOD:
> "I added lazy loading. On the trilemma this keeps performance and purity but sacrifices completeness — the trigger logic now lives in the outer layer instead of the aggregate. I chose that because the alternative (eager-load everything to stay complete) would fetch large payloads on every read. If completeness matters more here than read latency, we should flip it."

This generalizes beyond domain modeling: consistency vs. availability, latency vs. cost, flexibility vs. simplicity. The discipline is the same — name the axes, state the corner you cut, justify it.

---

## 5. Hold a point of view — set the rules aside and say which is the *better* implementation

Conventions and effort estimates are not opinions. When reviewing, you are expected to say, in your own voice, which choice is *better* — on its merits, not on how much work it is or what the style guide happens to mandate. A review without a stance is low-altitude.

**Why it works.** Rules encode yesterday's decisions; they can't judge a case they didn't anticipate. Effort ("this one is less work") answers a different question than quality ("this one is better"). Only a stated opinion, grounded in trade-offs, moves the decision forward — and it gives the author something concrete to agree with or argue against.

BAD:
> "Both approaches satisfy the style guide, and option A is a bit less code, so let's go with A."

GOOD:
> "Setting the convention aside: which is the better design? B expresses the invariant in the type so it can't be violated; A relies on a runtime check the caller can forget. B is the better implementation even though it's slightly more code. I'd take B — the effort difference isn't the deciding factor, correctness-by-construction is."

When you notice yourself reaching for "it's more work" or "the guide says so" as the *reason*, stop and answer the real question: which is genuinely better, and why?

---

## 6. Self-review harder than you review others

Before you hand over your own work, run the same scrutiny you'd apply to someone else's — arguably harder, because you're biased toward it. Use an explicit checklist so nothing is skipped.

**Why it works.** Authors are blind to their own intent-vs-implementation gaps; the code says what you wrote, not what you meant. A checklist externalizes the judgment and catches the classes of mistake that are invisible from the inside.

A self-review checklist (adapt per project):
- **Scope / granularity** — is this change the right size? One logical concern per PR, matching one task? No unrelated files dragged in?
- **Description quality** — does the PR description read as natural prose a human would write, and does it explain *why*, not just *what*?
- **CI** — is it actually green? (Not "should be" — confirmed.)
- **Comment quality** — any auto-generated, decorative, or restating-the-obvious comments? Remove them.
- **Code quality** — would you approve this if a stranger sent it to you?

BAD:
> Opening a PR with "LGTM, should pass CI" without having run the checks, with three generated boilerplate comments still in, and two files touched that have nothing to do with the task.

GOOD:
> "Self-reviewed: 1 concern per PR — yes; description is plain prose and states the reason — yes; CI green — confirmed locally and on the runner; no decorative comments — removed two; code quality — I'd approve this from a stranger. Ready."

---

## 7. Propose, then get review, then confirm, then build — one item at a time

Don't jump straight to implementation. First form a proposal *after* looking at existing patterns (principle 1), present it as "here's what I'd do — does this look right?", and wait for explicit approval before writing code. Present one item at a time and wait for the reaction before moving to the next.

**Why it works.** A proposal is cheap to change; committed code is expensive. Surfacing the plan first catches wrong assumptions while they cost nothing, and keeps the reviewer in control of direction. Batching many proposals at once forces the reviewer to evaluate them in bulk and buries the one that's actually wrong.

BAD:
> Reading the request, then immediately editing eight files across three concerns and presenting the finished diff.

GOOD:
> "I looked at how the existing cases handle this. Proposal: model it as a closed set of variants rather than a nullable flag. Trade-off is [X]. Does this direction look right before I build it?" — then wait. Once approved, implement *that one thing*, then bring the next question.

Corollary: when a decision is finalized, restate the final version cleanly rather than asking "is this OK?" — consolidate, don't poll for approval.

---

## 8. Scope discipline — don't smuggle unrelated changes into a review

A change should contain exactly what its stated purpose requires. No opportunistic renames, no reordered imports, no "while I was here" fixes, no generated-file churn mixed with hand edits. If you find a separate problem, report it separately.

**Why it works.** Unrelated diffs make review slower and riskier: the reviewer can't tell the load-bearing change from the noise, and a real regression can hide in the "harmless" cleanup. Different concerns often need different reviewers. Small, single-purpose changes are reviewed faster and reverted cleanly.

BAD:
> A PR titled "fix null handling in parser" that also renames a helper across 40 files, re-sorts a config, and removes an unrelated monitor "since it looked stale."

GOOD:
> "This PR only fixes the null handling — one concern. I noticed the helper naming is inconsistent and a monitor looks stale; I filed those as separate items so they get the right reviewer and can be reverted independently."

Watch specifically for: instruction was "remove the skip" but the diff *also* deletes a guard that was in scope of nothing (an out-of-scope regression); a rebase that silently reverts someone else's change; a mirror/parallel change that drifts out of parity. Restore anything the instruction didn't ask you to touch.

---

## 9. Record design decisions — the rejected options and the reasons — before implementing

A design decision must leave a written trail: the context, the alternatives considered, and *why* the chosen one won over the rejected ones. Write it *before* the implementation, not after. Without a recorded decision there is no anchor, and the design drifts with no way to push back later.

**Why it works.** The rejected alternatives and their reasons are the most valuable part of the record — they stop the same debate from reopening every few months and give future changes a boundary to check against ("does this still hold?"). Writing it before implementation forces the thinking to happen while it can still change the code, not as a post-hoc rationalization.

Keep the decision document and the code separate: **do not paste implementation code into the decision record.** The record captures *what was decided and why*; the code lives in the codebase. Duplicating it means two things to maintain and one that will silently go stale.

BAD:
> Building the feature first, then writing a one-line "we chose approach A" with no alternatives and a copy of the final struct pasted in — which is now out of date the moment the code changes.

GOOD:
> A short decision record written up front: "Context: [...]. Options: (A) [...], (B) [...], (C) [...]. Decision: B. Why not A: [...]. Why not C: [...]. Trade-off accepted: [...]." No code pasted — a link to where it lives instead.

---

## 10. Comments and prose carry WHY only — and read like a human wrote them

Comments explain *why* and *why not*, never *how* or *what* — the how and what are already in the code. And the prose itself (comments, commit messages, PR descriptions, docs) must read naturally, stripped of the verbosity, decoration, and translated-sounding phrasing that machine-generated text tends to carry.

**Why it works.** A comment that restates the code is pure maintenance cost: it goes stale and adds nothing. A comment that captures the constraint, the reason, or the rejected alternative survives refactors and answers the question the code can't. And AI-generated prose has recognizable tells — ornamental section markers, bullet lists where a sentence belongs, restating the obvious, uniform robotic rhythm — that signal low effort and slow the reader down.

BAD:
> `// loop over the items and add each one to the map` (restates the code — WHAT)
> A PR description built from decorative headers and a wall of identical bullet points.

GOOD:
> `// batch size capped at 100 because the backend rejects larger writes` (constraint / reason — WHY)
> A PR description written as a few plain paragraphs: the problem, what changed, what to watch out for.

Signals of machine-generated prose to remove: em-dash and ornamental-symbol overuse, meta-preambles ("This is a draft summarizing..."), bullet lists with no rhythm, field-name paraphrases as comments, and self-congratulatory adjectives. Do not treat "a human wrote this example" as proof it's good — in a codebase heavy with generated code, the example may itself be machine output. Judge the prose on its own merits.

---

## 11. Don't rubber-stamp automated review — but don't reflexively ignore it either

AI and bot review comments are input, not verdicts. Do not trust their severity labels; a "critical" from a bot is a claim to verify, not a fact. A human filters by *actual confidence and real impact*, not by the color of the badge. At the same time, automated review does catch real bugs — so blanket-ignoring it is just as wrong as blanket-accepting it.

**Why it works.** Automated reviewers have systematic blind spots — they miss call-sites, misread a skip/validation as absent, inflate complexity, and invent findings that don't exist — so their severity is unreliable. But they also surface genuine defects a human skimmed past. Selecting by verified confidence and impact keeps the real bugs and discards the noise, which neither reflex (accept-all / reject-all) achieves.

BAD:
> "The bot marked this CRITICAL, so I'll rewrite the function." (Deferring to the label.)
> "It's just the bot, ignore everything it says." (Throwing out the real finding with the noise.)

GOOD:
> "Of the bot's twelve comments: three are false positives — it missed the call-site that already validates this, and flagged a skip that's actually present two lines up. Two are real: an inverted condition and a unique-constraint collision that would silently drop data. I'm acting on those two and dismissing the rest, regardless of the severity labels it attached."

When a defect *does* slip through, ask the second-order question: *why did the existing tests not catch it?* — and add the regression test, not just the fix. The classes worth suspecting first: type confusion, boundary/off-by-one, state-transition gaps, string-match mismatches, and concurrency.

---

## Quick Reference

1. **Survey all examples** before judging — one is an anecdote.
2. **No cargo-cult** — "it exists" is not a reason; ask *why* and whether the why still holds.
3. **Cite a primary source** — label guesses as guesses; enumerate *all* the options.
4. **Name the trade-off** — say what competes and which corner you cut (pick 2 of 3).
5. **Hold a point of view** — which is *better*, not which is less work or what the rule says.
6. **Self-review hardest** — scope, description, CI, comments, quality — with a checklist.
7. **Propose → review → confirm → build**, one item at a time; wait for the reaction.
8. **Scope discipline** — no unrelated diffs; report separate problems separately.
9. **Record decisions up front** — rejected options + reasons; don't paste code into the record.
10. **Comments carry WHY only**; prose reads like a human, free of machine tells.
11. **Filter automated review** by confidence and impact, not severity labels — keep the real bugs.
