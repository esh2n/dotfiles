# ハーネスの context window は 200K を予算に、1M は omp の拡張窓だけ

Status: superseded by 2026-09-27-context-budget-1m-85pct.md（予算を 200K から 1M へ。圧縮点は 170K から 850K になり、`/extended-context` は主経路でなくなった。`tiers.json` の一箇所で引き上げ、出典を `_context_source` に残す手順は引き継ぐ） — accepted — 持ち主の裁定（2026-09-24）。調査の結論（出典は本文末）を引いた推しに対して

rule: A harness's `contextWindow` is a budget, not the provider's limit: set it to 200,000 for the `main` and `complex` tiers (1M-class DeepSeek models) in every harness config jig generates (pi, DSH, omp), and give omp alone `maxContextWindow: 1000000` so `/extended-context on` can widen one session on purpose. Never set the budget to the provider's maximum; a compaction trigger proportional to a 1M window stops firing in practice. `deterministic`'s budget follows the context length LM Studio actually loads the model with, as `litellm/check.sh` reports it.

## Problem

`policy/tiers.json` の `contextWindow` は 9/20 に 1,000,000（DeepSeek の公称上限）で入り、9/24 に omp へも生成された。それまで omp は既定の 128,000 で動いていたが、作業には狭かった。値の根拠が「ベンダーの上限」しか無く、ハーネスがその上限を予算にしてよいかは調べていなかった。

## Decision

- `main` / `complex`: `contextWindow: 200000`（予算）、`maxContextWindow: 1000000`（プロバイダの窓）。
- omp: 両方を `models.yml` に出す。通常は 200K で圧縮が走り、長い作業は `/extended-context on` で 1M に広げる（omp の設計どおり）。
- pi / DSH: 拡張窓の仕組みが無いので 200K のみ（`maxContextWindow` は「表現できない項目」として dry-run に報告）。
- `deterministic`: `check.sh` が出す LM Studio の `loaded_context_length` に合わせる（今は 131,072、未照合）。
- 足りなくなったら引き上げる。引き上げるときは `tiers.json` の一箇所で、出典を `_context_source` に添える。

## Alternatives considered

- **1M をそのまま予算にする**: 推奨する情報源ゼロ。Anthropic は 1M モデルでも 967K で圧縮し、ゲートウェイ越しは 200K に後退（https://code.claude.com/docs/en/model-config ）。Codex は 960K 設定を約 258K に切り詰め NOT_PLANNED（https://github.com/openai/codex/issues/19185 ）。額面どおり置いた実例は事故: Cline #14329（1 タスク $49.63、cache hit 98% → 12%）、pi #9482（40 万トークン破壊）、DeepSeek 公式ハーネス #5800（6.7 億入力トークン/日）。却下。
- **256K**: 第三者計測で DeepSeek の MRCR が 0.82 を保つ上限、pi-ai カタログの既定（「推測値」と自称）。根拠が第三者と推測値なので、ベンダー（Anthropic）が置く 200K を採った。困ったときの引き上げ先の候補。
- **128K（omp 既定）**: 作業に狭い。

## Consequences

- omp の圧縮点が 200K − 予備に変わる。1M で作業したいセッションは `/extended-context on` を打つ（omp docs: "This changes OMP's local context budget, not the provider's server-side limit"）。
- pi / DSH は 200K で圧縮。1M を使う手段は無い（必要なら別件で omp と同じ二段を要求する）。
- 出典は `policy/tiers.json` の各 tier の `_context_source`。
- 前例なし: 200K 予算 + 拡張窓の運用で `complex` がどれだけ `/extended-context` を使うかの計測。
- 未確認: `deterministic` の実ロード値（次の `check.sh`）。

## Sources

- https://platform.claude.com/docs/en/build-with-claude/context-windows 、https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing 、https://github.com/anomalyco/opencode/issues/8140 、https://github.com/balcsida/pi-provider-litellm/issues/170
- https://code.claude.com/docs/en/model-config 、https://github.com/can1357/oh-my-pi/blob/main/docs/models.md 、https://api-docs.deepseek.com/quick_start/pricing
- https://github.com/cline/cline/issues/14329 、https://github.com/earendil-works/pi/issues/9482 、https://github.com/deepseek-ai/deepseek-harness/discussions/5800
