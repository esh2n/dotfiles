# 記憶はリポジトリ内のファイルだけに置き、外部の記憶基盤と観察の自動収集は入れない

Status: accepted — 外部の記憶基盤に利得の測定がなく害の測定が揃い、手元でも読まれていなかった（2026-09-22）

## Problem

セッションをまたいで、修正されたことと過去の作業を次のセッションに引き継ぎたい。方法は「エージェント自身がファイルに書く」流派と「会話から事実を抽出して外部の保存基盤に入れ、検索で引く」流派に分かれる。五つのハーネスのうち記憶の機能を持つのは Claude Code(auto memory、Claude 専用で機械ローカル)だけで、横断の記憶をどうするかも決める必要があった。

## Decision

- 修正(次回同じ間違いをさせないこと)は、強制される場所に直接書く。行動の制約は AGENTS.md 系のルール、機械で検査できるものはガードのルールか lint。修正を記録して要約する仕組みは持たない。
- 過去の作業の記録は、リポジトリ内の決定メモと計画ファイルで持つ。
- 外部の記憶基盤(Mem0、Letta、Zep など)と、ツール呼び出しを自動で要約して貯める plugin(claude-mem)は入れない。claude-mem は無効にした。
- Claude Code の auto memory は Claude だけの補助として残し、ときどき整理する。横断の記憶基盤は作らない。

## Alternatives considered

- **観察を自動で貯めて検索する plugin(claude-mem)**: 4.7 か月で 10,681 件・1.3GB を書き、読み返しは 13 回。要約のために Sonnet を約 12,900 回サブスクリプションの枠で呼んだ。公開の報告では記憶層だけで支出に 63.9% 上乗せ、観察器の 10 倍のトークン増幅、検索の再現率が未測定で語句一致のバグ。数字付きの称賛はゼロ。却下。
- **外部の記憶基盤(Mem0、Zep、Cognee、Supermemory)**: 評価はすべて会話の質問応答のベンチマークで、コーディングを測ったものがない。Mem0 の数字には Zep の反論と再現失敗の issue があり、本番監査で抽出の 97.8% がゴミ。Letta(この流派の代表)は自社計測で「単純なファイル操作のエージェント 74.0% 対 Mem0 68.5%」を出し、新製品を git 管理のファイルに変えた。Cognition は Devin の Knowledge を非推奨にして Skills へ移行中。却下。
- **修正を記録して LLM に要約させる**: ACE(arXiv 2510.04618)が「要約のたびに情報が削れる」と指摘し、同系統の公開実装は数十星で archived が目立つ。却下。
- **横断の記憶基盤を作る**: 五つのハーネスは AGENTS.md 系のファイルを共通に読めるので、それに勝てるという証拠がない。実践者 9 人のうち外部の保存基盤を使う人はゼロ。却下。

## Consequences

- コーディングで「記憶あり/なし」を比べた統制実験はどこにもない。この判断は、害の測定値が三つの無関係な系で同じ形で出ていること(静かに古くなる、静かに切れる、静かにトークンが増える、プロジェクト間で漏れる)と、手元の使用回数に基づく。
- Claude Code の auto memory にも測定された問題がある(無効化しても 11.3k〜16.2k トークンの前置き、MEMORY.md があふれると新しい修正から落ちる)。25KB の上限があるので整理で対処する。

## Sources

- `.tmp-research/memory-tools-evaluation.md`
- Anthropic auto memory: https://code.claude.com/docs/en/memory
- Letta の計測: https://www.letta.com/blog/benchmarking-ai-agent-memory 、Zep の反論: https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
- Mem0 の監査: https://github.com/mem0ai/mem0/issues/4573 、HaluMem: https://arxiv.org/abs/2511.03506 、ACE: https://arxiv.org/abs/2510.04618
- claude-mem のコスト: https://github.com/thedotmack/claude-mem/issues/3848 、検索バグ: https://github.com/thedotmack/claude-mem/issues/4138
