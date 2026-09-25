# Local quant A/B — deterministic tier

- base: `http://localhost:1234/v1` · runs/prompt: 2 · max_tokens: 4096 · temp 0, seed 0
- models: `qwen/qwen3.8-27b@4bit` vs `qwen/qwen3.6-35b-a3b@8bit` vs `prism-ml/bonsai-27b@2bit`
- prompts: 10 (/Users/esh2n/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/next/home/shared/litellm/config/bench/prompts.json)

## Speed

| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |
|---|--:|--:|--:|
| `qwen/qwen3.8-27b@4bit` | 1548 | 15.0 | 6485 |
| `qwen/qwen3.6-35b-a3b@8bit` | 352 | 53.7 | 9150 |
| `prism-ml/bonsai-27b@2bit` | 962 | 25.1 | 22491 |

## Memory (measured after load)

- requested for every model: context 32768, parallel 1 (LM Studio may override the context — trust the measured column)

| model | variant loaded | weights (GB) | ctx | parallel |
|---|---|--:|--:|--:|
| `qwen/qwen3.8-27b@4bit` | `qwen/qwen3.8-27b@4bit` | 16.08 | 208384 | 1 |
| `qwen/qwen3.6-35b-a3b@8bit` | `qwen/qwen3.6-35b-a3b@8bit` | 37.75 | 162816 | 1 |
| `prism-ml/bonsai-27b@2bit` | `prism-ml/bonsai-27b@2bit` | 8.52 | 251648 | 1 |

## Quality (auto-graded, run 1)

| prompt | check | `qwen/qwen3.8-27b@4bit` | `qwen/qwen3.6-35b-a3b@8` | `prism-ml/bonsai-27b@2b` | agree? |
|---|---|---|---|---|---|
| json-extract | json_fields | ✅ | ✅ | ✅ | ≠ |
| tool-args | json_fields | ✅ | ✅ | ✅ | = |
| csv-to-json | json_array_len | ✅ | ✅ | ✅ | ≠ |
| classify-sentiment | equals | ✅ | ✅ | ✅ | = |
| enum-route | equals | ✅ | ✅ | ✅ | = |
| yes-no | equals | ✅ | ✅ | ✅ | = |
| exact-format | equals | ✅ | ✅ | ✅ | = |
| extract-number | equals | ✅ | ✅ | ✅ | = |
| math-factorial | equals | ✅ | ✅ | ✅ | = |
| code-edit-nil | contains | ✅ | ✅ | ✅ | ≠ |

**auto-pass:** `qwen/qwen3.8-27b@4bit` 10/10 · `qwen/qwen3.6-35b-a3b@8bit` 10/10 · `prism-ml/bonsai-27b@2bit` 10/10

## Determinism (identical output across 2 runs)

- `qwen/qwen3.8-27b@4bit`: all deterministic ✅
- `qwen/qwen3.6-35b-a3b@8bit`: all deterministic ✅
- `prism-ml/bonsai-27b@2bit`: all deterministic ✅

## Where models disagree (run 1)

**json-extract** (structured)
- `qwen/qwen3.8-27b@4bit`: {"name":"Taro","age":28}
- `qwen/qwen3.6-35b-a3b@8bit`: {"name":"Taro","age":28}
- `prism-ml/bonsai-27b@2bit`: {"name": "Taro", "age": 28}

**csv-to-json** (structured)
- `qwen/qwen3.8-27b@4bit`: [{"id":1,"name":"alice"},{"id":2,"name":"bob"}]
- `qwen/qwen3.6-35b-a3b@8bit`: [{"id":1,"name":"alice"},{"id":2,"name":"bob"}]
- `prism-ml/bonsai-27b@2bit`: [{"id":"1","name":"alice"},{"id":"2","name":"bob"}]

**code-edit-nil** (code)
- `qwen/qwen3.8-27b@4bit`: func Len(s *string) int {⏎	if s == nil {⏎		return 0⏎	}⏎	return len(*s)⏎}
- `qwen/qwen3.6-35b-a3b@8bit`: func Len(s *string) int {⏎	if s == nil {⏎		return 0⏎	}⏎	return len(*s)⏎}
- `prism-ml/bonsai-27b@2bit`: func Len(s *string) int { if s == nil { return 0 } return len(*s) }
