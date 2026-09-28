# ハーネスの予算はプロバイダの 1M にし、圧縮は 85%（850K）で発火させる

Status: accepted — 持ち主の裁定（2026-09-27。案 B、圧縮点 85%）。調査の結論（`rules/knowledge/context-compaction-practice.md`）を引いた推しに対して

rule: Set a harness's `contextWindow` for the `main` and `complex` tiers to the provider's own 1,000,000 window, not a smaller budget, and let compaction fire at 85% of it — omp needs no setting (its 15% reserve gives 850,000) and pi sets `reserveTokens: 150000` for the same 850,000 point. Never pin `compaction.thresholdTokens` or any fixed threshold below 85%: a fixed number defeats `/extended-context on`, and re-summarizing every ten minutes loses far more than a long window costs.

## Problem

9/24 に `main` / `complex` の予算を 200,000 とした（`2026-09-24-context-window-budget-200k-extended-1m.md`）。その運用で、実作業 35 分のあいだに圧縮が 4 回走った。omp の圧縮ログは `tokensBefore` が 170,496 / 175,794 / 170,993 / 173,809、`method` はすべて `handoff` で、しきい値 170,000 の直後に当たっている。圧縮は安くない。注入した制約のうち平均 ~17% しか残らないという計測がある（arXiv 2608.11242, 2026-07-31）。200K 予算は「窓を小さく保つ」代わりに「頻繁に要約し直す」を買っており、その要約自体が制約を落とす。

## Decision

- `main` / `complex` の `contextWindow` を 1,000,000（プロバイダの窓そのもの）にする。予算と窓を分けない。
- 圧縮点は 850,000（85%）。omp は自前の式（`window − max(15%, 16384)`）でちょうど 85% を出すので `compaction.thresholdTokens` は設定しない。omp の実装は正の `thresholdTokens` を割合より優先し `[1, window−1]` に丸めるため、固定値は `/extended-context on` を無効化する。
- pi は発火点が `window − reserveTokens` なので `reserveTokens: 150000` を置く（1,000,000 − 150,000 = 850,000）。既定の 16,384 では 983,616（98.4%）になる。
- dsh は窓を表現できない（`jig/src/domain/tiers/write-dsh.ts` が落とす）。litellm の `config.yaml` は窓を持たない。どちらも変更なし。
- 値の引き上げ先は `policy/tiers.json` の一箇所、出典は各 tier の `_context_source` という 9/24 の手順を引き継ぐ。

## Alternatives considered

- **9/24 のまま（200K 予算 + omp の `/extended-context on`）**: 却下。痛みは「窓が狭いこと」ではなく「圧縮が頻繁で品質が低いこと」だと実測で分かった。4 回の圧縮はいずれも通常の 200K 運用で起きた。拡張窓は打ち忘れるし、打っても次の圧縮は同じ要約を通る。
- **1M + 固定しきい値 `thresholdTokens: 850000`**: 却下。omp の既定式が既に 85% を出すので利点が無く、固定値は `/extended-context on` と将来の窓変更を塞ぐ。
- **1M + 98.4% 発火（pi の既定 16,384 のまま）**: 公表されている 1M 運用（Nick Nisi の pi: 1,050,000 − 16,384 = 1,033,616）と同型だが、窓の端まで詰める理由が無い。85% は要約の余地と入力の余白を残す。
- **400K 前後（実測と実践者の収束帯）**: 圧縮頻度は減るが、この作業量では依然として数セッションで発火し、第一の目的（35 分 4 回を消す）に届かない。
- **1M を額面で置いた事故を根拠に却下し続ける**: 9/24 の却下理由（Anthropic の 967K 圧縮とゲートウェイ越し 200K、Codex の 960K→258K クランプ、Cline #14329 の $49.63 事故、pi #9482、DeepSeek #5800）は、いずれも「発火点を明示せず高い値を置いた」事故か、上流が黙ってクランプした話。1M を選んだ実践者は必ず発火点を併記している（Nisi 98.4%、Jellydn 794,000 = 75.6%）。こちらも 85% を明示するので同じ失敗形ではない。ただし上流クランプの可能性自体は消えていない（Consequences）。
- **1,050,000（Nisi の値）**: 却下。プロバイダの窓を超える要求になる。

## Consequences

- omp の圧縮点は 850,000。`/extended-context on` を打つ理由は実質無くなる（予算 = 窓）が、設定は残す。
- pi の発火点は 850,000。`reserveTokens` はしきい値だけでなく要約の出力予算も兼ねる（pi docs）ので、150,000 は要約に最大 ~12 万トークン許すことになる。omp 側も 1M 窓では同種の余裕が生まれ、ソースは「モデルは圧縮せず写す」と注記している。85% 発火で回数が激減するので許容する、というのがこの裁定の賭け。
- 上流が値を黙ってクランプする可能性は残る（Codex の 960K→258K が前例）。`models.yml` はローカル設定なので、クランプが起きるならプロバイダ側で起きる。兆候は omp の窓表示で見る。
- 未確認: DeepSeek が 1M 入力で割増を取るか（料金表に段の記述は無い）。~256K を超える帯は第三者計測の MRCR が落ちる領域なので、長いセッションの後半品質は下がりうる。
- `deterministic`（65,536）と dsh は変更なし。

## Sources

- `harness/rules/knowledge/context-compaction-practice.md`（実践者の設定値: Nisi 1,050,000、Jellydn 1,050,000 + 794,000、Silverlock 200,000；arXiv 2608.11242 の ~17%、arXiv 2607.17937v2 の 299,140 文字で 8/10 → 3/10、arXiv 2608.00101 の実運用分布；omp の式と pi の `reserveTokens`）
- omp 実装: `packages/agent/src/compaction/compaction.ts`、`settings-schema.ts`（`extendedContext` の既定は false）
- pi docs: `docs/compaction.md`
- https://api-docs.deepseek.com/quick_start/pricing 、https://github.com/openai/codex/issues/19185 、https://github.com/cline/cline/issues/14329
