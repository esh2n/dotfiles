# 家のLLMの二台目: Omarchy機のllama-serverを用途別の名前で載せ、deterministicはMacに固定

Status: superseded by 2026-09-26-deterministic-on-the-gpu.md（deterministicの置き場所をOmarchy機へ移し、モデルを決めた。llama-serverのrouter mode・用途名・fallbackなし・allowed_failsとcooldownはそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-09-24）。サーバーの比較調査の後に決めた。`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`の「tailnetに出すモデルサーバーはMacのLM Studioだけ」を、この記録で置き換える（それ以外の部分、LiteLLMは各機械でループバックのみ・一台一つ・計測の集め方は変えない）

rule: The `deterministic` tier stays on the Mac's LM Studio alone and is never routed to another machine. The Omarchy desktop (a 24 GB GPU) serves additional local models with llama.cpp's `llama-server` in router mode, as a systemd user service with `--api-key`, exposed on the tailnet with one `tailscale serve` TCP port; every machine's LiteLLM lists those models under purpose names (e.g. Japanese prose, light 4-bit), chosen explicitly per session like any tier, with no fallback to another model and `allowed_fails: 1` + `cooldown_time: 30` so a powered-off desktop answers "unavailable" in about a second.

## Problem

家のLLMの裁定は、モデルを出す機械をMac一台（LM Studio）と決めていた。Omarchy機（GPU、VRAM 24GB）でも、用途の違うモデル（自然な日本語の文章を書くもの、軽い4bit量子化のもの）を動かし、Macからもスマホからも使う。その機械は止まっていることが多い。

## Decision

- **deterministicはMacに固定。** 再現性が目的のtierを二台に跨がせない。CUDAは一台でも出力が揺れ（llama.cpp #2838）、MetalとCUDAは計算の実装が違う。
- **Omarchy機のモデルは用途別の名前でLiteLLMに載せる。** harnessはtierの名前だけを知り、どのモデルかはLiteLLMが決める（`2026-09-23-model-routing-per-harness.md`の形のまま）。選ぶのはセッション単位で明示的に（`2026-09-23-tier-fixed-main-subagent-escalation.md`）。具体的なモデルは決めてから入れる。
- **止まっているときは予備に回さない。** 別モデルへのfallbackは意味が変わるので置かない。`allowed_fails: 1`と`cooldown_time: 30`を明示する（単一デプロイは既定でcooldownされず毎回5〜6秒待つ、LiteLLM #40405）。
- **サーバーは`llama-server`（router mode）。** systemdのuserサービス、`--api-key`、`--metrics`。`tailscale serve --tcp <port>`で一つだけtailnetに出す。
- **tailnet**: Omarchy機は同じtailnetに参加する。ACLは`autogroup:member → autogroup:self`の全ポートなので追加の記述は不要。

## Alternatives considered

- **同じtierに二台を並べて振り分け**: 異機種ローカル二台を同じ名前に並べた公開例はゼロ。deterministicの目的とも矛盾。却下。
- **Omarchy機を主、Macを予備**: よく止まる機械を主にすると #40405をそのまま踏む。却下。
- **vLLM**: 動く実例はある（syv-ai/HyperQwen、24GBで一人127 tok/s）。だが一人で使う速さは互角（#15180）、強みは多人数同時。複数モデルの切替（sleep mode）は公式が「開発者プレビュー、ユーザーに晒すな」、`--api-key`は一部のパスだけ、アイドル時もGPUメモリを解放しない（#15287 not planned）、この世代のGPUはFP8対象外、GGUFは「highly experimental」。却下。
- **LM StudioのLinux版**: Macと操作感が揃うが、LinuxのCUDAでGPUを検出できない不具合がopen（#1051・#197）。却下。
- **Ollama**: 同時リクエストの既定が1。却下。
- **SGLang**: 家庭用に作られていないと実践者が明言。却下。

## Consequences

- 持ち主の手作業（一度）: Omarchy機をtailnetに参加させる（Omarchy同梱の`omarchy-install-service-tailscale`、同じアカウントでログイン）。使いたいモデルを決める。
- 作業はLinux対応計画の段階3（家のLLM）に入る。段階0〜2（flake、シェル、ハーネス）が先。
- PrometheusはOmarchy機のLiteLLMのmetricsポートも集める（既存の方式のまま）。`llama-server --metrics`を集めるかは段階3で決める。
- 未確認: `llama-server`のrouter modeを同じ世代のGPUで常用した個人の報告、Quattro（Omarchy v4）でのsystemd userサービスの実例。

## Sources

- vLLMの動作実例（24GBで一人127 tok/s）: https://github.com/syv-ai/HyperQwen
- vLLMがアイドル時もGPUメモリを解放しない（not planned）: https://github.com/vllm-project/vllm/issues/15287
- vLLMの複数モデル切替（sleep mode）は開発者プレビュー: https://docs.vllm.ai/en/latest/features/sleep_mode/
- LM Studio Linux版がCUDAでGPUを検出できない不具合: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1051
- SGLangは家庭用に作られていないという実践者の評: https://markaicode.com/vs/sglang-vs-llamacpp/
- https://github.com/BerriAI/litellm/issues/40405
- https://github.com/ggml-org/llama.cpp/issues/2838
- https://huggingface.co/blog/ggml-org/model-management-in-llamacpp
- https://raw.githubusercontent.com/omacom/omarchy/quattro/bin/omarchy-install-service-tailscale
