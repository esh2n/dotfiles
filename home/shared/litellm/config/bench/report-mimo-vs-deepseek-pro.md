# mimo-v2.6-pro vs deepseek-v4-pro

- 2026-09-27 · runs/prompt: 2 · each model on its own vendor API · temp 0, seed 0 · max_tokens 16384
- decode tok/s counts every generated token, reasoning included

| model | pass | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) | identical across runs |
|---|--:|--:|--:|--:|---|
| `deepseek-v4-pro` | 10/10 | 798 | 69.2 | 1501 | varied on code-edit-nil |
| `mimo-v2.6-pro` | 10/10 | 3525 | 126.9 | 4451 | varied on csv-to-json |

- date: 2026-09-27T05:37Z · runs/prompt: 2 · each model on its own vendor API

## Local quant A/B — deterministic tier

- base: `https://api.xiaomimimo.com/v1` · runs/prompt: 2 · max_tokens: 16384 · temp 0, seed 0
- models: `mimo-v2.6-pro`
- prompts: 10 (/Users/esh2n/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `mimo-v2.6-pro` | 3525 | 126.9 | 4451 |

## Quality (auto-graded, run 1)

| prompt | check | `mimo-v2.6-pro` | agree? |
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

**auto-pass:** `mimo-v2.6-pro` 10/10

## Determinism (identical output across 2 runs)

- `mimo-v2.6-pro`: varied on csv-to-json ⚠️

## Local quant A/B — deterministic tier

- base: `https://api.deepseek.com/v1` · runs/prompt: 2 · max_tokens: 16384 · temp 0, seed 0
- models: `deepseek-v4-pro`
- prompts: 10 (/Users/esh2n/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `deepseek-v4-pro` | 798 | 69.2 | 1501 |

## Quality (auto-graded, run 1)

| prompt | check | `deepseek-v4-pro` | agree? |
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

**auto-pass:** `deepseek-v4-pro` 10/10

## Determinism (identical output across 2 runs)

- `deepseek-v4-pro`: varied on code-edit-nil ⚠️

