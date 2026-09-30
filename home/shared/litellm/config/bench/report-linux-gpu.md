# deterministic on the Linux model server — first measurement

- 2026-09-30, from the Mac over the tailnet, straight to llama-server (`http://<linuxModelHost>:8080/v1/chat/completions`), reading llama-server's own `timings` — the GPU's speed, without the network or LiteLLM.
- Model: `Qwen3.8-27B-Q4_K_M` (bartowski, 17.4 GB), RTX 3090 Ti 24 GB, `--ctx-size 65536 --parallel 1`, model already loaded.
- One prompt (「TCP の輻輳制御の仕組みを 300 字で説明して」), `max_tokens` 800, two runs.

| run | generated tokens | decode (tok/s) | ms / token |
|---|--:|--:|--:|
| 1 | 800 | 43.5 | 23.0 |
| 2 | 800 | 43.6 | 23.0 |

For comparison, the Mac's LM Studio with the same model at 4 bit decoded at 15.0 tok/s on average (`report.md`, ten prompts). That run averaged ten prompts through the bench harness; this one is a single prompt, so read the ratio (about 2.9×) as a first number, not a benchmark. Prompt-side speed is not reported here: both runs hit llama-server's prompt cache (`cache_n` 42 and 67 of a ~70-token prompt).
