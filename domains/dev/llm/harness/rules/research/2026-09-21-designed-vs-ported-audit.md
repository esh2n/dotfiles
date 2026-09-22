---
question: "Is jig's implementation genuinely designed from first principles per the approved design docs, or is it a disguised port of yoki's file/merge model?"
date: 2026-09-21
verdict: "Core — the guard evaluator, subject extraction, the DecisionProvider/jev judgment layer, and all four harness adapters — is genuinely designed from first principles and matches design-v2.md line for line; but one subsystem (domain/compose, domain/permissions, domain/mcp, and app/install/install-profile.ts) is a live yoki-canonical liability: it reproduces yoki-switch's static core-to-packs-to-personal merge model wholesale, was never specified in any design document, predates design-v2.md entirely, and survived the recent revert untouched except for its CLI entry point."
unverified: []
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# jig: designed-from-first-principles vs yoki-port audit

Method: read the approved design docs (`design-v2.md`, `decisions.md`, task 001) as the
intended design; read the actual jig source; read `git show` for every session commit;
grepped for the "packs" concept across `src/`. Treated neither jig nor yoki as
presumptively correct.

## Part A — subsystem table

| subsystem | verdict | evidence | if yoki-port: what was copied |
|---|---|---|---|
| guard/policy evaluator (`domain/policy/evaluate.ts`, `domain/policy/types.ts`) | **designed** | `evaluate.ts:1-29` header states floor>forbid>ask>mode precedence and the strict-reading-for-permit / lenient-reading-for-forbid asymmetry — this is design-v2 §3.1/§3.2 (D-18) verbatim, cross-checked against Claude Code/Codex/Gemini/OpenHands, not yoki's regex-only model | — |
| subject extraction (`domain/subject/extract.ts`, `walk.ts`, `wrappers.ts`) | **designed** | `extract.ts:1-10` documents `unbash`-based parse, byte/time/node budgets, `fromString`/`fromArgv` dual entry — matches design-v2 §3.2 F14 research (unbash chosen over tree-sitter-bash/mvdan-sh with reasons); no yoki concept present (yoki has no subject-extraction layer at all) | — |
| decision/judgment layer (`domain/decision/provider.ts`, `app/routing/select-skills.ts`, `select-tier.ts`) | **designed** | `provider.ts:8-9` explicitly states the guard rail does **not** route through `DecisionProvider` ("deterministic, fast, offline, auditable"); `select-skills.ts` implements a measured, calibrated `boolBatch` judgment call with logged thresholds (0.8 gate, cap 3, dated measurement notes) — pluggable-provider design (jev is one adapter of several named in the docstring), the opposite of a static enable/disable list | — |
| harness adapters (pi `guard.ts`, `cli/hooks/pre-tool-use.ts`, codex registration in `cli/jig.ts`) | **designed** | `guard.ts:11-36` states "this file decides nothing," translates jig's verdict into pi's shape, never emits explicit allow; `pre-tool-use.ts:19` `CAN_ASK = {claude, dsh}` matches design-v2 F12's researched fact that only those two harnesses can prompt — ask degrades to deny elsewhere, matching §4.1's contract exactly | — |
| **compose/permissions/mcp/install** (`domain/compose/*`, `domain/permissions/*`, `domain/mcp/*`, `app/install/install-profile.ts`, the reverted `app/apply/apply-claude.ts`) | **yoki-port, load-bearing beyond the reverted commit** | see verdict below | static core→packs→personal layering, `.claude-packs` enable/disable file, `settings.layer.json`/`permissions.yaml`/`mcp.json` per-pack file trio — all mechanically reproduce yoki-switch's `manager.sh::merge_settings()` |

## The "packs" verdict

**Not confined to the reverted install work.** `grep -rniE '\bpacks?\b'` across `src/`
hits `domain/compose/compose.ts`, `layers.ts`, `hooks.ts`, `domain/mcp/merge.ts`,
`domain/mcp/types.ts`, `domain/permissions/merge.ts`, `parse.ts`, `types.ts`, and
`app/install/install-profile.ts` — a full merge pipeline, not a one-off.

- These files were first committed `41a007f` (2026-09-19), **before `design-v2.md`
  existed** (dated 2026-09-20/21) and before the "throw away the yoki port" ruling this
  task enforces. `grep -n "pack" design-v2.md decisions.md design.md requirements.md`
  returns **zero matches** — the packs/core/personal layering was never specified,
  discussed, or approved in any design document. It was scaffolded, not designed.
