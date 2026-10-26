# 厚いレビューの2つ目は、主と同格以上のモデルにだけ頼む

Status: accepted — 持ち主の裁定（2026-10-19）。2026-10-19-review-redesign.mdの「2つ目は違うモデルの系統で」の部分を、この記録で具体化する。そのうちDecision 2の「omp・pi・DSHからは系列の違うtierを使い」は、この記録が置き換える（格下の別系列は使わず、Codexに1回委ねる）

rule: In a heavy review, the second independent review runs on a model at least as strong as the session's own, never a weaker one: from Claude Code, omp, pi and DSH, one `codex exec` delegation to Codex's strongest model (the `complex` row of the `codex` table in `agents/models.json`, high effort); from Codex, a fresh session of the same model, because Claude is reachable only through `claude -p`, which is not used. When Codex's usage limit is near or the delegation fails, skip the second review and say so in the report; never fall back to a weaker model.

## Problem

変更が大きいときや危ない経路に触れるときに、独立した2つ目のレビューを足すと決めた（2026-10-19-review-redesign.md）。2つ目を頼むモデルの選び方が決まっていなかった。主のモデルはハーネスごとに違う。Claude CodeはClaude、CodexはOpenAIの最上位のモデル、omp・pi・DSHはLiteLLMのtier（LiteLLMがまとめて呼ぶモデルの組）で、mainとcomplexのtierはどちらもDeepSeekである。2つ目を主より格下のモデルに頼んで、意味があるかが問題だった。

## Decision

2つ目は、主と同格か、それより強いモデルにだけ頼む。

- Claude Code、omp、pi、DSHからは、Codexの最上位のモデル（`agents/models.json`の`codex`表の`complex`行、effort（考える量の設定）はhigh）に、`codex exec`で1回の委譲として頼む。読み取り専用で、セッションを残さない。
- Codexからは、同じモデルを新しいセッション（文脈を共有しないサブエージェント）で立ち上げ、独立に見させる。報告にそのことを書く。
- Codexの使用量の上限が近いときや委譲が失敗したときは、2つ目を飛ばし、飛ばした理由を報告に書く。格下のモデルには落とさない。
- セキュリティの指摘は、外部の提供元に渡さない（2026-10-19-review-redesign.mdのとおり）。

## Alternatives considered

- **格下でも違う系統なら使う（omp・pi・DSHの別のtier、CodexからDeepSeek）**。LiveCodeBenchの116問で、CodexがClaudeの下書きを見ると正答率が91.4% から82.8% に下がった（直した3件、壊した13件）。逆向きのClaudeがCodexの下書きを見ると71.6% から89.7% に上がった。著者は、差の原因はもとの実力差である可能性が高いとしている。埋め込んだ誤り150件の研究でも、軽量の別系統（F1 24.0%）は同じモデルの新しいセッション（28.6%）に及ばなかった。却下。
- **LiteLLMのcomplexのtierに、DeepSeek以外の最上位のモデルを足す**。どのハーネスからもLiteLLM経由で呼べるが、モデルの一覧と鍵と費用の変更が要る。Codexへの委譲で同じことができる今は要らない。Codexで作業する比重が増えたら見直す。
- **違う系統を使わず、同じモデルで観点を変えて2回見る**。同格の最上位どうしなら、違う系統の方が見つける範囲が広い（同じモデル1回と別系統1回の組み合わせがF1 56.7%、同じモデル2回が42.7%）。Codexから以外では採らない。
- **Codexから`claude -p`でClaudeを呼ぶ**。Claudeを呼ぶ唯一の手段だが、使わないと決めている。却下。

## Consequences

- Codexで作業したときの2つ目は、同じモデルになる。違う系統より見つける範囲は狭い。
- 2つ目を足すと、費用と時間が増える（上の116問の研究では1問あたり費用72% 増、時間1.6倍）。厚いレビューは、変更が大きいか危ない経路に触れるときだけに限る。
- Claude CodeからCodexを呼ぶ公式のプラグインは、自身のREADMEで「使用量の上限を早く使い切ることがある」と書いている。上限が近いときは2つ目を飛ばす。
- 2人のレビュアーが一致しても、それは正しさの証拠にならない（10体のレビュアーが存在しない脆弱性を一致して認めた例がある）。一致した指摘もreview-verifierの確認を通す。

## Sources

- 違う系統のレビューの非対称を測った研究（https://arxiv.org/abs/2607.21656）
- 同じモデルの新しいセッションと別系統を比べた研究（https://arxiv.org/abs/2610.01471）
- レビュアーの一致が誤った例（https://arxiv.org/abs/2604.19049）
- 同格の最上位どうしの利得を測ったベンダーの記事（https://greptile.com/blog/model-inversion）
- 系統をまたいで誤りが似ることを示したKimほかの研究、ICML 2025（https://arxiv.org/abs/2506.07962）
- Claude CodeからCodexを呼ぶ公式のプラグイン（https://github.com/openai/codex-plugin-cc）
