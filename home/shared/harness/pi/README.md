# pi — three-tier lane

pi (@earendil-works/pi-coding-agent) drives three model tiers behind one
resident-context budget:

| Tier | Model | Endpoint |
|---|---|---|
| `main` | DeepSeek Flash | LiteLLM proxy, `localhost:4000` |
| `complex` | DeepSeek V4 Pro | same proxy — design decisions, ambiguous bugs, large reviews |
| `deterministic` | Qwen3.8-27B | same proxy → LM Studio (free, offline, reproducible) |

Started as the local-only driver for Qwen3.8-27B; the proxy tiers were added
later. Claude Code and omp keep their roles — pi exists to squeeze the most
quality out of each model with the thinnest possible resident context.

Decision record: writeup store `local-llm/2026-09-13-local-llm-yoki-integration-decision.html`
(pi 選定・拡張選定の根拠と却下案はそちら)。

## One door per model — no direct LM Studio entry

Every tier goes through the proxy, including the local one. `models.json` has no
`lmstudio/*` provider, and that is deliberate. The same Qwen3.8 27B used to be
reachable two ways — the proxy alias `deterministic`, and a direct
`localhost:1234` entry — and traffic through the direct entry is invisible to the
dashboard: no TTFT, no tokens, no cost, and no way afterwards to tell which door
a session used. Because the point of this lane is measuring which model to use,
the direct entry was removed on 2026-09-19. The cost is real and accepted: with
the proxy (Docker) down, the local model is not selectable at all.

The local tier's wire settings moved with the removal. `qwen-chat-template`
thinking, `supportsReasoningEffort: false` and the official Qwen sampling params
(`temperature 1.0`, `top_p 0.95`, `top_k 20`) now sit on the `deterministic`
alias, so closing the direct door did not silently change how the local model is
called. None of that has been exercised through the proxy yet (0 requests at the
time of writing) — the first measured local request is what confirms it.

## Design constraint — the 1K-token budget

The whole point of pi here is a resident context around 1K tokens (system
prompt + tool schemas). Everything in `extensions/` is chosen to cost ~zero
resident tokens (pure event hooks); the one exception is `gate.ts` (+1 tool
schema, deliberately). Before adding anything, ask: does it add a resident
tool schema or per-turn injection? If yes, it needs to beat gate.ts's
value-per-token. Skills, web-search tools, subagent tools, and per-turn
status injections were evaluated and rejected — see the decision record.

## Context budget — window vs compaction limit

`models.json` declares the window the model actually has. The compaction limit
is a **separate, lower number**, owned by `extensions/compactor.ts`. The tier
decides how much a session may carry; the model does not.

| Tier | Declared window | Compaction limit | Source |
|---|---|---|---|
| `main` | 1,000,000 | 200,000 | proxy `/v1/models`: `max_input_tokens: 1000000` |
| `complex` | 1,000,000 | 500,000 | same |
| `deterministic` | 131,072 | 80% = 104,857 | the proxy reports LM Studio's loaded context |

Why the split: Codex CLI ships `model_context_window` and
`model_auto_compact_token_limit` as two keys, and Claude Code has an
`autoCompactWindow` setting (100K–1M) independent of the model window.
Declaring the real window keeps pi's own token accounting honest, while the
compaction limit stays a policy choice. 200k is the boundary at which Claude
Code compacts 200K-window models; quality degrades well before a claimed
window fills (RULER; Chroma "context rot"), so 1M is declared but never used
as a working size. The status line reads `ctx 57%/200k` — a reading above
100% means the proactive compaction did not fire, which is the visible
failure mode to watch after a pi upgrade.

`compaction.reserveTokens: 16384` in `settings.json` is only pi's own
backstop (window − reserve); the extension fires far earlier.

## Files

