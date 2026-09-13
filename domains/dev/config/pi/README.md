# pi — local LLM lane

pi (@earendil-works/pi-coding-agent) configured as the **local-only driver**
for Qwen3.8-27B on LM Studio. This is not the main harness — Claude Code and
omp keep their roles; pi exists to squeeze the most quality out of a local
27B model with the thinnest possible resident context.

Decision record: writeup store `local-llm/2026-09-13-local-llm-yoki-integration-decision.html`
(pi 選定・拡張選定の根拠と却下案はそちら)。

## Design constraint — the 1K-token budget

The whole point of pi here is a resident context around 1K tokens (system
prompt + tool schemas). Everything in `extensions/` is chosen to cost ~zero
resident tokens (pure event hooks); the one exception is `gate.ts` (+1 tool
schema, deliberately). Before adding anything, ask: does it add a resident
tool schema or per-turn injection? If yes, it needs to beat gate.ts's
value-per-token. Skills, web-search tools, subagent tools, and per-turn
status injections were evaluated and rejected — see the decision record.

## Files

| File | Role |
|---|---|
| `models.json` | LM Studio provider + Qwen3.8-27B compat (`qwen-chat-template` thinking, `thinkingLevelMap` pins medium — upstream #8567 otherwise always picks xhigh), official sampling params |
| `settings.json` | lmstudio-only model list, compaction reserve 24k |
| `AGENTS.md` | ~1KB resident instructions for the local lane (stale-edit, tool-call, output discipline, git rules) |
| `extensions/freshness.ts` | Blocks stale-file edits, failed-edit retries without re-read, 3x identical-call loops. Resident cost 0 |
| `extensions/compactor.ts` | Caps tool results at 30k chars (spill to `~/.local/state/pi/spill/`), proactive compact at 80%. Resident cost 0 |
| `extensions/guard.ts` | pi-side counterpart of yoki git-guard: hard-blocks push-to-main / force-push / --no-verify / second-model loads; confirms rm -rf etc. Resident cost 0 |
| `extensions/gate.ts` | `/goal` + `/gate` + `goal_complete` — completion refused until gates pass, gates not rerun on unchanged workspace. Resident cost: 1 tool schema |

Extensions adapted from [earlyaidopters/marks-pi-harness](https://github.com/earlyaidopters/marks-pi-harness)
(MIT), rules aligned with yoki conventions.

## Install (manual for now)

Pin pi to 0.84.x — the 0.85 series has an open local-model streaming
regression (earendil-works/pi#9216):

```sh
npm install -g @earendil-works/pi-coding-agent@0.84.4
```

Link config into `~/.pi/agent/` (idempotent):

```sh
PI_SRC="$HOME/go/github.com/esh2n/dotfiles/domains/dev/config/pi"
mkdir -p ~/.pi/agent/extensions
ln -sf "$PI_SRC/settings.json" ~/.pi/agent/settings.json
ln -sf "$PI_SRC/models.json"   ~/.pi/agent/models.json
ln -sf "$PI_SRC/AGENTS.md"     ~/.pi/agent/AGENTS.md
for f in "$PI_SRC"/extensions/*.ts; do ln -sf "$f" ~/.pi/agent/extensions/"$(basename "$f")"; done
```

LM Studio side: load `qwen/qwen3.8-27b` with context ≥ 64K (131072 current),
then `lms server start`.

## Known issues tracked upstream

- earendil-works/pi#8567 — qwen-chat-template always selects xhigh thinking;
  worked around via `thinkingLevelMap` in models.json
- earendil-works/pi#9216 — 0.85.x stream "terminated" with local qwen3.8;
  reason for the 0.84.4 pin. Re-test on the next 0.85 patch
