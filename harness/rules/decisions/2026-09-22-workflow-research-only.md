# 複数エージェントのworkflowは読むだけの調査系に限り、自前の実行系は持たない

Status: superseded by 2026-09-22-subagents-and-workflows-by-scale.md — 「ハーネス横断は考えない」と「用途は読むだけ」を上書き。実行系を持たない点と書く並列を避ける点は引き継ぐ（2026-09-22）

## Problem

複数のエージェントを段階に分けて並列に走らせ、結果を検証し、予算で止め、途中から再開するworkflowを、jigの責務として持つか。持つなら何に使い、実行系を自前で持つか。「多角レビューや実装の並列化に価値がある」という前提を捨てて、業界水準に照らして決める必要があった。

## Decision

- workflowとして残すのは、ファイルを読んで指摘や要約を返すだけの調査系(review、research、code-study、stocktake)。幅(同時数)と深さ(部下が部下を呼ばない)の上限を固定する。
- 中に「同じ級のモデルが指摘をもう一度疑う」検証フェーズは入れない。検証はテストの実行か、明確に強いモデルの判定に限る。
- 実装系(implement、acceptance)と、同一課題をN回解いてテストで選ぶ形(deliberate)は捨てる。
- 自前の実行系は持たない。調査系のスクリプトはClaude CodeのWorkflow toolのスクリプトとして書く。ハーネス横断のworkflowは今は考えない。

## Alternatives considered

- **司令塔と役割分担の部下で実装を並列化する**: コーディングの統制比較(GPT-5・Gemini・Claudeの三系列、4構成)で全構成が単体より悪く(SWE-bench Verified −2.1〜−14.9%、Terminal-Bench司令塔 −19.2%)、トークンは1.6〜6.2倍。SWE-bench上位20の13が単体・一発。実践者17人中、司令塔型を日常にしているのは作って売る側の3人。試して戻った記録が二つ(Ronacher 35時間・約1,200ドルで「価値なし」、Beck「調整の問題になった」)。却下。
- **同級モデルによる検証フェーズ**: 効果を測った資料が一つもなく、隣接研究(自己修正1.05倍、議論は多数決以上の効果なし)は効果ゼロを予測。多エージェント失敗の24.5% は検証器自身。却下。
- **N回解いてテストで選別(deliberate)**: 唯一コーディングで測定された利得がある形(TRAE 70.6→78.8%)だが、コストが6〜30倍でテストが揃った課題にしか使えない。「あまり使わなそう」で却下。
- **自前の実行系を維持する**: Claude Codeが同じ形(`agent`/`parallel`/`pipeline`/`phase`、上限、再開)をネイティブで持ち、公開リポジトリの`.claude/workflows`は30件中12件が一度きり、Anthropicは4か月で既定を3回下げた。旧世代の実行系(AutoGenは保守モード、MetaGPTは休眠)は生き残っていない。却下。

## Consequences

- 日常の並列はworktreeごとの独立セッションを人間が采配する形になる(実践の主流)。
- 読むだけの並列調査でも主文脈への利得はあるがコストは2〜7倍。上限は必須。
- 今日の調査自体(部下4本、約70万トークン)がこの倍率の実例。

## Sources

- `rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`
- 統制比較: https://arxiv.org/html/2512.08296 、失敗の分類: https://arxiv.org/abs/2503.13657
- Claude Code costs: https://code.claude.com/docs/en/costs 、workflows: https://code.claude.com/docs/en/workflows
- Ronacher: https://lucumr.pocoo.org/2026/9/7/astra-why/ 、Beck: https://newsletter.kentbeck.com/p/genie-lessons-nobody-wants-agents
