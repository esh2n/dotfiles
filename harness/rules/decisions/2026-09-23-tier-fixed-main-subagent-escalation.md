# tier はセッション固定（main）、強いモデルは subagent で、`/tier` は人の選択

Status: accepted — 持ち主の裁定（2026-09-23 夜、「これでいいと思う」）。同日 omp に載せた「プロンプトごとにメインのモデルを切り替える」暫定実装と pi の既存ルーターを、調査記録の結論で置き換える

rule: A harness session runs on one LiteLLM tier for its whole life — `main` unless the owner picks `complex` or `deterministic` for that session with `/tier` (or `PI_TIER` / `OMP_TIER` at launch). Never switch the main session's model automatically, per prompt or otherwise; reach a stronger model by delegating to a subagent whose `model:` maps to `complex` (`agents/models.json`). The harness extension only holds the session on its tier — it puts the model back when omp's startup order or a `/model` pick lands on a direct provider — and never asks a judgment which tier a prompt needs.

## Problem

pi の `extensions/tier-router.ts`（9/19）と、同日 omp に移した `adapters/omp/src/tier.ts` は、プロンプトごとに jig の `/tier` 判定へ聞き、メインセッションのモデルを `main` / `complex` / `deterministic` に切り替えていた。「どこで切り替えるか」の業界調査を経ずに作られていた。

## Decision

- セッションのモデルは一つの tier に固定。既定 `main`。`/tier complex` `/tier deterministic` で持ち主がそのセッションの tier を変える（`/tier off` で拡張が手を出さない状態）。
- 自動切替は無し。`complex` は subagent（opus 相当の定義）が使う。
- 拡張が残すのは「保持」だけ: omp は起動順（保存した前回のモデル → プロバイダ既定 → 最初の候補）が `modelRoles` より先に効き、鍵なしの暗黙プロバイダが候補に入るので、セッション開始時と各プロンプト前に `proxy/<tier>` でなければ戻す。pi も同じ形（起動時のレースで別プロバイダの既定に落ちる報告 #8810）。
- jig の `/tier` 判定サービスは、この用途からは外れる（用途変更は別件）。

## Alternatives considered

- **プロンプトごとにメインを切り替える（従来）**: 主要ベンダーはどこも持たない（Claude Code: "The main session does not automatically switch models based on task difficulty"）。LiteLLM はプロバイダ側のプロンプトキャッシュが壊れるとして Session Affinity を推奨。同型の公開実装はキャッシュ読込 26.7k → 9.7k、283k のセッションを小さい窓へ送って圧縮暴発を実測し範囲を絞って後退（davila7 #972）。pi ではモデル切替時に前のモデルの thinking が本文に混ざる不具合を 4 名が独立報告（#6167）。却下。
- **ゲートウェイ側で振り分ける（LiteLLM の router / OpenRouter auto）**: LiteLLM の router は負荷分散・フェイルオーバーで難易度判定はスコープ外、RouteLLM はシングルターンのみ実証で 2 年停滞。却下。
- **静的な二モデル分業（Aider の architect / editor）**: 実測あり（固定ペア）。subagent 委譲はこれと同じ「固定」の形で、五ハーネスに配布済みの仕組み（`agents/models.json`）で済む。採用側。

## Consequences

- pi: `tier-router.ts` は `PI_TIER`（既定 `main`）で固定し、`before_agent_start` で保持のみ。判定呼び出しは削除。
- omp: `adapters/omp/src/tier.ts` は `OMP_TIER`（既定 `main`）で固定、`session_start` と `before_agent_start` で保持。判定呼び出しは削除。
- DSH: 自動振り分けが無いのは抜けではなくこの裁定どおり。tier は `settings.yaml` の `proxy` 設定で固定。
- `check.sh` の `:4100` の行は「判定サービス（skill 選択）」の意味に改める。
- 前例なし: 「subagent で上げる」運用で `complex` がどれだけ使われるかの測定（LiteLLM の `model` ラベルで見る）。

## Sources

- `rules/research/2026-09-23-tier-routing-switch-vs-subagent-vs-gateway.md`
- https://code.claude.com/docs/en/sub-agents 、https://docs.litellm.ai/docs/routing
- https://github.com/davila7/claude-code-templates/issues/972 、https://github.com/earendil-works/pi/issues/6167 、https://github.com/earendil-works/pi/issues/8810
