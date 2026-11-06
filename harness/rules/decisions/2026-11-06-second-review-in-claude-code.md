# Claude Codeの厚いレビューの2つ目は、Claude Codeの中で行う

Status: accepted — 持ち主の裁定（2026-11-06）。2026-10-19-second-review-model.mdを置き換える。omp、pi、DSH、Codexからの決まりは、そのまま引き継ぐ

rule: In a heavy review, the second independent review runs on a model at least as strong as the session's own, never a weaker one: from Claude Code, a fresh subagent on the session's model through the Agent tool, given only the diff and the intent, never `claude -p`; from omp, pi and DSH, one `codex exec` delegation to Codex's strongest model (the `complex` row of the `codex` table in `agents/models.json`, high effort); from Codex, a fresh session of the same model. From omp, pi or DSH, when Codex's usage limit is near or the delegation fails, skip the second review and say so in the report; never fall back to a weaker model.

## Problem

2026-10-19-second-review-model.mdは、Claude Codeからの2つ目をCodexの最上位のモデルへの委譲と決めた。実際には、ChatGPTのアカウントの`codex exec`が`gpt-6-sol`を拒否し、2つ目がそのつど飛ばされた。飛ばしてよいという決まりがあるので、厚いレビューが1回のレビューのまま完了扱いになっていた。

## Decision

Claude Codeからの2つ目は、Claude Codeの中で、文脈を引き継がない新しいサブエージェントに行わせる。

- モデルはセッションと同じものにする。effortはhighにする。
- 渡すのは差分と意図と参照する資料だけにする。1つ目の指摘や、主の結論は渡さない。
- `claude -p`は使わない。Agentツールで起動する。
- 2つ目の指摘も、他の指摘と同じくreview-verifierの確認を通す。
- omp、pi、DSH、Codexからの決まりは変えない。

## Alternatives considered

- **Codexへの委譲を残し、飛ばすことを続ける**。モデルの拒否が解決するまで、Claude Codeの厚いレビューに2つ目が付かない。却下。
- **`agents/models.json`のCodexのモデルをアカウントで使えるものへ下げる**。主より格下のモデルに頼むことになり、2026-10-19-second-review-model.mdが退けた形に戻る。却下。

## Consequences

- 系統が同じなので、見つける範囲は違う系統の組み合わせより狭い。同じモデル2回がF1 42.7%、同じモデル1回と別系統1回が56.7%という測定がある（https://arxiv.org/abs/2610.01471 、2026-10-19-second-review-model.mdの記録）。
- Claude Codeの厚いレビューでは、2つ目を飛ばす理由がなくなる。