- `install-profile.ts:27-29` says outright: "Not yet wired to a CLI command... staged
  ahead of the `install` / `apply --target claude` command that will call it, **on
  purpose, not an oversight**." It is dormant, static-pack-shaped code waiting to be
  wired in exactly the way that just got caught and reverted.
- The only consumer of `domain/compose`/`domain/permissions`/`domain/mcp` was the
  reverted `apply-claude.ts`; `install-profile.ts` is orphaned the same way.
- **The revert (`6f6910c`) removed the CLI glue only** (`apply-claude.ts`, `cli/apply.ts`
  wiring, `cli/jig.ts` paths) — it left the underlying pack-merge domain code fully
  intact on `main`. Nothing stops the next session from rewiring it the identical way.
- Conclusion: skill/capability selection is genuinely judgment-driven and pack-free
  where it matters (`select-skills.ts`), but a second, contradictory, static-pack
  subsystem for settings/permissions/mcp composition sits live in the tree, unspecified
  by any design doc, built explicitly to mirror yoki's file/merge model. This is the
  same flaw as the caught violation, just one layer down and not yet re-triggered.

## Part B — per-commit verdict (this session, newest first)

| commit | verdict | reasoning |
|---|---|---|
| `6f6910c` revert | correct but incomplete | Removes the CLI-level packs violation; does not touch the domain-layer packs code it depended on (see above) |
| `a4b98dd` gate destructive cloud/publish shell ops | **designed** | Commit body states "Not ported: yoki denies already covered..."; each rule is a fresh read/write distinction verified against the real CLI surface (e.g. `kubectl delete pod` allowed, `kubectl delete namespace` asks; `npm install` allowed, `npm publish` asks) — a re-derivation, not a transcription |
| `964b7ad` gate destructive infra MCP calls | **designed** | Rules keyed on tool names "verified against each server's own registration"; explicit read/mutate split per MCP tool, ask-falls-back-to-deny on codex per §4.1 — no yoki equivalent exists (yoki has no MCP-aware rules) |
| `f1e5d49` jev user-agent | **designed** | Unrelated to yoki; fixes gateway attribution for jig's own judgment traffic |
| `0524814` route MCP edit tools to fs.edit | **designed** | Closes a gap specific to jig's own request-routing model (serena's `relative_path` bypassing `fs.edit`); no yoki precedent |
| `cf0d75e` fold yoki hook denies into guard policy | **designed, yoki-sourced material** | Commit removes 8 yoki `enforce:[hook]` entries and replaces them with jig's own floor/forbid/ask rules, each independently regexed and placed by risk tier per design-v2 §5.2/D-20 (e.g. `floor-write-block-device` precisely excludes `/dev/null`, unlike a blunt deny). Yoki's rule *inventory* was used as a checklist of candidate patterns — which `decisions.md` §D-3/§5.2 explicitly sanctions ("yoki's 40 patterns are one reference, not canonical") — but the structure (floor/forbid/ask, action-typed subjects) is jig's own, not yoki's tier/profile shape |

## Bottom line

**Core does not need rebuilding.** The guard evaluator, subject extraction, the
`DecisionProvider`/jev judgment layer, and all four harness adapters are genuinely
designed from first principles, cross-referenced against real harness behavior
(Claude Code, Codex, Gemini CLI, OpenHands) rather than yoki, and match the approved
`design-v2.md` line for line. None of this session's guard-rule commits (`cf0d75e`,
`a4b98dd`, `964b7ad`) are blind yoki copies — all re-derive and re-justify per rule,
using yoki's inventory only as a candidate list, which the owner's own decision record
permits.

**One subsystem is a live yoki-canonical liability and needs a decision, not just a
revert:** `domain/compose/*`, `domain/permissions/*`, `domain/mcp/*`, and
`app/install/install-profile.ts` implement yoki-switch's static core→packs→personal
merge model wholesale, were never specified in any design document, predate
`design-v2.md` entirely, and survived the `6f6910c` revert untouched — only their CLI
entry point was removed. This is the same violation the owner already caught, one
layer deeper, still armed. Ranked by concern:

1. **Highest** — `domain/compose/*` + `domain/permissions/*` + `domain/mcp/*` +
   `install-profile.ts`: static, yoki-shaped, unspecified by design docs, still present
   and wireable. Needs an explicit decision (redesign around jig's own principles, or
   delete until one exists) — not silence.
2. **Low** — nothing else in Part A or Part B. The reverted `apply-claude.ts` itself was
   a symptom of (1), not a separate defect.
