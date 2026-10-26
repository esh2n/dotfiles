# モデルの載せ降ろしと一覧は、各機械のLiteLLMを入口にする

Status: accepted — 持ち主の裁定（2026-09-30）

rule: Reach every model server's own load, unload and list through the machine's own LiteLLM, as pass-through routes `/model-servers/<server>/models[/load|/unload]` that require the proxy key; `dotctl llm models|load|unload` is the one caller, the same on every machine. Relay only the model-list paths, never a server's chat endpoints, so no request bypasses LiteLLM's metering. What LiteLLM cannot do — starting and stopping a process to switch a GPU's use — is a separate small endpoint on that machine, reached through the same LiteLLM.
scope: repo

## Problem

MacのLM StudioとOmarchyのllama-serverの、今何が載っているかを見る、載せる、降ろす、を同じ方法でしたい。前の案は操作口をOmarchyだけに作り、Macのモデルには同じ操作が届かなかったため却下された。両方を束ねる既製品に今の構成に合うものは無い（`research/2026-09-30-home-model-fleet-control.md`: GPUStackはv2でmacOSを打ち切り、exoはLinuxでGPUを使えず、LocalAIはエンジンを置き換える前提）。一方、各エンジンは自前の口を持つ（llama-serverのrouter: `GET /models`・`POST /models/load|unload`、LM Studio REST v1: `/api/v1/models`・`/load`・`/unload`）。

## Decision

1. 各機械のLiteLLMの`general_settings.pass_through_endpoints`に、`/model-servers/linux/models`と`/model-servers/mac/models`を置く（`include_subpath`、`auth: true`、`timeout: 300`）。中継先は`litellm-up.sh`が各エンジンの一覧のURLとして渡す。
2. 中継するのはモデル一覧の配下だけ。チャットの口は中継しない。
3. 呼ぶのは`dotctl llm models|load|unload`だけ。二つのエンジンの形の違い（LM Studioの降ろすは`instance_id`）はdotctlの一か所で吸収する。
4. LiteLLMは今までどおり各機械のループバックだけで待つ（`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`）。スマホのページはMacの上でLiteLLMを呼ぶ。
5. GPUの使い道の切り替え（llama-serverを止め、生成用の土台を起動する）はLiteLLMではできない。その機械の小さな口として別に作り、同じLiteLLMから中継する。

## Alternatives considered

- **各機械にdotctlのHTTPの口を置き、コマンドとページがそれを呼ぶ**: 前の案。載せ降ろしは各エンジンの口がすでにあり、口をもう一つ増やすことになる。LiteLLMは認証・記録・両機械への経路をすでに持つ。
- **llama-swapを両方に置く**: 依頼が来ると自動で入れ替えるため、生成の途中にQwenへの依頼が来ると生成が止まる。MacのLM Studioを置き換えることにもなる。
- **束ねる既製品（GPUStack、exo、LocalAI、Olla）**: 上のProblemのとおり、どれも合わない。Ollaは一覧だけで載せ降ろしが無い。

## Consequences

- LiteLLMの鍵を持つ者は、モデルを載せ降ろしできる。今その鍵を持つのは、持ち主のハーネスとdotctlだけ。
- LiteLLMを管理用の操作の入口に使う前例は、調べていない。使うのはベンダーの公式機能（pass-throughと、その認証）だけ。
- 中継先の機械が止まっていると、一覧はその機械だけ失敗として出る。もう一方は読める。
