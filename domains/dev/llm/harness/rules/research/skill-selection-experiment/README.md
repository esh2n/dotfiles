# skill-selection-experiment

The labeled prompt set and the frozen-protocol draft for the A / B' / C decision about
skill selection. **Nothing here is a result.** No arm has been run.

Read `PROTOCOL.md` first — it defines the arms, the flags, the question wording, the
metrics and the promotion rule. This file explains how the data was produced, how to
regenerate it, and how to record spot-check verdicts.

| File | What it is |
|---|---|
| `PROTOCOL.md` | the experiment protocol, to be frozen by commit hash before any run |
| `prompts.jsonl` | 200 labeled prompts, one JSON object per line |
| `catalog-snapshot.json` | the 54 routable skills with per-description SHA-256 and a catalog hash |
| `spot-check.md` | 30 prompts (10 易 / 10 中 / 10 難) for the owner to verify by hand |
| `stats.json` | counts reproduced from the extraction run |
| `tools/` | the four extraction scripts and `labels.json`, so the set can be rebuilt |

---

## 1. Where the prompts come from

Sources, read-only:

- `~/.claude/projects/**/*.jsonl` — Claude Code session transcripts
- `~/.pi/agent/sessions/**/*.jsonl` — pi session transcripts

Window: files modified in the **last 90 days** (extraction run 2026-09-22). 4,882 session
files, 7,406 prompt-initiated turns.

Parsing mirrors jig's own parser (`src/infra/transcripts/transcript.ts`) so the strata line
up with what `jig report skills` counts: the router's reminder is read from Claude Code's
`hook_additional_context` attachment and from pi's `custom_message`/`jig-skill-router`; an
opened skill is a `Read` of a path under a skill directory **or** a `Skill` tool call, both
filtered against the installed catalog.

One deliberate difference: this extractor creates a turn **only** when it sees a prompt.
jig's parser also opens a turn on an orphan injection or read with no prompt entry, which
is why it reports ~36 unscouted opens over 30 days where this set has 27 over 90. Those
orphan turns carry no prompt text and are useless for a labeled prompt set.

## 2. Two exclusion layers

**Layer 1 — jig's own**, replayed exactly from `src/domain/skills/prompt-origin.ts`:
subagent (structural `agent_type`/`agent_id`), hook-event replay, agent message,
task-notification, compaction, session-resume, skill body. Of 7,406 prompts, 5,072 were
excluded and 2,334 classified human.

**Layer 2 — added here**, because layer 1 lets machine text through. These are gaps in
jig's signature list, recorded so they can be fixed there:

