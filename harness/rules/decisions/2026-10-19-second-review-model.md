# 厚いレビューの 2 つ目は、主と同格以上のモデルにだけ頼む

Status: accepted — 持ち主の裁定（2026-10-19）。2026-10-19-review-redesign.md の「2 つ目は違うモデルの系統で」の部分を、この記録で具体化する。そのうち Decision 2 の「omp・pi・DSH からは系列の違う tier を使い」は、この記録が置き換える（格下の別系列は使わず、Codex に 1 回委ねる）

rule: In a heavy review, the second independent review runs on a model at least as strong as the session's own, never a weaker one: from Claude Code, omp, pi and DSH, one `codex exec` delegation to Codex's strongest model (the `complex` row of the `codex` table in `agents/models.json`, high effort); from Codex, a fresh session of the same model, because Claude is reachable only through `claude -p`, which is not used. When Codex's usage limit is near or the delegation fails, skip the second review and say so in the report; never fall back to a weaker model.

## Problem

変更が大きいときや危ない経路に触れるときに、独立した 2 つ目のレビューを足すと決めた（2026-10-19-review-redesign.md）。2 つ目を頼むモデルの選び方が決まっていなかった。主のモデルはハーネスごとに違う。Claude Code は Claude、Codex は OpenAI の最上位のモデル、omp・pi・DSH は LiteLLM の tier（LiteLLM がまとめて呼ぶモデルの組）で、main と complex の tier はどちらも DeepSeek である。2 つ目を主より格下のモデルに頼んで、意味があるかが問題だった。

## Decision

2 つ目は、主と同格か、それより強いモデルにだけ頼む。

- Claude Code、omp、pi、DSH からは、Codex の最上位のモデル（`agents/models.json` の `codex` 表の `complex` 行、effort（考える量の設定）は high）に、`codex exec` で 1 回の委譲として頼む。読み取り専用で、セッションを残さない。
- Codex からは、同じモデルを新しいセッション（文脈を共有しないサブエージェント）で立ち上げ、独立に見させる。報告にそのことを書く。
- Codex の使用量の上限が近いときや委譲が失敗したときは、2 つ目を飛ばし、飛ばした理由を報告に書く。格下のモデルには落とさない。
- セキュリティの指摘は、外部の提供元に渡さない（2026-10-19-review-redesign.md のとおり）。

## Alternatives considered

- **格下でも違う系統なら使う（omp・pi・DSH の別の tier、Codex から DeepSeek）**。LiveCodeBench の 116 問で、Codex が Claude の下書きを見ると正答率が 91.4% から 82.8% に下がった（直した 3 件、壊した 13 件）。逆向きの Claude が Codex の下書きを見ると 71.6% から 89.7% に上がった。著者は、差の原因はもとの実力差である可能性が高いとしている。埋め込んだ誤り 150 件の研究でも、軽量の別系統（F1 24.0%）は同じモデルの新しいセッション（28.6%）に及ばなかった。却下。
- **LiteLLM の complex の tier に、DeepSeek 以外の最上位のモデルを足す**。どのハーネスからも LiteLLM 経由で呼べるが、モデルの一覧と鍵と費用の変更が要る。Codex への委譲で同じことができる今は要らない。Codex で作業する比重が増えたら見直す。
- **違う系統を使わず、同じモデルで観点を変えて 2 回見る**。同格の最上位どうしなら、違う系統の方が見つける範囲が広い（同じモデル 1 回と別系統 1 回の組み合わせが F1 56.7%、同じモデル 2 回が 42.7%）。Codex から以外では採らない。
- **Codex から `claude -p` で Claude を呼ぶ**。Claude を呼ぶ唯一の手段だが、使わないと決めている。却下。

## Consequences

- Codex で作業したときの 2 つ目は、同じモデルになる。違う系統より見つける範囲は狭い。
- 2 つ目を足すと、費用と時間が増える（上の 116 問の研究では 1 問あたり費用 72% 増、時間 1.6 倍）。厚いレビューは、変更が大きいか危ない経路に触れるときだけに限る。
- Claude Code から Codex を呼ぶ公式のプラグインは、自身の README で「使用量の上限を早く使い切ることがある」と書いている。上限が近いときは 2 つ目を飛ばす。
- 2 人のレビュアーが一致しても、それは正しさの証拠にならない（10 体のレビュアーが存在しない脆弱性を一致して認めた例がある）。一致した指摘も review-verifier の確認を通す。

## Sources

- 違う系統のレビューの非対称を測った研究（https://arxiv.org/abs/2607.21656）
- 同じモデルの新しいセッションと別系統を比べた研究（https://arxiv.org/abs/2610.01471）
- レビュアーの一致が誤った例（https://arxiv.org/abs/2604.19049）
- 同格の最上位どうしの利得を測ったベンダーの記事（https://greptile.com/blog/model-inversion）
- 系統をまたいで誤りが似ることを示した Kim ほかの研究、ICML 2025（https://arxiv.org/abs/2506.07962）
- Claude Code から Codex を呼ぶ公式のプラグイン（https://github.com/openai/codex-plugin-cc）
