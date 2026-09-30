# 家の LLM の二台目: Omarchy 機の llama-server を用途別の名前で載せ、deterministic は Mac に固定

Status: superseded by 2026-09-26-deterministic-on-the-gpu.md（deterministic の置き場所を Omarchy 機へ移し、モデルを決めた。llama-server の router mode・用途名・fallback なし・allowed_fails と cooldown はそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-09-24）。サーバーの比較調査の後に決めた。`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md` の「tailnet に出すモデルサーバーは Mac の LM Studio だけ」を、この記録で置き換える（それ以外の部分、LiteLLM は各機械でループバックのみ・一台一つ・計測の集め方は変えない）

rule: The `deterministic` tier stays on the Mac's LM Studio alone and is never routed to another machine. The Omarchy desktop (a 24 GB GPU) serves additional local models with llama.cpp's `llama-server` in router mode, as a systemd user service with `--api-key`, exposed on the tailnet with one `tailscale serve` TCP port; every machine's LiteLLM lists those models under purpose names (e.g. Japanese prose, light 4-bit), chosen explicitly per session like any tier, with no fallback to another model and `allowed_fails: 1` + `cooldown_time: 30` so a powered-off desktop answers "unavailable" in about a second.

## Problem

家の LLM の裁定は、モデルを出す機械を Mac 一台（LM Studio）と決めていた。Omarchy 機（GPU、VRAM 24GB）でも、用途の違うモデル（自然な日本語の文章を書くもの、軽い 4bit 量子化のもの）を動かし、Mac からもスマホからも使う。その機械は止まっていることが多い。

## Decision

- **deterministic は Mac に固定。** 再現性が目的の tier を二台に跨がせない。CUDA は一台でも出力が揺れ（llama.cpp #2838）、Metal と CUDA は計算の実装が違う。
- **Omarchy 機のモデルは用途別の名前で LiteLLM に載せる。** harness は tier の名前だけを知り、どのモデルかは LiteLLM が決める（`2026-09-23-model-routing-per-harness.md` の形のまま）。選ぶのはセッション単位で明示的に（`2026-09-23-tier-fixed-main-subagent-escalation.md`）。具体的なモデルは決めてから入れる。
- **止まっているときは予備に回さない。** 別モデルへの fallback は意味が変わるので置かない。`allowed_fails: 1` と `cooldown_time: 30` を明示する（単一デプロイは既定で cooldown されず毎回 5〜6 秒待つ、LiteLLM #40405）。
- **サーバーは `llama-server`（router mode）。** systemd の user サービス、`--api-key`、`--metrics`。`tailscale serve --tcp <port>` で一つだけ tailnet に出す。
- **tailnet**: Omarchy 機は同じ tailnet に参加する。ACL は `autogroup:member → autogroup:self` の全ポートなので追加の記述は不要。

## Alternatives considered

- **同じ tier に二台を並べて振り分け**: 異機種ローカル二台を同じ名前に並べた公開例はゼロ。deterministic の目的とも矛盾。却下。
- **Omarchy 機を主、Mac を予備**: よく止まる機械を主にすると #40405 をそのまま踏む。却下。
- **vLLM**: 動く実例はある（syv-ai/HyperQwen、24GB で一人 127 tok/s）。だが一人で使う速さは互角（#15180）、強みは多人数同時。複数モデルの切替（sleep mode）は公式が「開発者プレビュー、ユーザーに晒すな」、`--api-key` は一部のパスだけ、アイドル時も GPU メモリを解放しない（#15287 not planned）、この世代の GPU は FP8 対象外、GGUF は「highly experimental」。却下。
- **LM Studio の Linux 版**: Mac と操作感が揃うが、Linux の CUDA で GPU を検出できない不具合が open（#1051・#197）。却下。
- **Ollama**: 同時リクエストの既定が 1。却下。
- **SGLang**: 家庭用に作られていないと実践者が明言。却下。

## Consequences

- 持ち主の手作業（一度）: Omarchy 機を tailnet に参加させる（Omarchy 同梱の `omarchy-install-service-tailscale`、同じアカウントでログイン）。使いたいモデルを決める。
- 作業は Linux 対応計画の段階 3（家の LLM）に入る。段階 0〜2（flake、シェル、ハーネス）が先。
- Prometheus は Omarchy 機の LiteLLM の metrics ポートも集める（既存の方式のまま）。`llama-server --metrics` を集めるかは段階 3 で決める。
- 未確認: `llama-server` の router mode を同じ世代の GPU で常用した個人の報告、Quattro（Omarchy v4）での systemd user サービスの実例。

## Sources

- vLLM の動作実例（24GB で一人 127 tok/s）: https://github.com/syv-ai/HyperQwen
- vLLM がアイドル時も GPU メモリを解放しない（not planned）: https://github.com/vllm-project/vllm/issues/15287
- vLLM の複数モデル切替（sleep mode）は開発者プレビュー: https://docs.vllm.ai/en/latest/features/sleep_mode/
- LM Studio Linux 版が CUDA で GPU を検出できない不具合: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1051
- SGLang は家庭用に作られていないという実践者の評: https://markaicode.com/vs/sglang-vs-llamacpp/
- https://github.com/BerriAI/litellm/issues/40405
- https://github.com/ggml-org/llama.cpp/issues/2838
- https://huggingface.co/blog/ggml-org/model-management-in-llamacpp
- https://raw.githubusercontent.com/omacom/omarchy/quattro/bin/omarchy-install-service-tailscale
