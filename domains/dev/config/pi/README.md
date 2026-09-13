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
| `extensions/yoki-graph-widget.ts` | Live yoki-graph run progress in the below-editor widget slot; appears only while a run is active, event-driven (fs.watch + 500ms coalesce, 5s safety tick). Resident cost 0 |

Extensions adapted from [earlyaidopters/marks-pi-harness](https://github.com/earlyaidopters/marks-pi-harness)
(MIT), rules aligned with yoki conventions; `yoki-graph-widget.ts` is
yoki-native (display logic lives in the yoki repo, see below).

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

## yoki-graph widget (`extensions/yoki-graph-widget.ts`)

Shows live yoki-graph run progress under pi's prompt: header
(`yoki-graph ▶ N runs`), one row per active run
(`▶ name  phase 2/5  3m12s  lanes 3/4`), rows for ACTIVE lanes only
(`◉ label  12t  1m02s`; `↻` retrying, `🔸` needs-human — never cut by the
8-line cap, overflow folds into `… and N more`). When no run is active the
widget is removed entirely — zero lines occupied.

Design constraints:

- **Zero model-context cost** — no tool, no message injection; UI APIs and
  lifecycle events only. Safe for the 1K-token budget by construction.
- **Display logic lives in the yoki repo** — the extension resolves
  `$YOKI_ROOT` (fallback: the default dotfiles checkout path) and requires
  `scripts/lib/graph/{top.js,widget-lines.js}`; folding/nesting/liveness
  are the exact code `yoki-graph top` uses, tested by
  `node --test lib/graph/test/*.test.js` (see `widget-lines.test.js`).
  Resolution failure disables the extension with one stderr line — pi
  always starts.
- **Event-driven** — fs.watch on the graph state root and each active
  runDir, coalesced to one refresh per 500ms; the only timer is a 5s
  safety tick (dead-watcher net; also keeps elapsed columns moving).

Link it like the other extensions (already covered by the `for f in
"$PI_SRC"/extensions/*.ts` loop above, or individually):

```sh
ln -sf "$PI_SRC/extensions/yoki-graph-widget.ts" ~/.pi/agent/extensions/yoki-graph-widget.ts
```

Manual verification (the extension is IO glue around tested pure code, so
this is the remaining check):

1. Start `pi` in any directory (TUI mode).
2. In another shell, start a yoki-graph run, e.g.
   `yoki-graph run ~/.claude/workflows/review.mjs -- --target HEAD` (any
   graph works; `--state-home` must NOT be overridden or pi won't see it).
3. Within ~1s the widget appears below the editor and updates as lanes
   start/tick/finish. `🔸` rows (needs-human) always stay visible.
4. When the run finishes (or is killed), the widget disappears within ~5s.
5. Quit pi — no stray fs watchers remain (the process exits cleanly).

## Third-party extensions (installed via `pi install`, recorded in settings.json)

Selected from a community recommendation list after per-repo resident-cost
verification (registerTool count + per-turn injections read from source):

| Extension | Why it made the cut | Resident cost |
|---|---|---|
| [dimk90/pi-context-view](https://github.com/dimk90/pi-context-view) | `/context usage` / `/context injections` — the audit instrument for this lane's 1K-token budget. TUI-only | 0 |
| [Ahm3tJ4f/pi-undo](https://github.com/Ahm3tJ4f/pi-undo) | Message-level shadow-git undo/redo — insurance for an erratic local model | 0 (hooks only) |
| [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc) | Structured compaction **without an LLM call** (30–470ms). Core compaction summarizes with the model itself — minutes at 8 tok/s locally | 1 tool (~500 tok), accepted |

Evaluated and NOT installed (resident cost or single-instance mismatch):
pi-web-access (~1.5–2K tok; research is the cloud lane's job), pi-lens
(~2.3K tok + per-turn injection), pi-add-dir (unbounded per-turn AGENTS.md
injection), rpiv-ask-user-question (~1.2K tok init), pi-btw / swarm-family
(parallel LLM requests serialize on one LM Studio instance and concurrent
requests invalidate each other's KV cache — lmstudio-bug-tracker#2320),
plannotator / pi-session-recall (cloud-lane value). "Swarm" has no canonical
implementation — it is several community extensions sharing a name.

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
- earendil-works/pi#9216 — 0.85.x stream "terminated" with local qwen3.8;
  reason for the 0.84.4 pin. Re-test on the next 0.85 patch
