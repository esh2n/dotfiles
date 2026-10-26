# 無人の繰り返しは各ハーネスのgoalとloopで回し、jigはその制約だけを持つ

Status: superseded — 2026-10-25-unattended-runs-overnight-contract.mdが置き換える（無人の間だけguardでテストの書き込みを禁じる決まりを外し、pstackの寝る前の契約に従う）。もとの裁定は2026-10-19。2026-09-22-loop-native-goal.mdを置き換える。自前の実行系を作らないこと、無人の間の制約、機械で確かめられる成功の条件を先に書くことは引き継ぐ

rule: Never build a custom loop or execution engine; drive unattended repetition through each harness's own features — its goal feature to run until a condition holds, and its own loop or scheduling (Claude Code `/loop`, `ScheduleWakeup`, `CronCreate`, Monitor; omp `/loop` with a shell continue-condition) for fixed intervals, self-paced wakeups and watchers. Where a harness lacks a feature, the pstack playbook step that needs it runs once and reports instead of looping (`pstack-adapter`, Unattended runs). During any unattended run, forbid fs.write/fs.edit to test paths and forbid credential and deploy commands, and start only tasks whose success condition is machine-checkable before starting; write the turn, time or token cap into the run yourself.

## Problem

2026-09-22-loop-native-goal.mdは、無人の繰り返しを各ハーネスのgoal機能だけで回すと決めた。pstackを入れると、その手順書（Babysit、Autonomous run、Autopilot、Orchestrate）はCursorの`/loop`を、一定間隔で回す、自分で次の起動を決める、PRを見張る、条件を満たすまで回す、の四通りに使う。goalでまかなえるのは最後の一つだけで、決定のままではClaude Codeの`/loop`も使えず、これらの手順書が動かない。

2026-10-19に各ハーネスの手元の版と公式の文書を確かめた結果は次のとおり。

| ハーネス（版） | goal | 繰り返し・定期実行 |
|---|---|---|
| Claude Code 2.1.303 | `/goal`。別の小さなモデルが完了を判定。既定の上限なし。`claude -p`でも最後まで回る | `/loop 5m`（`CronCreate`、最短1分）、間隔なしの`/loop`（`ScheduleWakeup`で1分〜1時間）、Monitor。セッションの中だけで、繰り返しは7日で切れる |
| Codex 0.160.0 | `/goal`。完了は自己申告、トークンの予算は目安で強制しない。`codex exec`で動くかは未確認 | CLIには無い（デスクトップアプリの定期実行だけ） |
| omp 18.0.4 | `/goal`、`/guided-goal`。完了は自己申告、トークンの予算は厳密。画面のない実行では既定で続かない（`goal.continuationModes`） | `/loop [回数|時間]`。応答のたびに同じ指示を出し直し、シェルのコマンドの終了コードで続けるかを決める。一定間隔の起動は無い |
| pi 0.85.1 | 本体に無い。拡張pi-goal（未導入）で、完了は自己申告 | 無い |
| DSH | 未導入のため未確認 | 未確認 |

## Decision

1. **自前の実行系は作らない。** これは2026-09-22の決定のまま。
2. **各ハーネスの機能を、goalに限らず使う。** 条件を満たすまで回すときはgoal、一定間隔・自分で決める起動・見張りは、そのハーネスのloopや定期実行の機能で回す。
3. **機能が無いハーネスでは回さない。** pstackの手順書が求める繰り返しを、そのハーネスの機能でまかなえないときは、一回だけ確かめて報告する形で動かす（Babysitのcheckモードなど）。外のcronからCLIを呼んで回すのは、自前の実行系にあたるので作らない。
4. **無人の間の制約は、goalにもloopにも同じに効かせる。** テストのパスへのfs.writeとfs.editを禁じる。認証情報とデプロイのコマンドを禁じる。成功の条件を、回し始める前に機械が確かめられる形で書けた仕事だけを回す。回数・時間・トークンの上限を自分で書く（Claude Codeのgoalとloopには既定の上限が無い）。

## Alternatives considered

- **goalだけで回す（前の決定のまま）**: pstackの手順書のうち、一定間隔・自分で決める起動・見張りを使うものが動かない。Claude Codeが持つ`/loop`を使わない理由も無い。却下。
- **goalの決まりを廃止し、pstackの`/loop`の書き方にそのまま従う**: Cursorの`/loop`はClaude Codeにしか対応する機能が無く、Codex・piでは動かない。無人の間の制約と上限の決まりも消える。却下。
- **外のcronやlaunchdからCLIを呼んで、どのハーネスでも間隔で回す**: 自前の実行系にあたる。2026-09-22に調べた自前の仕組みは、上限が静かに効かなくなる、遮断器が正常な実行を止める、などの壊れ方をしている。却下。

## Consequences

- Claude Codeでは、pstackの四通りの繰り返しがすべて本体の機能で動く。ただしセッションの中だけで、Claude Codeを閉じると止まり、7日で切れる。
- Codexとompでは、条件を満たすまで回すことだけができる。どちらも完了は自己申告なので、制約と上限の重みが大きい。ompを画面なしで回すときは`goal.continuationModes`に`rpc`が要る。
- piは、pi-goalを入れない限り無人の繰り返しをしない。このリポジトリのpiの拡張`home/shared/harness/pi/extensions/gate.ts`（2026-09-13から、earlyaidopters/marks-pi-harnessをMITで取り込んだもの）も`/goal`を持つが、これは目標を毎ターン差し込み、完了の前に検査のコマンド（`/gate`）を通させるだけで、モデルがターンを終えたあとに次のターンを自分で始めない。そのため無人の繰り返しにはあたらず、自前の実行系でもない。pi-goalを入れるときは、二つが同じ`/goal`を登録するので、どちらかの名前を変える。
- 無人の間の制約（テストのパスへの書き込みとデプロイ系のコマンドの禁止）は、いまの`guard-rules.json`に規則が無い。規則は持ち主が書く。

## Sources

- 2026-09-22-loop-native-goal.md（自前の実行系の壊れ方の出典は同記録のSources）
- Claude Code goal: https://code.claude.com/docs/en/goal
- Claude Code scheduled tasks（`/loop`、`ScheduleWakeup`、`CronCreate`）: https://code.claude.com/docs/en/scheduled-tasks
- ompのソース（goals、`modes/loop-limit.ts`、`modes/loop-condition.ts`、`docs/rpc.md`）: https://github.com/can1357/oh-my-pi
- ompの画面なしではgoalが使えない件: https://github.com/can1357/oh-my-pi/issues/8224
- Codexのgoalの予算が目安である件（第三者の記事）: https://codex.danielvaughan.com/2026/07/23/codex-cli-goal-mode-long-horizon-autonomous-workflows-ralph-loop-token-budgets/
- Codexのgoalの未解決の不具合: https://github.com/openai/codex/issues/53814 、https://github.com/openai/codex/issues/41838
- pi-goal: https://github.com/Michaelliv/pi-goal
