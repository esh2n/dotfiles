# MiMo-V2.6-Flash vs deepseek-flash

- 2026-09-27 · runs/prompt: 2 · each model on its own vendor API · temp 0, seed 0 · max_tokens 4096
- deepseek-flash was measured first; mimo-v2.6-flash after the Xiaomi account was funded (the first MiMo run got HTTP 402 `insufficient_balance` on every request)
- decode tok/s counts every generated token, reasoning included (MiMo reasons by default)

| model | pass | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) | identical across runs |
|---|--:|--:|--:|--:|---|
| `deepseek-flash` | 10/10 | 573 | 174.0 | 757 | all |
| `mimo-v2.6-flash` | 10/10 | 3447 | 113.0 | 4288 | varied on code-edit-nil |

## Local quant A/B — deterministic tier

- base: `https://api.xiaomimimo.com/v1` · runs/prompt: 2 · max_tokens: 4096 · temp 0, seed 0
- models: `mimo-v2.6-flash`
- prompts: 10 (prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `mimo-v2.6-flash` | 3447 | 113.0 | 4288 |

## Quality (auto-graded, run 1)

| prompt | check | `mimo-v2.6-flash` | agree? |
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

**auto-pass:** `mimo-v2.6-flash` 10/10

## Determinism (identical output across 2 runs)

- `mimo-v2.6-flash`: varied on code-edit-nil ⚠️


## Local quant A/B — deterministic tier

- base: `https://api.deepseek.com/v1` · runs/prompt: 2 · max_tokens: 4096 · temp 0, seed 0
- models: `deepseek-flash`
- prompts: 10 (prompts.json)

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

