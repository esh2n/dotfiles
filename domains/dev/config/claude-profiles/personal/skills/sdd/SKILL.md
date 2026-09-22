---
name: sdd
description: Use only for large, ambiguous work that spans multiple files and whose approach is not yet settled. Do not use when the diff can be described in one sentence (skip planning entirely) or when the work merely spans files or has an uncertain method (that is the grilling skill's job). The owner invokes this explicitly; do not start it on your own.
disable-model-invocation: true
argument-hint: "<one-line goal>"
---

# Spec-Driven Development (SDD)

## Scope gate

This skill is for work that is both large and ambiguous: it will touch several files, and the shape of the solution is not yet decided. If the change can be described in one sentence, skip planning and just make it. If the change spans files or the method is uncertain, use the `grilling` skill to settle the approach in chat, one question at a time, and leave a short decision record — do not reach for a written spec. Only when neither shortcut applies — the scope is genuinely large and open questions would change the design — does a written SPEC earn its cost.

This is separate from any in-loop planning the harness already does while working (e.g. a running TODO list during implementation). This skill is only about whether to pause and write a spec before implementation starts.

## Step 1: Interview

Before writing anything, resolve the ambiguity that actually changes the design. Ask the owner one question at a time — never a batch. Each question must be high-impact: it changes which files get touched, where the boundary of the change sits, what is explicitly out of scope, or how the result will be verified. Do not ask about things you can determine yourself by reading the code.

Keep asking until nothing high-impact remains open. If a high-impact ambiguity still remains, do not write the SPEC yet — ask. A SPEC written over an unresolved high-impact question just encodes the wrong design more durably.

Stop as soon as the remaining questions are low-impact (naming, ordering, style) — record a reasonable default for those directly in the SPEC instead of asking.

High-impact questions tend to fall into a few shapes:

- **Files/boundaries** — "This could live in `src/auth/` alongside the existing session code, or as a new `src/oauth/` module. Which?"
- **Out of scope** — "Should this also migrate the existing sessions, or only apply to new logins?"
- **Verification** — "What should I run to prove this works end-to-end — an existing test suite, a new integration test, a manual curl against a running server?"

A question that doesn't change one of these (files touched, boundary, scope, or how success is checked) is probably not worth asking here.

## Step 2: Write SPEC.md

Once the interview has settled every high-impact question, write exactly one self-contained file: `SPEC.md`. Do not split it into multiple documents. Use this structure:

```markdown
# SPEC: <one-line goal>

## Goal

<one sentence: what this change accomplishes>

## Files touched and boundaries

<which files/directories will change, and what is explicitly inside that boundary>

## Out of scope

<what this change deliberately does not do, so the implementer doesn't over-reach>

## Verification

<end-to-end, machine-checkable commands and their expected output —
e.g. `pnpm test path/to/spec` should exit 0, `curl -s localhost:3000/health`
should return `{"status":"ok"}`. Not "tests pass" — the actual command
and the actual expected result.>

## Open questions resolved (optional)

<decisions made during the interview and why, for anything non-obvious>
```

Keep every section short. The SPEC is a contract, not a design document — if a section needs sub-documents, the work was probably not scoped correctly in step 1.

## Step 3: Where SPEC.md lives

Write `SPEC.md` at the repository root of the target project — not under `~/.config/work` or any other out-of-tree location. It is a temporary implementation contract, not a durable artifact: git-ignore it, or delete it once the implementation is complete. After implementation, the SPEC itself does not need to survive — only its conclusion does, as a short entry in the project's decision records (see `domains/dev/llm/harness/rules/decisions/2026-09-22-decision-records.md` for the format: Status, Problem, Decision, Alternatives considered, Consequences). Do not let SPEC.md linger in the tree after the work lands; a stale spec that no longer matches the code is worse than no spec.

## Step 4: Implement in a new session

Do not implement in the same session that ran the interview. Start a fresh session and have it read `SPEC.md` as its only required context. A fresh session carries none of the back-and-forth of the interview, so it reads the SPEC as the decision-complete contract it is meant to be, rather than reasoning from the (possibly meandering) conversation that produced it. If the SPEC is truly self-contained, this loses nothing.

## Never

- Do not produce a constitution/specify/plan/tasks multi-document flow. One SPEC.md, nothing else.
- Do not create task directories under `~/.config/work` or anywhere outside the target repository.
- Do not generate ADRs. If a decision needs to be recorded, it goes in the project's decision records, not a separate ADR file.
- Do not implement `status` or `list` subcommands — this skill has no subcommands and no persistent task tracking.
- Do not add a "Definition of Done" checklist beyond what the Verification section already specifies. Verification is the definition of done.
