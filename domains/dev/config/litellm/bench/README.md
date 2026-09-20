# bench — local model A/B for the deterministic tier

Measure two (or more) local models on the *same* deterministic-tier prompt set,
on this machine, with your own tasks — because no public leaderboard tests your
exact JSON/tool/edit workload. Quality (auto-graded), run-to-run determinism,
speed (TTFT + decode tok/s) and the measured footprint side by side.

## Run

### Several models resident at once

Point it at LM Studio directly, one id per model:

```sh
node quant-ab.mjs \
  --base http://localhost:1234/v1 \
  --models '<id-4bit>,<id-8bit>' \
  --runs 2 --out report.md
```

This assumes LM Studio holds every model listed. **On a unified-memory Mac it
usually cannot**: the four local models on this machine total ~92 GB and the
largest is 37.75 GB, so only one is resident at a time. Use `--sequential`.

### One model at a time (`--sequential`)

```sh
node quant-ab.mjs --sequential --runs 2 \
  --models 'qwen/qwen3.8-27b@4bit,qwen/qwen3.6-35b-a3b@8bit,prism-ml/bonsai-27b@2bit' \
  --out report.md
```

It unloads whatever is resident, loads each model on its own, waits for it to
come up, reads back the identifier LM Studio assigned, drives the prompts through
*that* identifier, and records the measured footprint.

Context length and parallel slots **follow the model**: each one is loaded at the
size it was built and configured for, which is the comparison that matches how it
would actually be run. Forcing a single value on all of them would compare models
at a size none of them would use — and LM Studio overrides the request anyway
(measured: asked for 32768, got 208384 / 162816 / 251648). Pass `--context-length`
/ `--parallel` to force a value instead; the report's measured columns are what
actually loaded, either way.

**Two builds of one path cannot share a pass.** LM Studio ignores the `@quant`
suffix when loading: `lms load` and the REST load endpoint both load whichever
variant is *selected in the app*, and the CLI offers no way to change that
selection (lmstudio-ai/lmstudio-bug-tracker#1462 — open as of 2026-09, with a
`lms import --hard-link` workaround proposed for GGUF only; these builds are
MLX). Pass one variant per run and flip the app's selection in between:

```sh
# with @4bit selected in the app
node quant-ab.mjs --sequential --runs 2 \
  --models 'qwen/qwen3.8-27b@4bit,qwen/qwen3.6-35b-a3b@8bit,prism-ml/bonsai-27b@2bit'

# then select @8bit in the app and run that build on its own
node quant-ab.mjs --sequential --runs 2 --models 'qwen/qwen3.8-27b@8bit'
```

`@variant` is therefore an **assertion, not a selector**: the run checks it
against the app's selection up front and refuses to start on a mismatch, rather
than measure the other build and label it with the name you asked for.

### Flags

- `--models` — comma-separated model keys, optionally `path@variant` (checked, see above).
- `--runs` — repeats per prompt (>=2 detects non-determinism).
- `--max-tokens` — completion budget per request (default 4096; see Truncation above).
- `--out` — also write the markdown report to a file (always printed to stdout).
- `--sequential` — load/unload per model.
- `--context-length`, `--parallel` — force these at load; by default each model keeps its own.
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
- **Truncation:** a reasoning model can spend the whole `--max-tokens` budget in
  `reasoning_content` and never emit `content`. Measured here: `enum-route` at
  max_tokens 512 came back `finish_reason=length, content_chars=0`, while the same
  prompt at 2048 returned `billing` in 648 tokens. Those runs are counted as
  **ungraded** (`✂ token limit`) and never as failures — otherwise a token floor
  reads as a quality gap. The default is 4096 for exactly this reason; the old
  512 default made two of the three local models look worse than they are.
- **Determinism:** whether each model gave identical output across runs.
- **Disagreements:** side-by-side outputs where the models differ.
- **Memory** (`--sequential` only): weights in GB, context length and parallel
  slots as loaded, plus which variant of the path was actually served. A model
  that wins on quality and speed can still lose on fitting.

## Baseline (2026-09-18, current `qwen/qwen3.8-27b` 8-bit)

TTFT ~1.55s · decode ~9.2 tok/s · quality 10/10. The ~9 tok/s is slow for a
3.3B-active MoE — suggesting this build is dense, not the MoE it was assumed to
be, which is exactly the kind of thing measuring (not leaderboards) settles.
Pull `mlx-community/Qwen3-Coder-30B-A3B-Instruct-{4bit,8bit}` and A/B to decide.

Caveat on that baseline: it names `qwen/qwen3.8-27b` without a variant, and that
path covers both builds. Worse, the app's selected variant for this path has
since been read as `@4bit`, and `lms load` loads the selected variant — so an
"8-bit" label on a run made without checking is at best unverified. The report
now records the `selectedVariant` that was served; trust that column, not the
label, until the baseline is re-measured under `--sequential`.