| File | Role |
|---|---|
| `models.json` | all three tiers as proxy aliases: `main` (Flash), `complex` (V4 Pro), `deterministic` (Qwen3.8-27B via LM Studio), each declaring the window the proxy reports. The local alias also carries `qwen-chat-template` thinking, `thinkingLevelMap` pinning medium (upstream #8567 otherwise always picks xhigh) and the official Qwen sampling params. No direct provider — see "One door per model" |
| `settings.json` | proxy-first default (`main`), `enabledModels` limited to the proxy tiers, compaction reserve 16k |
| `AGENTS.md` | ~1.6KB resident instructions shared by all tiers (align-before-executing, stale-edit, tool-call, output discipline, git rules) |
| `extensions/freshness.ts` | Blocks stale-file edits, failed-edit retries without re-read, 3x identical-call loops. Resident cost 0 |
| `extensions/compactor.ts` | Caps tool results at 30k chars (spill to `~/.local/state/pi/spill/`), proactive compaction at a per-model limit (main 200k, complex 500k, otherwise 80% of the declared window). Resident cost 0 |
| `extensions/guard.ts` | pi's own blast-radius guard: hard-blocks push-to-main / force-push / --no-verify / second-model loads; confirms rm -rf etc. Resident cost 0 |
| `extensions/gate.ts` | `/goal` + `/gate` + `goal_complete` — completion refused until gates pass, gates not rerun on unchanged workspace. Resident cost: 1 tool schema |
| `extensions/tier-router.ts` | `/tier [main\|complex\|deterministic\|off]` — the session runs on ONE tier (`main` unless `PI_TIER` or `/tier` picked another) and the extension only holds it there, putting the model back when pi's startup race or a `/model` pick lands elsewhere. Never automatic: a stronger model is a subagent's `model:` (`agents/models.json`), per `rules/decisions/2026-09-23-tier-fixed-main-subagent-escalation.md`. Resident cost 0 |
| `extensions/compaction-judgment.ts` | `/compact-judgment [on\|off]`; asks the judgment service (`POST /compact`) which items a compaction is about to summarize are reproducible and can go, and gives only the kept ones to the summarizer (`ctx.model`, its own `complete()` call). Notices what it dropped; every failure falls back to pi's own compaction. **ON by default**, opt out with `PI_COMPACT_JUDGMENT=off` or `/compact-judgment off`. Resident cost 0 |

Extensions adapted from [earlyaidopters/marks-pi-harness](https://github.com/earlyaidopters/marks-pi-harness)
(MIT).

## Install

Install the latest release — this lane carries no version pin:

```sh
npm install -g @earendil-works/pi-coding-agent@latest
```

History: 0.84.x was held back for upstream #9216 (0.85.x local streaming
"terminated" + auto-compaction not re-triggering after the first run). On
2026-09-19 a one-turn smoke test of **0.85.1** against `lmstudio/qwen3.8-27b`
(the direct entry, removed since — see "One door per model")
on this machine passed, so 0.85.1 is installed. The issue is still open and
was reported after 0.85.1 shipped (Windows + Ollama, GGUF quant — not this
machine's macOS + LM Studio MLX setup), so neither symptom is fixed by a
newer release yet. Roll back if either shows up:

```sh
npm install -g @earendil-works/pi-coding-agent@0.84.4
```

Config linking is home-manager's (`home/shared/harness/default.nix`), not by
hand. One command, idempotent, from the checkout:

```sh
make up
```

It links `settings.json` / `models.json` and each `extensions/*.ts` and
`themes/*.json` file-by-file into `~/.pi/agent/` (never the directory — your
own `~/.pi/agent/extensions/*.ts` and `pi install`ed extensions stay
untouched); `jig setup` then writes `~/.pi/agent/AGENTS.md`. Regression
suite: `tests/flake/links-harness.bats`.

<details>
<summary>Manual fallback (environments without the dotfiles link machinery)</summary>

```sh
PI_SRC="$DOTFILES_ROOT/home/shared/harness/pi"
mkdir -p ~/.pi/agent/extensions
ln -sf "$PI_SRC/settings.json" ~/.pi/agent/settings.json
ln -sf "$PI_SRC/models.json"   ~/.pi/agent/models.json
for f in "$PI_SRC"/extensions/*.ts; do ln -sf "$f" ~/.pi/agent/extensions/"$(basename "$f")"; done
jig apply --target pi --write   # writes ~/.pi/agent/AGENTS.md
```

</details>

LM Studio side: load `qwen/qwen3.8-27b` with context ≥ 64K (131072 current),
then `lms server start`.


## Third-party extensions (installed via `pi install`, recorded in settings.json)

Selected from a community recommendation list after per-repo resident-cost
verification (registerTool count + per-turn injections read from source):

| Extension | Why it made the cut | Resident cost |
|---|---|---|
| [dimk90/pi-context-view](https://github.com/dimk90/pi-context-view) | `/context usage` / `/context injections` — the audit instrument for this lane's 1K-token budget. TUI-only | 0 |
| [Ahm3tJ4f/pi-undo](https://github.com/Ahm3tJ4f/pi-undo) | Message-level shadow-git undo/redo — insurance for an erratic local model | 0 (hooks only) |
| [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc) | Structured compaction **without an LLM call** (30–470ms). Core compaction summarizes with the model itself — minutes at 8 tok/s locally | 1 tool (~500 tok), accepted |
| [dbachelder/pi-btw](https://github.com/dbachelder/pi-btw) | Side conversations; added with the proxy tiers | not re-measured |
| [@plannotator/pi-extension](https://www.npmjs.com/package/@plannotator/pi-extension) | Plan/code review UI; added with the proxy tiers | not re-measured |
| [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access) | `web_search` / `fetch_content`. Zero-config through Exa MCP (no key); Jina Reader needs no key, other providers take keys in `~/.pi/agent/web-search.json` | ~2K tok |

The last three are in `settings.json` but their resident cost has not been
re-measured since the proxy tiers were added — treat the cost column as
verified for the first three only.

Evaluated and NOT installed (resident cost or single-instance mismatch):
pi-lens (~2.3K tok + per-turn injection), pi-add-dir (unbounded per-turn
AGENTS.md injection), rpiv-ask-user-question (~1.2K tok init),
pi-session-recall. Their earlier rejection of pi-btw / swarm-family rested on
a single LM Studio instance (parallel requests invalidating each other's KV
cache), which no longer applies to the proxy tiers. "Swarm" has no canonical
implementation — it is several community extensions sharing a name.

pi-web-access was rejected when this lane was local-only: 2K resident tokens
is ~16s of cold prefill at 8 tok/s. With `main` on the proxy that cost is a
cached prefix instead (2K tokens ≈ $0.00006/turn at Flash cache-hit rates),
so it was installed on 2026-09-19 and verified with a live `web_search` call.

## Measured on this machine (M4 Pro 64GB, 2026-09-13)

- Decode ≈ 8.2 tok/s (thinking included, wall-clock) — dense-27B physics
- Cold prefill ≈ 120 tok/s: every resident 1K tokens costs ~8s of cold TTFT
- **Prompt cache works for this model**: identical-prefix TTFT 36.9s → 3.0s
  (~12x). The "hybrid attention gets no cache" report did not reproduce on
  qwen3_5 arch. Conditions: serial requests only, /v1 endpoint
- `showCacheMissNotices: true` is set but cannot fire against LM Studio
  (its /v1 usage reports no cached_tokens — lmstudio-bug-tracker#2390);
  it becomes useful the moment a cloud provider is added to models.json

## Known issues tracked upstream

- earendil-works/pi#8567 — qwen-chat-template always selects xhigh thinking;
  worked around via `thinkingLevelMap` in models.json
- earendil-works/pi#9216 — 0.85.x stream "terminated" with local qwen3.8,
  plus auto-compaction not re-triggering after the first run. Still open;
  0.85.1 passed a one-turn smoke test here (see Install). The re-trigger half
  is untested against our 200k/500k limits: if `ctx` climbs past 100% of the
  limit without a second compaction, roll back to 0.84.4
