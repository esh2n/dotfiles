# PROTOCOL — skill selection: A vs B' vs C

**Status: DRAFT. Not frozen.** Nothing in this directory is a result. Freeze this file by
committing it and recording the commit hash below before the first measured run; any edit
after that voids the run and starts a new protocol version.

```
protocol_version: 0.1-draft
frozen_at_commit: <fill in at freeze>
catalog_sha256:    7c4b0adf63081f7605d48cb7e685273473238799139d710f21b899dcfd0d3c2e
prompt_set_sha256: cfddeb838690baa72826212b0c0615b1b9339808fbe1fa8046503aadaf6cab56
spot_check_verdicts_in: prompts.jsonl (field `verdict`)
```

`catalog_sha256` is the value inside `catalog-snapshot.json`, over
`dir:description_sha256` for all 54 skills in catalog order. `prompt_set_sha256` is the
SHA-256 of `prompts.jsonl` **as generated, before any verdict is filled in** — filling
verdicts changes the file, so re-hash and bump `protocol_version` at freeze.

---

## 0. The decision this feeds

Which of three arrangements the machine runs from tomorrow:

| Arm | Native skill listing | jig router | Fallback |
|---|---|---|---|
| **A** | visible (today's state: all 54 routable skills, name + description, ~4,462 tokens/session) | off | — |
| **B'** | **hidden** — `disable-model-invocation: true` on every routable skill | on, injects jev's top-3 | compact catalog (names + one-line descriptions), filtered to the repo's languages, injected whenever jev is unreachable / times out / all candidates fall below threshold |
| **C** | visible | on, injects on top of the listing | off (a fallback here would be a second copy of the visible listing) |

C is BuilderIO/agent-native's shape (`packages/core/src/agent/jev-tool-prefetch.ts`, merged
PR #5361, 2026-09-18): jev ranking **ahead of**, never instead of, the existing path, with a
hard fail-open to it.

**Owner's condition, recorded here because it binds the losing branch too:** if A returns
for real, language skills must not flood the listing. Every language/framework skill must
carry a `paths:` frontmatter glob so Claude Code only auto-loads it when a matching file is
in play. On harnesses without `paths:` support (pi caps descriptions at 1,024 chars and
Codex at 2% of context / 8,000 chars, but neither documents a `paths:`-equivalent gate), the
same effect is produced by **per-language distribution** — `~/.agents/skills` receives only
the packs the machine's enabled language packs cover, rather than the full merged farm.
This work is part of the A branch, not an optional follow-up.

---

## 1. Catalog snapshot

54 routable skills, snapshot taken 2026-09-22 from `~/.claude/.skills-merged/*/SKILL.md`
frontmatter. The full list — every skill's directory name, its `description` SHA-256, its
character count and its repo source path — is `catalog-snapshot.json` in this directory,
which also carries the one-line `catalog_sha256` that pins the whole set.

Excluded from the 54, and why:

| Skill dir | Reason |
|---|---|
| `prompt-save` | `disable-model-invocation: true` already set |
| `workday-input` | `disable-model-invocation: true` already set |
| `synced` | no `SKILL.md` |

Out of scope entirely, and stated so the arms are not over-claimed: **plugin and bundled
skills** (`claude-mem:*`, `anthropic-skills:*`, `crit:*`, `artifact-design`, `dataviz`,
`code-review`, `run`, …) are not under `~/.claude/skills`, the router never sees them, and
per Claude Code's docs `skillOverrides` cannot touch plugin skills. **No arm hides them.**
Arm B' therefore does not produce an empty listing; it produces a listing containing only
the ~34 plugin/bundled entries. Any claim about "listing cost removed" must use the 4,462
personal-skill tokens, not the whole listing.

---

## 2. Exact flags per arm

Set once per arm, verified by printing the effective config into the run log before the
first prompt.

### Arm A — native only
```
JIG_SKILL_ROUTER=0
JIG_ROUTER_FALLBACK=0
frontmatter:  no disable-model-invocation on any of the 54
settings.json: no skillOverrides key   (absent == "on" == name + description)
```

### Arm B' — listing hidden, router + fallback
```
JIG_SKILL_ROUTER=1
JIG_SKILL_ROUTER_THRESHOLD=<0.6 | 0.7 | 0.8>      # swept, §4
JIG_ROUTER_FALLBACK=1
frontmatter:  disable-model-invocation: true on all 54 routable skills
              (applied by script to the repo sources under claude-profiles/, then
               `yoki-switch`/`jig apply` re-links; never hand-edited in ~/.claude)
```
The fallback catalog is `domain/skills/fallback-catalog.ts` filtered by
`infra/skills/repo-signals.ts` (git ls-files at the checkout toplevel, bounded to 20,000
files / 400 ms / depth 6; an unresolvable repo yields `known: false` and the fallback then
carries only the skills that declare no `paths:`).

**Fail-open in B' is not the same fail-open as today.** With the listing visible, a router
failure costs nothing. With it hidden, a router failure means the model sees nothing but the
fallback. The fallback rate is therefore a headline metric here, not a footnote (§4).

### Arm C — listing visible, router on top
```
JIG_SKILL_ROUTER=1
JIG_SKILL_ROUTER_THRESHOLD=<same value as the B' cell being compared>
JIG_ROUTER_FALLBACK=0
frontmatter:  no disable-model-invocation
```

---

## 3. jev question wording — both languages are tested

`kamo-shika/jev-bench` measured an **8–16 point** accuracy swing from prompt wording alone
on the same model; `unirt/jev-eval-ja` found that switching the *question* language while
holding the *document* language fixed changed scores for an open model (compliance 40%→80%)
though not for the real jev API (90% either way). Wording is a variable, so it is fixed in
advance and both languages are run.

### 3a. Batch bool — the shape jig runs today

One yes/no question per candidate, all 54 judged independently against one material.
Current production string, `src/app/routing/select-skills.ts::skillQuestion`:

- **JA (current)**
  - material: `依頼: {request}`
  - per candidate: `この依頼は「{name}」スキルの手順を必要とするか。（{name}: {description}）`
- **EN (to be tested against it)**
  - material: `Request: {request}`
  - per candidate: `Does this request need the "{name}" skill's procedure? ({name}: {description})`

### 3b. Choice — the shape TypeSafe documents for selection

`docs.typesafe.ai/primitives/choice.md`: up to 255 options, "give the model the full list …
rather than a shortlist", and an explicit `none of the above` option "when the list might not
cover every input". 54 options is well inside the ceiling, so the full catalog is sent.

- **JA**
  - material: `依頼: {request}`
  - question: `この依頼を進めるのに手順を読むべきスキルはどれか。どれも当てはまらない場合は「none」を選ぶこと。`
  - options: the 54 `{label: name, what: description}` pairs, plus
    `{label: "none", what: "どのスキルの手順も必要としない依頼"}`
- **EN**
  - material: `Request: {request}`
  - question: `Which skill's instructions should be read before doing this request? Choose "none" if none of them applies.`
  - options: the same 54, plus `{label: "none", what: "a request that needs none of these skills' procedures"}`

Option order is **fixed to the catalog order in `catalog-snapshot.json`** for the primary
run, and re-run once with the order reversed as an order-swap robustness check (jev-bench's
practice). A >2-point accuracy gap between the two orders is reported as an order effect and
blocks any promotion claim until it is explained.

Four wording cells run in total: {bool, choice} × {JA, EN}.

---

## 4. Thresholds

Swept at **0.6 / 0.7 / 0.8** on the same answers (a single judgment run per prompt is
re-scored at each threshold — the threshold is a post-hoc cut, not a new call), reporting per
threshold:

- top-1 and top-3 accuracy
- **fallback rate** (B' only): the share of prompts where nothing cleared the gate and the
  compact catalog was injected instead
- the share of `label = none` prompts where the selector correctly injected nothing

Today's gate is 0.8; the 30-day router log shows the median best-candidate confidence at
**0.71**, i.e. the median prompt's best candidate sits *below* the current gate, and 44% of
prompts had a `yes` that missed it. Lowering the gate is therefore the single largest lever
on fallback rate and the reason 0.6 is in the sweep.

---

## 5. Pre-declared metrics

Declared before any run; nothing outside this list is reported as a result.

| Metric | Definition | Reported as |
|---|---|---|
| **top-1 accuracy** | selector's first pick == `label` | % + Wilson 95% CI |
| **top-3 accuracy** | `label` ∈ selector's top 3 (for `label = none`: nothing was injected) | % + Wilson 95% CI |
| **Brier** | mean squared error of the confidence on the top-1 pick against the 0/1 correctness | scalar |
| **ECE** | expected calibration error, 10 equal-width confidence bins | scalar + reliability table |
| **follow rate** | the model invoked the selected skill **in that turn, via `Skill` OR `Read`** | % + Wilson 95% CI |
| **task-outcome proxy** | no skill-correction turn within the next 3 turns (see below) | % |
| **latency** | end-to-end, hook entry → injection written | P50, P95 (ms) |
| **cost per decision** | judgment tokens × price, per routed prompt | JPY/1,000 prompts |
| **fallback rate** (B' only) | prompts where the compact catalog was injected instead of picks | % |

**follow rate counts the `Skill` tool.** Today's report counts only `Read`
(`readPathsOf`: `if (call.name !== "Read") continue`), which scored 3 obeyed turns as misses
and left 1,208 `Skill` invocations at zero. Changing this is a change to the instrument and
must land before the freeze, not between arms.

**skill-correction turn**, defined here so it is not defined after the fact: a user turn
within the next 3 turns that (a) names a skill the selector did not pick, (b) contains an
explicit re-do marker (`やり直し`, `違う`, `そうじゃない`, `もう一度`), or (c) invokes a slash
command for a skill. Counted by hand on the spot-check slice first to check the rule is
callable, then applied mechanically.

**Not measurable from what exists today, and named so it does not get quietly assumed:**
the router log records `at, harness, promptHash, promptChars, candidates, skills, passed,
confidence, source, skill, front, error` and **no duration field and no token/cost field**.
Latency and cost per decision require adding those two fields before the freeze. Until they
exist, latency P95 < 1s is unfalsifiable and the promotion rule below cannot be evaluated.

---

## 6. Repetition and reporting

- **5 runs per case per cell** (`unirt/jev-eval-ja`'s stability check, which found 0/40
  answer flips and a max probability spread of 0.08).
- **Flip rate is reported before any accuracy number**: the share of cases whose top-1 pick
  is not identical across all 5 runs. A flip rate above 5% means the point accuracies are
  not stable enough to compare arms, and the run is reported as inconclusive rather than
  averaged into a verdict.
- Every percentage carries a **Wilson 95% CI**. With n=200 overall and n=12–35 in the small
  strata, most per-stratum intervals will be wide; they are printed anyway, because a wide
  interval is the finding.
- Per-stratum breakdown is always shown alongside the pooled number. The pooled number is
  dominated by the 126 `none` prompts and will look good for any selector that abstains
  often; it must never be quoted alone.

---

## 7. Promotion rule — decided in advance

> **B' wins if and only if all three hold:**
> 1. top-3 accuracy beats A by **≥ 10 percentage points**, and
> 2. follow rate **≥** A's, and
> 3. latency **P95 < 1s**.
>
> **Otherwise: return to A**, with `paths:` gating on every language skill (and per-language
> distribution on the harnesses that have no `paths:`), and keep the router **only in shape C**
> or drop it entirely.

Conditions 1–3 are conjunctive. A B' that wins on accuracy and loses on latency does not win.
Point estimates are not enough for condition 1: the **lower bound of the Wilson CI on the
difference** must clear +10 points; a point estimate of +12 with a CI spanning zero is
reported as "not shown", following `RT123-new/ToolSpeeder`'s "confirmatory partially
supported — keep optional / targeted only" template.

C is not on the promotion ladder by itself — it is the fallback shape the losing branch keeps
if the router shows any value at all. If C's top-3 accuracy does not beat A's and its follow
rate does not beat A's, the router is dropped rather than kept in shape C.

---

## 8. What the data cannot tell

1. **The label is not ground truth.** 27 of 200 labels are natural (the model opened the
   skill unprompted, no injection); the other 173 were assigned by a model reading the
   catalog descriptions, and the owner has verified 30 of them by hand at most. On 8 of the
   27 natural labels the labeller recorded an explicit disagreement. Accuracy against this
   set measures agreement with a mostly-model-made key, and no amount of CI fixes that.
2. **A natural label is an open, not a judgment of correctness.** The model opening
   `writeup` on 「続きの作業は何ですか。」 is evidence it opened it, not evidence it should have.
   Several natural labels sit on continuation turns where the skill was read as a
   sub-reference (`writeup-kit`, which self-describes as "not invoked directly by users").
3. **Historical prompts cannot measure a counterfactual arm.** A prompt recorded under A
   was answered in a session whose context, tool state and prior turns were shaped by A. The
   accuracy comparison is offline and fair; the **follow rate and the task-outcome proxy are
   not** — they require the arm to actually run live. Offline follow rate for B' and C is
   undefined and must not be reported.
4. **Shell reads are invisible.** `cat`/`sed`/`grep` of a `SKILL.md` is not a tool call. 30
   of 203 ignored turns used Bash. This understates follow rate by an unknown, non-zero
   amount, equally in every arm.
5. **A read is not compliance.** "Followed" only ever meant "opened the file".
6. **pi's sample is too small to separate mechanisms.** 33 of the 200 prompts are pi; pi
   contributed 6 followed / 1 ignored / 4 unscouted over 30 days. Nothing arm-level can be
   concluded for pi from this set.
7. **Plugin and bundled skills are outside every arm** (§1). B' does not test "no listing".
8. **Latency and judgment cost are not currently recorded** (§5). Without the two new log
   fields, promotion condition 3 cannot be evaluated at all.
9. **The prompt set is one person's 90 days on a handful of repos.** The language mix is
   dominated by TypeScript/Markdown/shell; the CSS, React, Go, Python and Rust skills are
   barely exercised, so the arms are effectively untested on the language skills that the
   owner's `paths:`-gating condition is about.

---

## 9. Undetermined outcome clause

If any of the following holds, the run is reported as **UNDETERMINED** and neither arm is
promoted. Writing this down now is the point — an undetermined result is a result, and the
alternative is choosing the preferred arm after seeing the numbers.

- flip rate > 5% in any cell (§6);
- the Wilson CI on the top-3 accuracy difference between B' and A spans 0;
- the order-swap check (§3b) shows a > 2-point gap that is not explained;
- latency or cost could not be measured because the log fields were not added (§5);
- the owner's spot-check overturns **> 20% (7 of 30)** of the provisional labels — in which
  case the whole 173-prompt provisional set is re-labelled before anything is run;
- the fallback rate in B' exceeds 50% at every threshold, which would mean B' is mostly
  testing the fallback catalog rather than jev.

An UNDETERMINED run returns to arm A with `paths:` gating, exactly as the promotion rule's
"otherwise" branch does. The difference is only in what may be claimed afterwards.

---

## 10. Prior art this protocol borrows from, and what it does not have

- Frozen, hash-pinned protocol before any run — `RT123-new/ToolSpeeder` (0★, unmerged draft;
  the practice is borrowed, the numbers are not citable).
- Wilson CIs, order-swap robustness, wording ablation, calibration curves —
  `kamo-shika/jev-bench` (does **not** hit the real jev API).
- 易/中/難 levels with a `why`, ≥5 reruns, and the author stating their own N is too small —
  `unirt/jev-eval-ja` (real API, Japanese, N=10/task).
- Additive-with-hard-fallback arm — `BuilderIO/agent-native` PR #5361 (real production, no
  published selection accuracy).
- Explicit `none of the above` option — TypeSafe's own `primitives/choice.md`.

**Nobody has run the comparison this protocol describes.** No vendor or independent source
publishes: a frozen A/B with a harness's native listing actually hidden; any test near the
255-option Choice ceiling on a real skill catalog (the largest found anywhere is K=16); a
statistically powered Japanese real-API measurement for skill selection; or a task-outcome
proxy for any jev-based selector. The design here is not a formality — it is an unoccupied
niche, which also means there is no external result to sanity-check ours against.
