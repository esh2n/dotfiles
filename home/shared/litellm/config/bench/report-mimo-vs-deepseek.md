# MiMo-V2.6-Flash vs deepseek-flash

- date: 2026-09-27T05:28Z · runs/prompt: 2 · each model on its own vendor API

## Local quant A/B — deterministic tier

- base: `https://api.xiaomimimo.com/v1` · runs/prompt: 2 · max_tokens: 4096 · temp 0, seed 0
- models: `mimo-v2.6-flash`
- prompts: 10 (/Users/esh2n/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `mimo-v2.6-flash` | — | — | — |

## Quality (auto-graded, run 1)

| prompt | check | `mimo-v2.6-flash` | agree? |
|---|---|---|---|
| json-extract | json_fields | ❌ error | = |
| tool-args | json_fields | ❌ error | = |
| csv-to-json | json_array_len | ❌ error | = |
| classify-sentiment | equals | ❌ error | = |
| enum-route | equals | ❌ error | = |
| yes-no | equals | ❌ error | = |
| exact-format | equals | ❌ error | = |
| extract-number | equals | ❌ error | = |
| math-factorial | equals | ❌ error | = |
| code-edit-nil | contains | ❌ error | = |

**auto-pass:** `mimo-v2.6-flash` 0/10

## Determinism (identical output across 2 runs)

- `mimo-v2.6-flash`: all deterministic ✅

## Local quant A/B — deterministic tier

- base: `https://api.deepseek.com/v1` · runs/prompt: 2 · max_tokens: 4096 · temp 0, seed 0
- models: `deepseek-flash`
- prompts: 10 (/Users/esh2n/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `deepseek-flash` | 573 | 174.0 | 757 |

## Quality (auto-graded, run 1)

| prompt | check | `deepseek-flash` | agree? |
|---|---|---|---|
| json-extract | json_fields | ✅ | = |
| tool-args | json_fields | ✅ | = |
| csv-to-json | json_array_len | ✅ | = |
| classify-sentiment | equals | ✅ | = |
| enum-route | equals | ✅ | = |
| yes-no | equals | ✅ | = |
| exact-format | equals | ✅ | = |
| extract-number | equals | ✅ | = |
| math-factorial | equals | ✅ | = |
| code-edit-nil | contains | ✅ | = |

**auto-pass:** `deepseek-flash` 10/10

## Determinism (identical output across 2 runs)

- `deepseek-flash`: all deterministic ✅

