# 複数エージェントの workflow は読むだけの調査系に限り、自前の実行系は持たない

Status: accepted — 2026-09-22 ユーザー裁定「調査系だけかな」

## Problem

複数のエージェントを段階に分けて並列に走らせ、結果を検証し、予算で止め、途中から再開する workflow を、jig の責務として持つか。持つなら何に使い、実行系を自前で持つか。「多角レビューや実装の並列化に価値がある」という前提を捨てて、業界水準に照らして決める必要があった。

## Decision

- workflow として残すのは、ファイルを読んで指摘や要約を返すだけの調査系(review、research、code-study、stocktake)。幅(同時数)と深さ(部下が部下を呼ばない)の上限を固定する。
- 中に「同じ級のモデルが指摘をもう一度疑う」検証フェーズは入れない。検証はテストの実行か、明確に強いモデルの判定に限る。
- 実装系(implement、acceptance)と、同一課題を N 回解いてテストで選ぶ形(deliberate)は捨てる。
- 自前の実行系は持たない。調査系のスクリプトは Claude Code の Workflow tool のスクリプトとして書く。ハーネス横断の workflow は今は考えない。

## Alternatives considered

- **司令塔と役割分担の部下で実装を並列化する**: コーディングの統制比較(GPT-5・Gemini・Claude の三系列、4 構成)で全構成が単体より悪く(SWE-bench Verified −2.1〜−14.9%、Terminal-Bench 司令塔 −19.2%)、トークンは 1.6〜6.2 倍。SWE-bench 上位 20 の 13 が単体・一発。実践者 17 人中、司令塔型を日常にしているのは作って売る側の 3 人。試して戻った記録が二つ(Ronacher 35 時間・約 1,200 ドルで「価値なし」、Beck「調整の問題になった」)。却下。
- **同級モデルによる検証フェーズ**: 効果を測った資料が一つもなく、隣接研究(自己修正 1.05 倍、議論は多数決以上の効果なし)は効果ゼロを予測。多エージェント失敗の 24.5% は検証器自身。却下。
- **N 回解いてテストで選別(deliberate)**: 唯一コーディングで測定された利得がある形(TRAE 70.6→78.8%)だが、コストが 6〜30 倍でテストが揃った課題にしか使えない。「あまり使わなそう」で却下。
- **自前の実行系を維持する**: Claude Code が同じ形(`agent`/`parallel`/`pipeline`/`phase`、上限、再開)をネイティブで持ち、公開リポジトリの `.claude/workflows` は 30 件中 12 件が一度きり、Anthropic は 4 か月で既定を 3 回下げた。旧世代の実行系(AutoGen は保守モード、MetaGPT は休眠)は生き残っていない。却下。

## Consequences

- 日常の並列は worktree ごとの独立セッションを人間が采配する形になる(実践の主流)。
- 読むだけの並列調査でも主文脈への利得はあるがコストは 2〜7 倍。上限は必須。
- 今日の調査自体(部下 4 本、約 70 万トークン)がこの倍率の実例。

## Sources

- `.tmp-research/orchestration-evidence.md`、`orchestration-vendors.md`、`orchestration-practitioners.md`、`orchestration-in-the-wild.md`
- 統制比較: https://arxiv.org/html/2512.08296 、失敗の分類: https://arxiv.org/abs/2503.13657
- Claude Code costs: https://code.claude.com/docs/en/costs 、workflows: https://code.claude.com/docs/en/workflows
- Ronacher: https://lucumr.pocoo.org/2026/9/7/astra-why/ 、Beck: https://newsletter.kentbeck.com/p/genie-lessons-nobody-wants-agents
