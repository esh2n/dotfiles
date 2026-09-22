# 無人の繰り返し実行は各ハーネスの goal 機能で回し、jig はその制約だけを持つ

Status: accepted — 2026-09-22 ユーザー裁定「はい」

## Problem

エージェントを無人で繰り返し回す(新しい文脈で反復する、定期実行する、長時間自律で走らせる)ことを jig の責務として持つか。持つなら実行系を自前で作るか、ハーネスの機能に任せるか。回すときは必ず goal(完了条件)を指定する、という運用が前提。

## Decision

- 実行系は jig に作らない。回すときは各ハーネスの goal 機能を使う。Claude Code の `/goal`(別の小さなモデルが完了を判定、既定の上限なし)、Codex の `/goal`(トークン予算)、DSH の goal(256 ラウンド、完了は自己申告)、pi は拡張 pi-goal(`--tokens` の予算、完了は自己申告)、omp は本体の goal mode(判定方式は未確認)。
- jig は「goal で回すときの制約」をガードのルールとして持つ。無人のときは、テストのパスへの fs.write と fs.edit を forbid する。認証情報とデプロイ系のコマンドを forbid する。
- 無人で回してよいのは、成功の条件を回し始める前に機械が実行できる形で書けた仕事だけ(失敗するテスト、CI の合否、カバレッジや性能の数値、参照実装のある移植)。書けない仕事は人が見ている前で一段ずつ進める。

## Alternatives considered

- **自前の繰り返し実行系(bash の `while true`、launchd の予約)を持つ**: 最も星の多い実装(snarktank/ralph、21,838 星)は 2 月から更新がなく、同種の 494 リポジトリのうち 30 日以内に更新があるのは 6%。機能は各ハーネスの `/goal` に吸収された(Google の Kanat-Alexander「ループはハーネスが goal を持つまでの一時しのぎだった」)。約 210 人の読者調査の結論は「AI 基盤を作る人以外は深追いする利点は薄い」。却下。
- **完了をエージェント自身に判定させる**: 自己判定の記録は全部失敗(Ronacher の 35 時間・約 1,200 ドルで成果なし、6 時間の変換がスタブと決め打ちの true で埋まり煙テストは通った、「テストは壊れているが範囲外なので無視」で終了)。ImpossibleBench ではテストと矛盾する課題で GPT-5 が 54%、Opus 4.1 が約 50% の確率でテストを書き換え、試行回数を増やすと上がる。テストへの書き込みを禁止するとほぼ 0 になる。だから判定は外に出し、テストの書き換えはガードで止める。
- **間隔を決めた polling で定期実行する**: 何もしていないのに 30 秒ごとに 15 万トークン、頼んでいない毎時の確認で月の枠の 80% を消費、Codex の hook のループで 9 時間・3 億 4,000 万トークンで成果なし。Anthropic の文書は「定期実行は毎回全文脈を送る」。実際に続いているのは朝に読む PR を作る雑用だけ。却下。
- **一つのセッションを compact しながら長時間続ける**: 段階数と文脈長に応じた劣化が測られていて(arXiv 2509.09677、Context Rot)、最大級の暴走事故は単一セッションで起きている。既定にはしない。

## Consequences

- 止める仕組みは、調べた全実装に壊れた記録がある(Anthropic の ralph-loop plugin は上限が静かに無効になる、遮断器が正常な実行を殺す)。予算と回数の上限は必ず自分で書く。
- 「新しい文脈で回し直す」形と「一つのセッションを続ける」形を同じ課題で比べた実験はない。
- pi と omp は完了の判定が自己申告(pi)か未確認(omp)なので、ガードの制約がより重要になる。

## Sources

- `.tmp-research/loop-vendors-evidence.md`、`loop-practitioners-wild.md`
- Claude Code: https://code.claude.com/docs/en/goal 、https://code.claude.com/docs/en/scheduled-tasks 、https://code.claude.com/docs/en/routines
- ImpossibleBench: https://arxiv.org/abs/2510.20270
- 読者調査: https://newsletter.pragmaticengineer.com/p/what-is-loop-engineering
- Huntley: https://ghuntley.com/ralph/ 、Ronacher: https://lucumr.pocoo.org/2026/9/7/astra-why/
- polling の事故: https://github.com/anthropics/claude-code/issues/90443 、/issues/95305 、https://github.com/openai/codex/issues/34477
- pi-goal: https://github.com/Michaelliv/pi-goal