| Reason | Dropped | Trigger |
|---|---:|---|
| `harness-nudge` | 478 | `[Your previous response had no visible output…` |
| `harness-notice` | 94 | `[Request interrupted by user`, `Your claude.ai usage limit has reset`, `<local-command-caveat>`, `Continue from where you left off` |
| `workflow-task` | 80 | contains `## Acceptance Contract` (a workflow's subagent task, which in pi runs as its own session and so has no `agent_type`) |
| `slash-noop` | 42 | `/clear`, `/compact`, bare `<command-name>` wrappers with empty args |
| `command-body` | 41 | a slash-command or skill body replayed as the prompt (`# /…`, `---\nname:`, `Approach this as the design lead…`, anything containing `workflowScript`) |
| `probe` | 15 | `Reply with exactly:` smoke tests |
| **total** | **750** | **32% of what jig currently calls a human prompt** |

`harness-nudge` alone is 478 prompts, almost all from `.claude-mem/observer-sessions`. On
the current classifier every one of them is a routable human request.

Prompts shorter than 8 characters after redaction are also dropped. Image-only prompts
(`[Image: …]` and nothing else) are real human turns but carry no routable text; six are
kept as a legitimate must-abstain case and the rest are held back so they do not inflate the
easy end of the set.

## 3. Strata

| Stratum | n | Definition |
|---|---:|---|
| `unscouted` | 27 | nothing injected, the model opened a routable skill anyway — **carries a natural label** |
| `followed` | 12 | something was injected and every injected skill was opened in that turn |
| `ignored` | 35 | something was injected and it was not (fully) opened |
| `none` | 126 | nothing injected, no skill opened — sampled from a cleaned pool of 1,360 |
| **total** | **200** | |

`unscouted`, `followed` and `ignored` are taken whole — they are all that exist in the
window. `none` is a seeded random sample (`SEED = "skill-selection-experiment-2026-09-22"`,
rank = `sha256(SEED|timestamp|session)`), so re-running the extractor picks the same 126.

## 4. Labels

| `label_source` | n | Meaning |
|---|---:|---|
| `native-open` | 27 | the skill the model opened by itself, with no injection. **Not overwritten.** Where the labeller disagreed, a `disagreement` field says why — 8 of the 27 carry one. |
| `model` | 173 | assigned by a model from the catalog descriptions in `~/.claude/.skills-merged/*/SKILL.md`. **Unverified until the owner's spot-check.** |

125 of 200 are labeled `none`. That is roughly what the corpus looks like (96% of all turns
have no skill activity) and the vendor's own Choice guidance asks for an explicit none
option, so a selector that abstains well should score well — which is exactly why the
per-stratum breakdown is mandatory in `PROTOCOL.md` §6 and the pooled number must never be
quoted alone.

Difficulty: **易 71 / 中 77 / 難 52.** Every 難 row carries a `why_hard`. The rubric:

- **易** — the prompt names the skill's subject almost literally, or is plainly outside
  every skill's scope.
- **中** — intent has to be read, one skill fits, a near-miss exists.
- **難** — genuinely ambiguous: a continuation turn with only pronouns, two skills equally
  pulled, or (most often) the right answer is `none` despite a strong keyword pull. The 難
  band is where a selector's false-positive behaviour is actually measured.

## 5. Redaction

Applied to every excerpt before it was written: `$HOME` and any `/Users/<name>` path →
`~`; email addresses → `<email>`; the username → `<user>`; `ghp_`/`sk-`/JWT-shaped tokens →
`<token>`. Excerpts are capped at 400 characters (`excerpt_truncated` says when the full
prompt was longer). No credential, key or token value appears in any file here.

Two caveats, stated rather than hidden: the redactor is pattern-based, so a personal name
written in Japanese kana inside a prompt body would survive it — the excerpts were read
once by hand and none was found, but that is a review, not a guarantee. And the prompts
are the owner's own personal repositories only (dotfiles, arekore, viewer, dqm6-server);
no employer repository appears in the window.

## 6. Field reference — `prompts.jsonl`

```jsonc
{
  "id":                "6ff461b1b21a",   // sha256(timestamp|session|prompt)[0:12], stable across runs
  "harness":           "claude",         // claude | pi
  "date":              "2026-08-23",
  "stratum":           "unscouted",      // unscouted | followed | ignored | none
  "prompt_excerpt":    "…",              // redacted, ≤400 chars
  "prompt_chars":      52,               // length of the ORIGINAL prompt
  "excerpt_truncated": false,
  "repo":              "~/go/github.com/<user>/dotfiles",
  "lang_signals":      ["html","md"],    // file extensions touched in that session, most frequent first
  "router_injected":   [],               // skills the router injected on this turn
  "router_confidence": null,
  "opened_skills":     ["eli5"],         // skills opened in that turn (Read or Skill)
  "label":             "eli5",           // a skill dir name, or "none"
  "label_source":      "native-open",    // native-open | model
  "why":               "…",              // one line
  "difficulty":        "易",             // 易 | 中 | 難
  "why_hard":          "…",              // present only when difficulty is 難
  "disagreement":      "…",              // present only when the labeller disagrees with a natural label
  "note":              "synthetic-probe…",// present on prompts the owner typed to instrument the router
  "verdict":           ""                // EMPTY — the owner fills this in
}
```

## 7. How the owner records spot-check verdicts

`spot-check.md` has a `verdict` column, empty. Fill each with one of:

- `ok` — the provisional label is right
- a skill directory name — the right one, when the label is wrong
- `none` — no skill applies

Add a short reason whenever you overrule. Answering in chat is fine; either way the
verdicts have to end up in `prompts.jsonl`'s `verdict` field before the protocol is frozen,
because `prompt_set_sha256` is taken over the file **with** the verdicts.

`PROTOCOL.md` §9 makes the threshold explicit: if more than 7 of the 30 provisional labels
are overturned, the whole 173-prompt provisional set is re-labelled before anything runs.

## 8. Regenerating

Four scripts in `tools/`, run in order from inside a scratch directory. They are read-only
on transcripts and configs and write only into the directory given on argv. They are a
one-shot extraction, not a maintained tool — if this ever needs to be a tool it belongs in
jig beside `report skills`, not here.

```
cd <some scratch dir>
node <this dir>/tools/extract.mjs ./stage1   # transcripts -> per-stratum dumps + catalog + summary
node <this dir>/tools/sample.mjs  ./stage2   # exclusion layer 2, redaction, seeded stratified sample
node <this dir>/tools/emit.mjs    <this dir> # merge tools/labels.json -> prompts.jsonl, catalog-snapshot.json, stats.json
node <this dir>/tools/spot.mjs    <this dir> # spot-check.md
```

`sample.mjs` and `emit.mjs` read `./stage1` / `./stage2.jsonl` relative to the cwd;
`emit.mjs` reads `./labels.json`, so copy `tools/labels.json` next to the stage files first.
`emit.mjs` exits non-zero if any sampled id has no label, which is what catches a re-run
whose window has slid.

The sample is deterministic: same transcripts + same seed = same 200 ids. It is **not**
deterministic across time — the 90-day window slides and old session files age out, so a
re-run next month produces a different set. The frozen protocol pins the set by
`prompt_set_sha256`, not by the extractor.

## 9. Known insufficiencies in this data

1. **12 followed turns and 27 natural labels is a thin key.** Both strata are taken whole;
   there is no more of them in 90 days.
2. **pi is 33 of 200.** Nothing arm-level can be concluded for pi.
3. **The language mix is narrow** — Markdown, TypeScript, shell, HTML. The CSS, React, Go,
   Python and Rust skills appear in essentially no prompt, so the set cannot test the
   `paths:`-gating condition that the A branch hinges on.
4. **19 distinct skills appear as a label, out of 54.** 35 routable skills have no example at all.
   Accuracy on this set says nothing about them.
5. **Four prompts are the owner's own instrumentation probes** (`note: synthetic-probe`).
   They are kept because two of them carry natural labels, but they are not organic traffic.
6. **Duplicate bodies.** Three `ignored` prompts are the same pasted research quote
   re-submitted three times. They are kept (they really happened, three times) but they make
   one case count three times in the pooled number.
7. **Follow rate cannot be computed offline for B' or C.** The historical turns were
   answered under A. See `PROTOCOL.md` §8.3.
