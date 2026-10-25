# 無人の実行は pstack の「寝る前の契約」に従い、guard は無人を見分けない

Status: accepted — 持ち主の裁定（2026-10-25）。2026-10-19-unattended-runs-native-goal-and-loop.md を置き換える。自前の実行系を作らないこと、各ハーネスの goal と loop を使うこと、機能が無いハーネスでは一回だけ実行して報告することは引き継ぐ。無人の間だけ guard でテストのパスへの書き込みを禁じる決まりは外す

rule: Never build a custom loop or execution engine; drive repetition through each harness's own goal and loop features (Claude Code `/goal`, `/loop`, `ScheduleWakeup`, `CronCreate`, Monitor; Codex `/goal`; omp `/goal`, and `/loop` with a shell continue-condition); where a harness lacks one, the pstack playbook step runs once and reports (`pstack-adapter`, Unattended runs). Before leaving work to run unattended, hand it over as pstack's overnight contract (`docs/guide/07-overnight.md`): the goal, a machine-checkable finish condition, the permissions granted, a turn, time or token cap, and an escape hatch — stop and write up why instead of relaxing the condition. Run it in a fresh worktree (`.claude/worktrees/<name>`) or an sbx box, keep a decision log with `show-me-your-work`, and audit it afterwards, including every change to test files. Go unattended only once pstack's four trust conditions hold; until then, run it while you watch. The guard never tries to tell whether a run is unattended: its rules hold in every mode.

## Problem

2026-10-19-unattended-runs-native-goal-and-loop.md は、無人の間だけテストのパスへの fs.write と fs.edit、認証情報とデプロイのコマンドを guard で禁じると決めた。規則を書こうとして、guard が「いまの実行は無人か」を知る方法を調べた（`../research/2026-10-21-unattended-run-signal.md`）。分かったのは次のことである。

- 「無人」を一つの値でフックに渡すハーネスは無い。許可モードは向きが逆で（Claude Code は端末の既定が `auto`、`claude -p` の既定が `default`）、Codex は `codex exec` と対話の `--yolo` を区別できない。Claude Code と Codex は `/goal` が動いていることをフックに渡さない。
- 起動時に環境変数で印を付ける方法は、エージェントが設定ファイルを書き換えて印を変えられる（公開リポジトリ jikig-ai/soleur の測定）。
- 無人の間だけ規則を足す公開例は星 4 のリポジトリ一つで、作者自身が境界ではないと書く。

そこで前提に戻り、業界と実践者が無人の実行をどう扱っているかを見直した（`../research/2026-10-20-goal-loops-practice.md` と pstack の `docs/guide/07-overnight.md`）。ベンダー（Anthropic、OpenAI、Cursor、Factory）は数時間から数日の無人の実行を製品にしており、どれも機械で確かめられる終わりの条件を前提にする。pstack の作者と実践者が無人の前に求めるのは、終わりの条件、切り離した作業場所、外れない上限、行き詰まったときの逃げ道、事後の点検、先に信頼を得ること、である。2026-10-19 の決定には終わりの条件と上限しか無く、逃げ道・切り離し・事後の点検・先に信頼を得ることが抜けていた。逆に、guard でテストの書き換えを止める形は、pstack も名の通った実践者もとっていない（Huntley は関係の無いテストの修正までエージェントに任せる）。測定で効果がはっきりしているのは、逃げ道（ImpossibleBench で GPT-5 の不正が 54% から 9% に下がる）と、テストを読み取り専用にすることである。

## Decision

1. **自前の実行系は作らない。** 2026-09-22 からの決定のまま。繰り返しは各ハーネスの goal と loop の機能で回し、機能の無いハーネスでは pstack の手順のその段を一回だけ実行して報告する。
2. **無人で任せるときは、pstack の「寝る前の契約」の形で渡す。** 目標、機械で確かめられる終わりの条件、与える許可、回数・時間・トークンのどれかの上限、逃げ道（本当に行き詰まったら、条件を緩めずに止まって理由を書く）を入れる。段取りは `/figure-it-out`、止めるときは Pause safely の手順を使う。
3. **作業場所を切り離す。** 新しい worktree（`.claude/worktrees/<name>`、2026-09-27-one-worktree-layout.md）で回し、強く切り離したいときは sbx のコンテナで回す（2026-09-22-box-shape.md）。
4. **判断の記録を付け、事後に点検する。** `show-me-your-work` で判断の記録を残し、戻ったら別のモデル系統のレビュアーが読んだ結果から確かめる。点検ではテストのファイルの変更をすべて見る。
5. **先に信頼を得る。** pstack の四条件（一度手でやるか見ている、人と同じ道具と信号がある、各段が成果を確かめて止められる、記録を読んで繰り返す失敗を道具にした）がそろうまでは、見ながら回す。
6. **guard は無人を見分けない。** guard の規則はどのモードでも効く。認証情報の禁止はすでにある。本番に反映するコマンドには、常に確認を求める規則を足す（人がいなければ確認は拒否になり、Codex では jig が拒否に変える）。

## Alternatives considered

- **2026-10-19 のまま、無人を見分けて guard でテストの書き換えを止める**: 見分ける確かな信号が無く、印はエージェントが書き換えられる。前例も星 4 の一件だけ。却下。
- **テストの書き換えを常に止める**: TDD でテストを書くたびに止まる。常時有効のテスト保護（nizos/tdd-guard）には、正当な編集を止めた報告（#100、#83）と、シェルや MCP で回り道できるという作者自身の記述がある。却下。
- **何もしない（goal と上限だけで回す）**: 実践者が求める逃げ道・切り離し・事後の点検が無く、自己申告の完了が当てにならないという測定（54 回中 56% が改善なし）に対して守りが無い。却下。

## Consequences

- 本番に反映するコマンド（`terraform apply`、`kubectl apply`、`wrangler deploy` など）の確認の規則は、guard-rules.json に持ち主が入れる。
- 手元の対話で `/goal` を回して席を外した場合も、guard は特別な扱いをしない。そうした使い方は 2 から 5 の形に移す。
- pi は goal の機能を持たないので、無人の繰り返しをしない。手元の拡張 `gate.ts` は、完了の前に検査のコマンドを走らせるだけで、この決定の対象外である。
- Codex と omp の `/goal` は完了が自己申告なので、事後の点検の重みが大きい。

## Sources

- `../research/2026-10-20-goal-loops-practice.md`（ベンダー、実践者、測定、公開リポジトリ）
- `../research/2026-10-21-unattended-run-signal.md`（無人を見分ける信号）
- pstack `docs/guide/07-overnight.md`: https://github.com/cursor/plugins/blob/main/pstack/docs/guide/07-overnight.md
- Claude Code: https://code.claude.com/docs/en/goal 、https://code.claude.com/docs/en/permission-modes
- ImpossibleBench: https://arxiv.org/abs/2510.20270
- Huntley: https://ghuntley.com/ralph/ 、Willison: https://simonwillison.net/2025/Sep/30/designing-agentic-loops/
- nizos/tdd-guard: https://github.com/nizos/tdd-guard
