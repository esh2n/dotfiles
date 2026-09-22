# RESULTS — offline arm (jev selection accuracy on the 200 frozen prompts)

```
protocol:           PROTOCOL.md, frozen at 18119e2
prompt_set_sha256:  fdc19c32d919933aaa50c6d8fbab2cfddb3a90f58aa513829857abd4e538abcc  (matches FROZEN.md)
catalog_sha256:     7c4b0adf63081f7605d48cb7e685273473238799139d710f21b899dcfd0d3c2e  (reproduced from the file)
catalog drift:      none — all 54 descriptions in ~/.claude/.skills-merged hash to the snapshot's values
run date:           2026-09-23
judgment model:     jev-1.13.0 (reported by the service's own metrics)
service:            http://127.0.0.1:4100, provider "jev", already running; never restarted, never configured
```

**This is the offline half only.** No arm (A / B' / C) was run. Nothing here is a live measurement
of the router, of follow rate, or of task outcome. What was measured is: given the same question jig
asks, what does jev answer about these 200 prompts, and how stable and how calibrated is that answer.

---

## 1. Method

### 1.1 How the judgments were obtained

`tools/offline-eval.mjs` posts to the running judgment service's `/decide` endpoint — the same wire
contract (`jig/src/domain/decision/remote.ts`) that every harness's hook uses through
`RemoteDecisionProvider`. The service holds the TypeSafe key; this tool holds only the loopback
bearer token from `~/Library/Application Support/jig/decision.token`, exactly as
`infra/decision/http-decision-client.ts` reads it.

The material is `prompt_excerpt` from `prompts.jsonl` (redacted, ≤400 chars), passed through
`boundedMaterial()` transcribed verbatim from `app/decision/material.ts`. The 54 skill descriptions
are read from `~/.claude/.skills-merged/*/SKILL.md` with `infra/skills/catalog.ts`'s own frontmatter
parser transcribed into the tool, so the text sent is byte-for-byte what production sends.

### 1.2 The four question variants (PROTOCOL.md §3, worded as frozen)

| Variant | op | Material | Question |
|---|---|---|---|
| `bool-ja` | `boolBatch` | `依頼: {request}` | `この依頼は「{name}」スキルの手順を必要とするか。（{name}: {description}）` × 54 |
| `bool-en` | `boolBatch` | `Request: {request}` | `Does this request need the "{name}" skill's procedure? ({name}: {description})` × 54 |
| `choice-ja` | `choice` | (see below) | `この依頼を進めるのに手順を読むべきスキルはどれか。どれも当てはまらない場合は「none」を選ぶこと。` + 54 options + `none` |
| `choice-en` | `choice` | (see below) | `Which skill's instructions should be read before doing this request? Choose "none" if none of them applies.` + 54 options + `none` |

`bool-ja` is production (`app/routing/select-skills.ts::skillQuestion`), unchanged. The other three
do not exist in jig and were built here against the same port.

### 1.3 What had to be added, and what it cost in fidelity

Three things, all of them consequences of the wire contract rather than of the protocol:

1. **`choice` has no material field.** The port's `ChoiceQuery` carries only `prompt`, `options` and
   `criteria`, and `JevProvider.choice()` sends `query.prompt` as the System One *state*
   (`infra/decision/jev-provider.ts`). There is nowhere to put the protocol's `依頼: {request}`
   material separately, so the tool concatenates material and question into one `prompt`:
   `依頼: {request}\n\n{question}`. A production `choice` selector would need a port change to
   separate them; this run cannot say whether the concatenation costs accuracy.

2. **`choice` answers arrive without their distribution.** `RemoteDecisionResponse` for `choice` is
   `{op, value, confidence}` — `JevProvider` receives `probabilities` from the model and
   `Decided.probabilities` carries it in-process, but `dispatchDecision()` drops it before the
   reply is serialised. **Top-3 for the two choice variants is therefore not obtainable through the
   running service and is reported UNDETERMINED throughout.** Since top-3 accuracy is the
   promotion rule's condition 1, the choice wording cannot be evaluated against the promotion rule
   at all without a change to `remote.ts`. This is the single most consequential gap this run found.

3. **Per-skill probability for `bool` is reconstructed, not read.** `boolBatch` returns
   `{value, confidence}`, where the adapter has already mapped jev's noul with
   `value = noul >= 0.5`, `confidence = max(noul, 1-noul)` (`noulToBool`). The tool inverts that
   mapping — `p = value ? confidence : 1 - confidence` — to recover the model's probability that
   the skill applies. This is exact, not an estimate, but it is an inversion of an in-repo
   convention rather than a vendor-documented field.

No jig source file was modified. `tools/offline-eval.mjs` is the only new code.

### 1.4 Metric definitions used

- **picks at threshold τ** (`bool`): candidates with `value === true` and `p ≥ τ`, sorted by `p`
  descending, capped at 3 — `select-skills.ts`'s own rule, including the cap.
- **picks at τ** (`choice`): the chosen option, unless `confidence < τ` (then `gate()` falls back and
  nothing is injected) or the choice is `none`.
- **top-1 correct**: picks non-empty and `picks[0] == label`; or picks empty and `label == none`.
- **top-3 correct**: `label ∈ picks`; or picks empty and `label == none`.
- **label**: the owner's `verdict` where one is filled in (30 of 200), else the provisional `label`.
  4 of the 30 verdicts overrule the label, matching FROZEN.md exactly.
- **Brier / ECE confidence** (threshold-free, so the calibration curve is not an artefact of a cut):
  for `bool`, the top-1 pick's `p` when any candidate says yes, else `1 - max p` on the answer
  `none`, which is the adapter's own confidence convention; for `choice`, the returned `confidence`.
- **latency**: the `/decide` round trip, client-side. This is a *lower bound* on the protocol's
  "hook entry → injection written"; see §6.
- CIs are Wilson 95% throughout.

### 1.5 Judgment budget spent

| Phase | `/decide` calls | jev API requests |
|---|---:|---:|
| wire smoke test (2 prompts × 2 variants) | 4 | 6 |
| main pass 1, 4 variants × 200 | 800 | 1,200 |
| serial-latency sample (bool-ja, 40, concurrency 1) | 40 | 80 |
| bool-ja re-run (the recorded pass — see note) | 200 | 400 |
| stability, bool-ja × 5 runs × 40 | 200 | 400 |
| order-swap, choice-ja + choice-en × 40 | 80 | 80 |
| **total** | **1,324** | **2,166** |

A `boolBatch` of 54 questions is 2 jev requests (the adapter chunks at 32); a `choice` is 1.
Zero errors, zero retries across the whole run. The service's own request counter moved by exactly
the number of calls made in each window, so no other process's traffic is mixed into the token
deltas.

**Note on the bool-ja re-run.** The serial-latency sample overwrote `results/raw-bool-ja.jsonl`, so
bool-ja was run over the 200 a second time and that second pass is the recorded one. The first pass
is not kept, but its numbers were computed before it was lost and are quoted here as a free
run-to-run check at full-set scale: top-3 @0.7 was 77.0% in both passes; top-1 @0.8 moved 75.5% →
76.0% and top-3 @0.8 moved 76.0% → 77.0%. Run-to-run movement on n=200 is ≤1 point.

---

## 2. Headline — pooled, per threshold

The pooled number is dominated by the 127 `none`-labelled prompts (63.5% of the set) and **must not
be quoted alone** (PROTOCOL.md §6). The "skill rows" column is the same measurement restricted to
the 73 prompts whose label is an actual skill.

### bool-ja (production wording)

| τ | top-1 | top-3 | top-1, skill rows (n=73) | top-3, skill rows | fallback rate | `none` abstained (n=127) |
|---|---|---|---|---|---|---|
| 0.6 | 66.5% [59.7–72.7] | 70.0% [63.3–75.9] | 60.3% [48.8–70.7] | 69.9% [58.6–79.2] | 52.0% | 70.1% |
| 0.7 | 74.5% [68.0–80.0] | **77.0% [70.7–82.3]** | 56.2% [44.8–67.0] | 63.0% [51.5–73.2] | 64.5% | 85.0% |
| 0.8 | 76.0% [69.6–81.4] | **77.0% [70.7–82.3]** | 43.8% [33.0–55.2] | 46.6% [35.6–57.9] | 78.0% | 94.5% |

### bool-en

| τ | top-1 | top-3 | top-1, skill rows | top-3, skill rows | fallback | `none` abstained |
|---|---|---|---|---|---|---|
| 0.6 | 70.5% [63.8–76.4] | 72.5% [65.9–78.2] | 65.8% [54.3–75.6] | 71.2% [60.0–80.3] | 54.0% | 73.2% |
| 0.7 | 74.5% [68.0–80.0] | 75.5% [69.1–80.9] | 60.3% [48.8–70.7] | 63.0% [51.5–73.2] | 63.0% | 82.7% |
| 0.8 | 75.5% [69.1–80.9] | 75.5% [69.1–80.9] | 42.5% [31.8–53.9] | 42.5% [31.8–53.9] | 78.0% | 94.5% |

### choice-ja

| τ | top-1 | top-3 | top-1, skill rows | fallback | `none` abstained |
|---|---|---|---|---|---|
| 0.6 | 76.5% [70.2–81.8] | UNDETERMINED | 45.2% [34.3–56.6] | 78.0% | 94.5% |
| 0.7 | 76.0% [69.6–81.4] | UNDETERMINED | 41.1% [30.5–52.6] | 81.0% | 96.1% |
| 0.8 | 72.0% [65.4–77.8] | UNDETERMINED | 26.0% [17.3–37.1] | 88.5% | 98.4% |

### choice-en

| τ | top-1 | top-3 | top-1, skill rows | fallback | `none` abstained |
|---|---|---|---|---|---|
| 0.6 | **79.0% [72.8–84.1]** | UNDETERMINED | 52.1% [40.8–63.1] | 75.5% | 94.5% |
| 0.7 | 77.5% [71.2–82.7] | UNDETERMINED | 45.2% [34.3–56.6] | 79.0% | 96.1% |
| 0.8 | 76.0% [69.6–81.4] | UNDETERMINED | 38.4% [28.1–49.8] | 83.5% | 97.6% |

**Every CI overlaps every other CI on the pooled top-1 column.** No wording is shown to beat another
at n=200. The wording effect `kamo-shika/jev-bench` reported (8–16 points) is not reproduced here:
JA↔EN moves the pooled top-1 by 1–4 points with fully overlapping intervals.

**Raising the threshold buys pooled accuracy by abstaining.** Between τ=0.6 and τ=0.8, bool-ja's
pooled top-1 rises 66.5% → 76.0% while its accuracy on the rows that actually need a skill falls
60.3% → 43.8%. The pooled number improves because abstention is correct 63.5% of the time on this
set. This is the single most important thing to read off these tables.

### `passed` (candidates clearing the gate before the cap)

bool-ja mean 0.83 / 0.50 / 0.26 at τ=0.6/0.7/0.8; bool-en 0.74 / 0.49 / 0.24. The cap of 3 is
essentially never the binding constraint — `select-skills.ts`'s "over-eager batch" failure mode does
not appear at this scale, confirming its own 2026-09-20 note on a wider set.

---

## 3. Splits

### 3.1 By difficulty (τ = 0.7, top-1)

| Variant | 易 (n=71) | 中 (n=77) | 難 (n=52) |
|---|---|---|---|
| bool-ja | 91.5% [82.8–96.1] | 74.0% [63.3–82.5] | 51.9% [38.7–64.9] |
| bool-en | 91.5% [82.8–96.1] | 71.4% [60.5–80.3] | 55.8% [42.3–68.4] |
| choice-ja | 93.0% [84.6–97.0] | 68.8% [57.8–78.1] | 63.5% [49.9–75.2] |
| choice-en | 93.0% [84.6–97.0] | 74.0% [63.3–82.5] | 61.5% [48.0–73.5] |

The rubric holds: 易 is ~92% for every wording, 難 is 52–64%. The 難 band is mostly "the right answer
is `none` despite a keyword pull", so the choice variants' edge there is abstention, not discrimination.

### 3.2 By `label_source` (τ = 0.7, top-1)

| Variant | model (n=173) | native-open (n=27) |
|---|---|---|
| bool-ja | 79.8% [73.2–85.1] | 40.7% [24.5–59.3] |
| bool-en | 79.2% [72.5–84.6] | 44.4% [27.6–62.7] |
| choice-ja | 80.9% [74.4–86.1] | 44.4% [27.6–62.7] |
| choice-en | 82.7% [76.3–87.6] | 44.4% [27.6–62.7] |

**A 35–40 point gap between the labels a model wrote and the labels a model's own behaviour wrote.**
jev agrees with a model reading the catalog far more than with what Claude actually opened. Two
readings are available and this data does not separate them: jev and the labeller share a bias that
the acting model does not, or the native-open rows are genuinely harder (they are all "the model
opened something unprompted", which skews to continuation turns). §8 of the protocol warned about
exactly this; the number puts a size on it.

### 3.3 By harness (τ = 0.7, top-1)

| Variant | claude (n=167) | pi (n=33) |
|---|---|---|
| bool-ja | 79.0% [72.3–84.5] | 51.5% [35.2–67.5] |
| bool-en | 78.4% [71.6–84.0] | 54.5% [38.0–70.2] |
| choice-ja | 80.8% [74.2–86.1] | 51.5% [35.2–67.5] |
| choice-en | 80.2% [73.6–85.6] | 63.6% [46.6–77.8] |

pi is consistently ~20 points lower with intervals 30 points wide. n=33 cannot support any
arm-level claim for pi (README §9.2), and this does not change that — it only says the gap is
visible in every wording, which is weak evidence it is the prompts and not noise.

### 3.4 Agreement with the 27 native-open labels

Compared against the raw `label` (the skill the model opened by itself), **not** the owner's
verdict, because this metric is "the model's own choice".

| Variant | τ=0.6 top-1 | τ=0.7 top-1 | τ=0.8 top-1 | τ=0.7 top-3 |
|---|---|---|---|---|
| bool-ja | 33.3% [18.6–52.2] | 33.3% [18.6–52.2] | 18.5% [8.2–36.7] | 37.0% [21.5–55.8] |
| bool-en | 40.7% [24.5–59.3] | 37.0% [21.5–55.8] | 25.9% [13.2–44.7] | 37.0% [21.5–55.8] |
| choice-ja | 33.3% [18.6–52.2] | 33.3% [18.6–52.2] | 29.6% [15.9–48.5] | UNDETERMINED |
| choice-en | 37.0% [21.5–55.8] | 33.3% [18.6–52.2] | 33.3% [18.6–52.2] | UNDETERMINED |

At the production gate of 0.8, jev's production wording reproduces the model's own unprompted choice
on **5 of 27** turns. The intervals are enormous (n=27) and 8 of the 27 carry a labeller
disagreement, so this is a flag, not a verdict. But it is the closest thing in this data to "would
the router have told the model what the model was going to do anyway", and the answer is mostly no.

---

## 4. Calibration

Brier and ECE over the threshold-free top-1 answer (§1.4). Lower is better for both.

| Variant | Brier | ECE (10 bins, protocol §5) | ECE (5 bins) |
|---|---|---|---|
| bool-ja | 0.2281 | 0.1217 | 0.1192 |
| bool-en | 0.2172 | 0.1180 | 0.1085 |
| choice-ja | 0.1756 | **0.0561** | 0.0561 |
| choice-en | **0.1667** | 0.0927 | 0.0611 |

**The choice wording is materially better calibrated than the bool wording**, and this is the one
place where the four cells separate cleanly. The mechanism is visible in the bins: `bool` confidences
never fall below 0.5 by construction (`max(noul, 1-noul)`), so the whole lower half of the
probability axis is empty and the selector cannot express "I am unsure". `choice` uses the full
range.

### 5-bin tables (bin, n, mean confidence, accuracy)

| bin | bool-ja | bool-en | choice-ja | choice-en |
|---|---|---|---|---|
| 0.0–0.2 | 0 | 0 | 0 | 0 |
| 0.2–0.4 | 0 | 0 | 34 / .332 / .324 | 27 / .334 / .296 |
| 0.4–0.6 | 42 / .555 / .357 | 42 / .553 / .381 | 48 / .482 / .604 | 44 / .501 / .682 |
| 0.6–0.8 | 96 / .706 / .594 | 87 / .719 / .609 | 52 / .721 / .789 | 37 / .707 / .757 |
| 0.8–1.0 | 62 / .868 / .790 | 71 / .859 / .789 | 66 / .902 / .879 | 92 / .907 / .891 |

### 10-bin reliability (non-empty bins only; bin lower edge, n, mean confidence, accuracy)

- **bool-ja**: (0.5, 42, .555, .357) (0.6, 46, .653, .565) (0.7, 50, .754, .620) (0.8, 43, .838, .721) (0.9, 19, .935, .947)
- **bool-en**: (0.5, 42, .553, .381) (0.6, 31, .660, .452) (0.7, 56, .751, .696) (0.8, 56, .838, .732) (0.9, 15, .937, 1.000)
- **choice-ja**: (0.2, 8, .264, .250) (0.3, 26, .353, .346) (0.4, 28, .439, .643) (0.5, 20, .543, .550) (0.6, 17, .662, .706) (0.7, 35, .749, .829) (0.8, 30, .846, .800) (0.9, 36, .949, .944)
- **choice-en**: (0.2, 7, .283, .286) (0.3, 20, .352, .300) (0.4, 21, .446, .762) (0.5, 23, .551, .609) (0.6, 17, .660, .765) (0.7, 20, .747, .750) (0.8, 38, .838, .921) (0.9, 54, .955, .870)

`bool` is **over-confident everywhere below 0.9** — at a stated 0.75 it is right 62%, at a stated
0.84 it is right 72%. `choice` is mildly *under*-confident in its mid range (.44 → 64% correct) and
close to honest at the top. Confidences come off the wire quantised to two decimals, which is finer
than any bin here and not a source of the error.

---

## 5. Stability (PROTOCOL.md §6, `unirt/jev-eval-ja`'s check)

Best variant by the promotion rule's own metric (top-3 accuracy) is **bool-ja** at 77.0% @ τ=0.7 —
though bool-en at 75.5% is inside its interval, and top-3 does not exist for the choice variants at
all, so "best" here means "best among the two cells where the promotion metric is computable".

5 reruns, seeded 40-prompt subset. Seed `skill-selection-experiment-2026-09-22`, rank =
`sha256(SEED|id)`, ids listed in `results/subset-40.json` (first five: `51dafa9308a8`,
`71bde4dc5079`, `0052f6beee0f`, `3fdf1c8a7c22`, `5255f29e3f84`).

| Measure | Value |
|---|---|
| top-1 answer flip rate (threshold-free) | **2.5%** (1 of 40) |
| max probability spread on the top-1 answer | **0.06** |
| median probability spread | 0.02 |
| injected-set flip rate @ τ=0.6 | **17.5%** (7 of 40) |
| injected-set flip rate @ τ=0.7 | 2.5% (1 of 40) |
| injected-set flip rate @ τ=0.8 | 5.0% (2 of 40) |

The model itself is stable — 2.5% top-1 flips and a 0.06 max spread are in line with
`unirt/jev-eval-ja`'s 0/40 and 0.08. **The instability is in the gate, not the model.** At τ=0.6 the
selector's *injected set* changes across identical reruns on 17.5% of cases, because a 0.02–0.06
wobble straddles the cut for candidates parked near it. Per §6 this makes **the τ=0.6 cell
inconclusive**; τ=0.7 (2.5%) and τ=0.8 (5.0%, not *above* 5%) stay inside the bar.

---

## 6. Latency and cost

### Latency (`/decide` round trip, ms)

| Variant | P50 | P95 | max |
|---|---|---|---|
| bool-ja | 264 | 416 | 758 |
| bool-en | 265 | 343 | 649 |
| choice-ja | 258 | 334 | 622 |
| choice-en | 256 | 321 | 399 |

Measured at concurrency 4. A serial control (bool-ja, 40 prompts, concurrency 1) gives P50 251 /
P95 303 / max 329 ms, so the concurrency did not inflate the figures; if anything the concurrent run
is the pessimistic one.

**This is not the protocol's latency metric.** §5 defines latency as "hook entry → injection
written", which additionally includes hook process start, catalog read and the injection write. What
is measured here is only the judgment leg. The two log fields §5 required (`latency_ms`, `usage`)
do exist now in `domain/skills/router-log.ts` for `/skill` lines, so §9's "could not be measured
because the fields were not added" clause does **not** fire — but the end-to-end number itself is an
online measurement and is not in this run.

### Cost

Usage is not on the `/decide` wire (`dispatchDecision` returns a `Decided` with no usage), so it was
taken from the service's own Prometheus counters, differenced across each run's window. The request
counter moved by exactly the number of calls made, so the attribution is clean.

| Variant | input tokens / decision | output tokens / decision |
|---|---:|---:|
| bool-ja | 8,085 | 960 |
| bool-en | 7,545 | 960 |
| choice-ja | 6,665 | 559 |
| choice-en | 6,606 | 559 |

**Cost per decision in currency: not recorded.** No price table exists anywhere in this repo. The
only figure available is a vendor claim quoted in
`rules/research/2026-09-22-jev-for-selection-practice.md` — "$42 / B input tokens" — with no output
price and no methodology. Applied to bool-ja's 8,085 input tokens that would be roughly $0.34 per
1,000 decisions on the input side alone, which is a floor derived from an unverified vendor number,
not a measurement. The protocol's "JPY / 1,000 prompts" cell stays **UNDETERMINED**.

The choice wording is ~18% cheaper on input and ~42% cheaper on output than the production bool
wording, because it sends the catalog once as options rather than once per question across two
32-question chunks.

---

## 7. Order-swap robustness (PROTOCOL.md §3b)

Run on the same seeded 40-prompt subset rather than the full 200 — outside the stated budget for
this pass, and labelled as a subset check, not the protocol's check.

| Variant | τ | forward top-1 | reversed top-1 | gap (points) | answers that differ |
|---|---|---|---|---|---|
| choice-ja | 0.6 | 77.5% | 75.0% | 2.5 | 1 / 40 |
| choice-ja | 0.7 | 77.5% | 75.0% | 2.5 | 3 / 40 |
| choice-ja | 0.8 | 75.0% | 72.5% | 2.5 | 2 / 40 |
| choice-en | 0.6 | 80.0% | 77.5% | 2.5 | 3 / 40 |
| choice-en | 0.7 | 80.0% | 72.5% | 7.5 | 5 / 40 |
| choice-en | 0.8 | 82.5% | 72.5% | 10.0 | 5 / 40 |

**An order effect is present and is not explained.** §3b's trigger is a gap > 2 points, and every
cell here exceeds it. Two honest qualifications: on n=40 one case *is* 2.5 points, so this subset
cannot resolve a 2-point criterion at all — the measurement's own resolution is coarser than the
threshold it is being tested against; and 5 of 40 answers changing when the option list is reversed
is a real signal independent of the accuracy gap. Either way, **§9's order-swap clause fires for the
choice variants** and would have to be settled on the full 200 before any promotion claim using the
choice wording.

---

## 8. Promotion-rule check — offline-measurable parts only

The rule (PROTOCOL.md §7): B' wins **iff** (1) top-3 accuracy beats A by ≥10 points with the Wilson
CI on the difference clearing +10, **and** (2) follow rate ≥ A's, **and** (3) latency P95 < 1s.

| Condition | Status | Why |
|---|---|---|
| 1. top-3 ≥ A + 10 pts (CI-cleared) | **UNDETERMINED** | B''s side is measured (best 77.0% [70.7–82.3], bool-ja @ τ=0.7/0.8). **A's side does not exist offline and cannot be constructed from this set without circularity**: on the 126 `none`-stratum rows arm A abstained and the label is `none`, so A scores 100% by construction; on the 27 `unscouted` rows the label *is* what A opened, so A scores 100% by construction; the remaining 47 rows (`followed`/`ignored`) were turns where the router had already injected, so they are not arm A at all. Any "A baseline" from this data is its own key. The difference and its CI are therefore not computable, and condition 1 is undetermined rather than failed. |
| 2. follow rate ≥ A's | **NOT MEASURABLE OFFLINE** | PROTOCOL.md §8.3: the historical turns were answered under A, so a counterfactual follow rate for B' or C is undefined. Requires the arm to run live. |
| 3. latency P95 < 1s | **judgment leg PASSES; end-to-end NOT MEASURABLE OFFLINE** | The `/decide` round trip is P95 321–416 ms across all four variants, worst case 758 ms for a single call. That leaves ~580 ms of the 1 s budget for hook start, catalog read and injection write, which this run does not measure. The condition as written ("hook entry → injection written") is an online measurement. |

Conditions are conjunctive, so with 1 undetermined and 2 unmeasurable, **the promotion rule yields
no promotion from this run.**

### §9 undetermined-outcome clauses, checked against what was measured

| Clause | Fires? |
|---|---|
| flip rate > 5% in any cell | **YES** — injected-set flip rate 17.5% at τ=0.6 (bool-ja). τ=0.7 and τ=0.8 are inside the bar. |
| Wilson CI on the B'−A top-3 difference spans 0 | **UNDETERMINED** — the difference is not computable offline (see condition 1). |
| order-swap gap > 2 points, unexplained | **YES** for both choice variants, on the 40-prompt subset (2.5–10 points). Not checked for the bool variants; §3b declares the check for `choice` only. |
| latency or cost unmeasurable because the log fields were never added | **NO** — `latency_ms` and `usage` exist in `domain/skills/router-log.ts`. |
| owner's spot-check overturns > 7 of 30 | **NO** — 4 of 30 (13.3%), matching FROZEN.md. |
| B' fallback rate > 50% at every threshold | **YES on this data, with a caveat** — bool-ja 52.0 / 64.5 / 78.0%, bool-en 54.0 / 63.0 / 78.0%, choice-ja 78.0 / 81.0 / 88.5%, choice-en 75.5 / 79.0 / 83.5%. The caveat: this prompt set is 63.5% `none`-labelled, so most of that abstention is the selector being *correct*, whereas §9's clause was written about a live B' run where the traffic mix is whatever the day brings. The clause as literally written fires; the inference it was meant to license ("B' is mostly testing the fallback catalog") is only supported to the extent the live mix resembles this set. |

**Verdict from the pre-declared rule: UNDETERMINED.** §9's "otherwise" branch is the same as §7's —
return to arm A with `paths:` gating on every language skill and per-language distribution on the
harnesses without `paths:` support. **No recommendation is offered beyond that**, and in particular
this run does not license a choice between the four wordings: the one clean separation found
(calibration, favouring `choice`) is not a metric the promotion rule uses, and the wording with the
better calibration is the one whose promotion metric cannot be computed through the current wire.

---

## 9. What this does not tell

Everything in PROTOCOL.md §8 and README.md §9 still applies unchanged. What this particular run adds:

1. **No arm was run.** A, B' and C were never configured, no skill was hidden, no injection was ever
   written, no model ever saw a router reminder. This measures one input to those arms — jev's
   answer — and nothing about what a model does with it.

2. **The material is a 400-character redacted excerpt, not the prompt.** Production sends the whole
   prompt through `boundedMaterial()` (4,000 chars, head+tail). 25 of the 200 excerpts are truncated
   from longer prompts, and redaction replaced paths, emails and the username with placeholders.
   Both changes remove information the model would have had.

3. **Top-3 is unmeasured for half the variants** and that half is the better-calibrated half.
   Nothing about the choice wording's fit to the promotion rule can be said until `remote.ts`
   carries `probabilities` through.

4. **The key is 86.5% model-made.** 173 of 200 labels came from a model reading the same catalog
   descriptions that jev reads. The 35–40 point native-open gap in §3.2 is the visible size of that
   shared bias; the pooled numbers are agreement with a model, not accuracy.

5. **The `none` majority sets the pooled numbers.** 127 of 200 rows are labelled `none`. A selector
   that abstained on everything would score 63.5% top-1 pooled — within 3 points of bool-ja at
   τ=0.6, and above choice-ja's accuracy on the skill rows at every threshold. The skill-row columns
   are the ones that carry information.

6. **The stability check is one variant, 40 prompts, one machine, one afternoon.** It says jev's
   answers are reproducible; it says nothing about drift across model versions
   (`jev-1.13.0` today) or across load.

7. **The order-swap check is a subset and under-powered** for the criterion it is tested against
   (§7).

8. **Latency here is the judgment leg only**, measured on loopback to a warm, already-running
   service, from a machine doing nothing else. A cold service, a busy machine, or a network hiccup
   is not represented.

9. **Cost is tokens, not money.** No verified price exists for this model.

10. **35 of the 54 skills never appear as a label.** Accuracy says nothing about them, and the
    language skills the owner's `paths:`-gating condition is actually about are among them.

---

## 10. Artefacts

```
tools/offline-eval.mjs            the runner and scorer (run / stability / order-swap / subset / score*)
results/raw-<variant>.jsonl       200 rows each: id, per-skill probability, latency_ms, status
results/meta-<variant>.json       call count, wall time, token deltas from the service's metrics
results/stability-bool-ja.jsonl   5 x 40 reruns
results/order-swap-choice-*.jsonl 40 rows each, catalog order reversed
results/latency-serial-bool-ja.jsonl  40-prompt concurrency-1 latency control
results/subset-40.json            the seeded stability/order-swap subset, listed
results/metrics.json              every number in §2-§4 and §3.x
results/metrics-stability-*.json  §5
results/metrics-order-swap-*.json §7
```

Reproduce with, from this directory:

```
node tools/offline-eval.mjs run {bool-ja,bool-en,choice-ja,choice-en}
node tools/offline-eval.mjs stability bool-ja
node tools/offline-eval.mjs order-swap {choice-ja,choice-en}
node tools/offline-eval.mjs score
node tools/offline-eval.mjs score-stability bool-ja
node tools/offline-eval.mjs score-order-swap {choice-ja,choice-en}
```

The judgment service must already be running; the tool never starts it and never holds the vendor key.
