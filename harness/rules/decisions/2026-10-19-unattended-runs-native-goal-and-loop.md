# 無人の繰り返しは各ハーネスの goal と loop で回し、jig はその制約だけを持つ

Status: accepted — 持ち主の裁定（2026-10-19）。2026-09-22-loop-native-goal.md を置き換える。自前の実行系を作らないこと、無人の間の制約、機械で確かめられる成功の条件を先に書くことは引き継ぐ

rule: Never build a custom loop or execution engine; drive unattended repetition through each harness's own features — its goal feature to run until a condition holds, and its own loop or scheduling (Claude Code `/loop`, `ScheduleWakeup`, `CronCreate`, Monitor; omp `/loop` with a shell continue-condition) for fixed intervals, self-paced wakeups and watchers. Where a harness lacks a feature, the pstack playbook step that needs it runs once and reports instead of looping (`pstack-adapter`, Unattended runs). During any unattended run, forbid fs.write/fs.edit to test paths and forbid credential and deploy commands, and start only tasks whose success condition is machine-checkable before starting; write the turn, time or token cap into the run yourself.

## Problem

2026-09-22-loop-native-goal.md は、無人の繰り返しを各ハーネスの goal 機能だけで回すと決めた。pstack を入れると、その手順書（Babysit、Autonomous run、Autopilot、Orchestrate）は Cursor の `/loop` を、一定間隔で回す、自分で次の起動を決める、PR を見張る、条件を満たすまで回す、の四通りに使う。goal でまかなえるのは最後の一つだけで、決定のままでは Claude Code の `/loop` も使えず、これらの手順書が動かない。

2026-10-19 に各ハーネスの手元の版と公式の文書を確かめた結果は次のとおり。

| ハーネス（版） | goal | 繰り返し・定期実行 |
|---|---|---|
| Claude Code 2.1.303 | `/goal`。別の小さなモデルが完了を判定。既定の上限なし。`claude -p` でも最後まで回る | `/loop 5m`（`CronCreate`、最短 1 分）、間隔なしの `/loop`（`ScheduleWakeup` で 1 分〜1 時間）、Monitor。セッションの中だけで、繰り返しは 7 日で切れる |
| Codex 0.160.0 | `/goal`。完了は自己申告、トークンの予算は目安で強制しない。`codex exec` で動くかは未確認 | CLI には無い（デスクトップアプリの定期実行だけ） |
| omp 18.0.4 | `/goal`、`/guided-goal`。完了は自己申告、トークンの予算は厳密。画面のない実行では既定で続かない（`goal.continuationModes`） | `/loop [回数|時間]`。応答のたびに同じ指示を出し直し、シェルのコマンドの終了コードで続けるかを決める。一定間隔の起動は無い |
| pi 0.85.1 | 本体に無い。拡張 pi-goal（未導入）で、完了は自己申告 | 無い |
| DSH | 未導入のため未確認 | 未確認 |

## Decision

1. **自前の実行系は作らない。** これは 2026-09-22 の決定のまま。
2. **各ハーネスの機能を、goal に限らず使う。** 条件を満たすまで回すときは goal、一定間隔・自分で決める起動・見張りは、そのハーネスの loop や定期実行の機能で回す。
3. **機能が無いハーネスでは回さない。** pstack の手順書が求める繰り返しを、そのハーネスの機能でまかなえないときは、一回だけ確かめて報告する形で動かす（Babysit の check モードなど）。外の cron から CLI を呼んで回すのは、自前の実行系にあたるので作らない。
4. **無人の間の制約は、goal にも loop にも同じに効かせる。** テストのパスへの fs.write と fs.edit を禁じる。認証情報とデプロイのコマンドを禁じる。成功の条件を、回し始める前に機械が確かめられる形で書けた仕事だけを回す。回数・時間・トークンの上限を自分で書く（Claude Code の goal と loop には既定の上限が無い）。

## Alternatives considered

- **goal だけで回す（前の決定のまま）**: pstack の手順書のうち、一定間隔・自分で決める起動・見張りを使うものが動かない。Claude Code が持つ `/loop` を使わない理由も無い。却下。
- **goal の決まりを廃止し、pstack の `/loop` の書き方にそのまま従う**: Cursor の `/loop` は Claude Code にしか対応する機能が無く、Codex・pi では動かない。無人の間の制約と上限の決まりも消える。却下。
- **外の cron や launchd から CLI を呼んで、どのハーネスでも間隔で回す**: 自前の実行系にあたる。2026-09-22 に調べた自前の仕組みは、上限が静かに効かなくなる、遮断器が正常な実行を止める、などの壊れ方をしている。却下。

## Consequences

- Claude Code では、pstack の四通りの繰り返しがすべて本体の機能で動く。ただしセッションの中だけで、Claude Code を閉じると止まり、7 日で切れる。
- Codex と omp では、条件を満たすまで回すことだけができる。どちらも完了は自己申告なので、制約と上限の重みが大きい。omp を画面なしで回すときは `goal.continuationModes` に `rpc` が要る。
- pi は、pi-goal を入れない限り無人の繰り返しをしない。
- 無人の間の制約（テストのパスへの書き込みとデプロイ系のコマンドの禁止）は、いまの `guard-rules.json` に規則が無い。規則は持ち主が書く。

## Sources

- 2026-09-22-loop-native-goal.md（自前の実行系の壊れ方の出典は同記録の Sources）
- Claude Code goal: https://code.claude.com/docs/en/goal
- Claude Code scheduled tasks（`/loop`、`ScheduleWakeup`、`CronCreate`）: https://code.claude.com/docs/en/scheduled-tasks
- omp のソース（goals、`modes/loop-limit.ts`、`modes/loop-condition.ts`、`docs/rpc.md`）: https://github.com/can1357/oh-my-pi
- omp の画面なしでは goal が使えない件: https://github.com/can1357/oh-my-pi/issues/8224
- Codex の goal の予算が目安である件（第三者の記事）: https://codex.danielvaughan.com/2026/07/23/codex-cli-goal-mode-long-horizon-autonomous-workflows-ralph-loop-token-budgets/
- Codex の goal の未解決の不具合: https://github.com/openai/codex/issues/53814 、https://github.com/openai/codex/issues/41838
- pi-goal: https://github.com/Michaelliv/pi-goal
