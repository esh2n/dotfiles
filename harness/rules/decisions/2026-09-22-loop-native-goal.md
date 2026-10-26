# 無人の繰り返し実行は各ハーネスのgoal機能で回し、jigはその制約だけを持つ

Status: superseded — 2026-10-19-unattended-runs-native-goal-and-loop.mdが置き換える（goalに限らず各ハーネスのloopと定期実行も使う。自前の実行系を作らないことと無人の間の制約は引き継ぐ）。もとの裁定は2026-09-22

rule: Never build a custom loop/execution engine; drive unattended repetition through each harness's native goal feature (Claude Code /goal, Codex /goal, DSH goal, pi-goal, omp goal mode). During any unattended goal run, forbid fs.write/fs.edit to test paths and forbid credential and deploy commands via guard rules, and only run tasks whose success condition is machine-checkable before starting.

## Problem

エージェントを無人で繰り返し回す(新しい文脈で反復する、定期実行する、長時間自律で走らせる)ことをjigの責務として持つか。持つなら実行系を自前で作るか、ハーネスの機能に任せるか。回すときは必ずgoal(完了条件)を指定する、という運用が前提。

## Decision

- 実行系はjigに作らない。回すときは各ハーネスのgoal機能を使う。Claude Codeの`/goal`(別の小さなモデルが完了を判定、既定の上限なし)、Codexの`/goal`(トークン予算)、DSHのgoal(256ラウンド、完了は自己申告)、piは拡張pi-goal(`--tokens`の予算、完了は自己申告)、ompは本体のgoal mode(判定方式は未確認)。
- jigは「goalで回すときの制約」をガードのルールとして持つ。無人のときは、テストのパスへのfs.writeとfs.editをforbidする。認証情報とデプロイ系のコマンドをforbidする。
- 無人で回してよいのは、成功の条件を回し始める前に機械が実行できる形で書けた仕事だけ(失敗するテスト、CIの合否、カバレッジや性能の数値、参照実装のある移植)。書けない仕事は人が見ている前で一段ずつ進める。

## Alternatives considered

- **自前の繰り返し実行系(bashの`while true`、launchdの予約)を持つ**: 最も星の多い実装(snarktank/ralph、21,838星)は2月から更新がなく、同種の494リポジトリのうち30日以内に更新があるのは6%。機能は各ハーネスの`/goal`に吸収された(GoogleのKanat-Alexander「ループはハーネスがgoalを持つまでの一時しのぎだった」)。約210人の読者調査の結論は「AI基盤を作る人以外は深追いする利点は薄い」。却下。
- **完了をエージェント自身に判定させる**: 自己判定の記録は全部失敗(Ronacherの35時間・約1,200ドルで成果なし、6時間の変換がスタブと決め打ちのtrueで埋まり煙テストは通った、「テストは壊れているが範囲外なので無視」で終了)。ImpossibleBenchではテストと矛盾する課題でGPT-5が54%、Opus 4.1が約50% の確率でテストを書き換え、試行回数を増やすと上がる。テストへの書き込みを禁止するとほぼ0になる。だから判定は外に出し、テストの書き換えはガードで止める。
- **間隔を決めたpollingで定期実行する**: 何もしていないのに30秒ごとに15万トークン、頼んでいない毎時の確認で月の枠の80% を消費、Codexのhookのループで9時間・3億4,000万トークンで成果なし。Anthropicの文書は「定期実行は毎回全文脈を送る」。実際に続いているのは朝に読むPRを作る雑用だけ。却下。
- **一つのセッションをcompactしながら長時間続ける**: 段階数と文脈長に応じた劣化が測られていて(arXiv 2509.09677、Context Rot)、最大級の暴走事故は単一セッションで起きている。既定にはしない。

## Consequences

- 止める仕組みは、調べた全実装に壊れた記録がある(Anthropicのralph-loop pluginは上限が静かに無効になる、遮断器が正常な実行を殺す)。予算と回数の上限は必ず自分で書く。
- 「新しい文脈で回し直す」形と「一つのセッションを続ける」形を同じ課題で比べた実験はない。
- piとompは完了の判定が自己申告(pi)か未確認(omp)なので、ガードの制約がより重要になる。

## Sources

- snarktank/ralph（21,838星、更新停止）: https://github.com/snarktank/ralph
- 段階数と文脈長に応じた劣化（Context Rot）: https://arxiv.org/abs/2509.09677
- Anthropicのralph-loop plugin、上限が静かに無効になる例: https://github.com/anthropics/claude-code/issues/81826
- 遮断器が正常な実行を止める例（frankbria/ralph-claude-codeのcircuit breaker）: https://github.com/frankbria/ralph-claude-code
- Claude Code: https://code.claude.com/docs/en/goal 、https://code.claude.com/docs/en/scheduled-tasks 、https://code.claude.com/docs/en/routines
- ImpossibleBench: https://arxiv.org/abs/2510.20270
- 読者調査: https://newsletter.pragmaticengineer.com/p/what-is-loop-engineering
- Huntley: https://ghuntley.com/ralph/ 、Ronacher: https://lucumr.pocoo.org/2026/9/7/astra-why/
- pollingの事故: https://github.com/anthropics/claude-code/issues/90443 、/issues/95305 、https://github.com/openai/codex/issues/34477
- pi-goal: https://github.com/Michaelliv/pi-goal
