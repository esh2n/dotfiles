# bench — local model A/B for the deterministic tier

Measure two (or more) local models on the *same* deterministic-tier prompt set,
on this machine, with your own tasks — because no public leaderboard tests your
exact JSON/tool/edit workload. Quality (auto-graded), run-to-run determinism,
and speed (TTFT + decode tok/s) side by side.

## Run

Point it at LM Studio directly (each model addressed by its LM Studio id; LM
Studio can keep several models loaded and route by id):

```sh
node quant-ab.mjs \
  --base http://localhost:1234/v1 \
  --models '<id-4bit>,<id-8bit>' \
  --runs 2 --out report.md
```

- `--models` — comma-separated LM Studio model ids (see `lms ls` or `GET /v1/models`).
- `--runs` — repeats per prompt (>=2 detects non-determinism).
- `--out` — also write the markdown report to a file (always printed to stdout).
- temp 0, seed 0 are sent; determinism is *measured*, not assumed.

## Prompts

`prompts.json` — a `system` prompt plus representative deterministic-tier tasks
(structured/JSON, tool-args, classification, instruction-following, a code edit).
Each has a `check` auto-grader: `equals`, `contains`, `regex`, `valid_json`,
`json_array_len`, `json_fields`, or `human` (diff only). Add your real tasks here
— the value of this tool is that it grades *your* workload.

## What the report shows

- **Speed:** avg TTFT (ms), avg decode (tok/s — spans reasoning+content so
  "thinking" models aren't mis-measured), avg total (ms).
- **Quality:** per-prompt pass/fail per model + whether the models agree.
- **Determinism:** whether each model gave identical output across runs.
- **Disagreements:** side-by-side outputs where the models differ.

## Baseline (2026-09-18, current `qwen/qwen3.8-27b` 8-bit)

TTFT ~1.55s · decode ~9.2 tok/s · quality 10/10. The ~9 tok/s is slow for a
3.3B-active MoE — suggesting this build is dense, not the MoE it was assumed to
be, which is exactly the kind of thing measuring (not leaderboards) settles.
Pull `mlx-community/Qwen3-Coder-30B-A3B-Instruct-{4bit,8bit}` and A/B to decide.
