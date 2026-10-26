# ハーネスのcontext windowは200Kを予算に、1Mはompの拡張窓だけ

Status: superseded by 2026-09-27-context-budget-1m-85pct.md（予算を200Kから1Mへ。圧縮点は170Kから850Kになり、`/extended-context`は主経路でなくなった。`tiers.json`の一箇所で引き上げ、出典を`_context_source`に残す手順は引き継ぐ） — accepted — 持ち主の裁定（2026-09-24）。調査の結論（出典は本文末）を引いた推しに対して

rule: A harness's `contextWindow` is a budget, not the provider's limit: set it to 200,000 for the `main` and `complex` tiers (1M-class DeepSeek models) in every harness config jig generates (pi, DSH, omp), and give omp alone `maxContextWindow: 1000000` so `/extended-context on` can widen one session on purpose. Never set the budget to the provider's maximum; a compaction trigger proportional to a 1M window stops firing in practice. `deterministic`'s budget follows the context length LM Studio actually loads the model with, as `litellm/check.sh` reports it.

## Problem

`policy/tiers.json`の`contextWindow`は9/20に1,000,000（DeepSeekの公称上限）で入り、9/24にompへも生成された。それまでompは既定の128,000で動いていたが、作業には狭かった。値の根拠が「ベンダーの上限」しか無く、ハーネスがその上限を予算にしてよいかは調べていなかった。

## Decision

- `main` / `complex`: `contextWindow: 200000`（予算）、`maxContextWindow: 1000000`（プロバイダの窓）。
- omp: 両方を`models.yml`に出す。通常は200Kで圧縮が走り、長い作業は`/extended-context on`で1Mに広げる（ompの設計どおり）。
- pi / DSH: 拡張窓の仕組みが無いので200Kのみ（`maxContextWindow`は「表現できない項目」としてdry-runに報告）。
- `deterministic`: `check.sh`が出すLM Studioの`loaded_context_length`に合わせる（今は131,072、未照合）。
- 足りなくなったら引き上げる。引き上げるときは`tiers.json`の一箇所で、出典を`_context_source`に添える。

## Alternatives considered

- **1Mをそのまま予算にする**: 推奨する情報源ゼロ。Anthropicは1Mモデルでも967Kで圧縮し、ゲートウェイ越しは200Kに後退（https://code.claude.com/docs/en/model-config ）。Codexは960K設定を約258Kに切り詰めNOT_PLANNED（https://github.com/openai/codex/issues/19185 ）。額面どおり置いた実例は事故: Cline #14329（1タスク $49.63、cache hit 98% → 12%）、pi #9482（40万トークン破壊）、DeepSeek公式ハーネス #5800（6.7億入力トークン/日）。却下。
- **256K**: 第三者計測でDeepSeekのMRCRが0.82を保つ上限、pi-aiカタログの既定（「推測値」と自称）。根拠が第三者と推測値なので、ベンダー（Anthropic）が置く200Kを採った。困ったときの引き上げ先の候補。
- **128K（omp既定）**: 作業に狭い。

## Consequences

- ompの圧縮点が200K − 予備に変わる。1Mで作業したいセッションは`/extended-context on`を打つ（omp docs: "This changes OMP's local context budget, not the provider's server-side limit"）。
- pi / DSHは200Kで圧縮。1Mを使う手段は無い（必要なら別件でompと同じ二段を要求する）。
- 出典は`policy/tiers.json`の各tierの`_context_source`。
- 前例なし: 200K予算 + 拡張窓の運用で`complex`がどれだけ`/extended-context`を使うかの計測。
- 未確認: `deterministic`の実ロード値（次の`check.sh`）。

## Sources

- https://platform.claude.com/docs/en/build-with-claude/context-windows 、https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing 、https://github.com/anomalyco/opencode/issues/8140 、https://github.com/balcsida/pi-provider-litellm/issues/170
- https://code.claude.com/docs/en/model-config 、https://github.com/can1357/oh-my-pi/blob/main/docs/models.md 、https://api-docs.deepseek.com/quick_start/pricing
- https://github.com/cline/cline/issues/14329 、https://github.com/earendil-works/pi/issues/9482 、https://github.com/deepseek-ai/deepseek-harness/discussions/5800
