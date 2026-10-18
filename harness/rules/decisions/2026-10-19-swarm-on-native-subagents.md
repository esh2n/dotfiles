# Swarm は pstack の手順と各ハーネスの本体のサブエージェントで組み、jig は 5 つを同じに整える

Status: accepted — 持ち主の裁定（2026-10-19）。pi と DSH へのエージェントの配り方と、jig としての Swarm を調べて決めた

rule: A swarm is pstack's `swarm` procedure run on each harness's own subagents; jig owns no worker engine. jig delivers the house agents to every harness — Claude Code, Codex, omp, pi through nicobailon/pi-subagents, and DSH through a generated Cordis preset — sets each harness's concurrency limit from one setting, verifies after apply that each harness actually loaded them, and fails the apply when one did not. Fan out reading, research, verification and review freely; parallel writers each own separate files and land one at a time; aim for three to five workers; never mix harnesses inside one swarm (asking another harness for a second opinion is a single delegation). Show running workers in an always-visible list where the harness allows it — Claude Code (`subagentStatusLine`), omp (a jig extension below the editor) and pi (pi-subagents' fleet view); Codex and DSH keep their own views. Cost for pi, omp and DSH workers comes from the LiteLLM ledger by worker tag; Claude Code and Codex show tokens.

## Problem

- 自作の Swarm（omp・pi の拡張、約 3,800 行）は、作業役の起動・表・結果の返却まで動くが、止まった作業役を打ち切れない、親が強制終了すると作業役が残る、本物の出力でのテストがない、という三つの重い欠点があった。使われたのは 2026-09-30 の 9 回だけで、失敗時と complex・deterministic の tier では一度も動いていない。
- pi には `@tintinweb/pi-subagents` 0.19.0 が入っていたが、jig は定義を置いておらず、何も読まれていなかった。DSH には AGENTS.md しか届いていなかった。
- 作業役を動かす仕組みは、09-27 以降に 5 つのハーネスすべてが本体に持つようになった（Claude Code のサブエージェントとエージェントチーム、Codex のサブエージェント、omp の `task` と Agent Hub、pi の拡張、DSH の本体のサブエージェント）。

## Decision

### 手順・仕組み・費用の三層

- **手順は pstack の `swarm`。** 枠組み（完了の条件、分担か競争か）、展開、集約（証拠の無い結果は捨てて 1 回だけやり直し、穴は合格にしない）、報告。全ハーネスに届いていて、道具名は pstack-adapter で読み替える。
- **仕組みは各ハーネスの本体。** jig はエージェント定義・tier・effort・同時実行の上限を 5 つに同じ形で配る。上限は jig の設定 1 か所から各ハーネスの欄（Claude Code、Codex、omp、pi の拡張、DSH）へ書き出す。`executor` は llama-server の 1 枠が上限になる。
- **費用は LiteLLM の台帳。** pi・omp・DSH の作業役は呼び出しに作業役の印を付け、台帳から作業役ごとに引く。Claude Code と Codex はサブスクリプションなのでトークンを出す。台帳への反映は 10 秒以上遅れる。

### 家の規則

- 並べてよいのは、調べる・読む・確かめる・レビューする作業。
- 書き込む作業を並べるときは、担当するファイルを分け、取り込みは 1 つずつ行う。
- 同時に動かすのは 3〜5 体を目安にする。
- 1 つの Swarm の中でハーネスを混ぜない。別のハーネスに意見を求めるのは 1 回の委任として扱う。

### エージェントの配り方

- **pi**: `@tintinweb/pi-subagents` を外し、`nicobailon/pi-subagents` に入れ替える。jig は `~/.pi/agent/agents/` に、pi の流儀（小文字の道具名、`proxy/<tier>`、effort は `thinking`）に変換して書き出す。
- **DSH**: 自前のエージェントを Cordis のプリセットに変換する変換器を作る。DSH は正式版の前なので、変換結果のテストと、DSH が実際に読み込めたかの確認を入れ、読み込めなければ apply をエラーにする。
- どのハーネスでも、apply のあとに、実際に読み込まれたエージェントを読み返して確かめる。

### 常に見える一覧

| ハーネス | 出し方 | 項目 |
|---|---|---|
| Claude Code | 本体の欄を `subagentStatusLine` のスクリプトで描き替える（jig が配る） | 名前・モデル・effort・状態・経過時間・トークン |
| omp | jig の拡張で入力欄の下に表を出す（omp の内部通知 `task:subagent:progress` を受ける） | 上の項目に進み具合と費用を加える |
| pi | nicobailon 版の一覧（入力欄の下） | 名前・状態・経過時間・トークン |
| Codex | 出せない。ステータスラインに会話全体の進み具合とトークン | — |
| DSH | 出せない。Web 画面の一覧を使う | — |

### 退役するもの

自作の Swarm（`harness/jig/src/{app,domain,infra}/swarm`、omp・pi の拡張の配線）を削除する。表を描く部品と、費用を台帳から引く部品は omp の一覧の拡張に移す。

## Alternatives considered

- **自作の Swarm を 5 つのハーネスに広げる**: うまくいっている例に共通する部品（作業の台帳、作業用の worktree、PR と CI、レビュー役、失敗の扱い）を全部自作することになり、前例の無い規模になる。却下。
- **Orchestrator.inc を使う**（5 つすべてに対応した唯一の既製品、星 1.3 万）: pi・omp・DSH の費用が出ず（費用は Claude Code・Codex・Kimi だけ）、同時実行の上限も費用の上限も無く（提案の issue #2344・#4673 のみ）、製品版は GitHub のユーザー名などを送る計測が既定で有効。足りない部分が jig に必要な部分そのもの。却下。
- **pi に tintinweb 版のまま定義を届ける**: モデル名が解決できないと黙って親のモデルで動き（#389）、大文字の道具名だと道具が 1 つも使えず（#396）、隔離モードでガードの拡張が動かない（#304）。却下。
- **Swarm にエージェント定義を読ませる**: 前例が無く、土台の Swarm に実績が無い。却下。
- **DSH は正式版まで待つ**: 変換器を作らない理由にはならず、形の変化はテストと読み込みの確認で検知できる。却下。
- **常に見える一覧を出さず、各ハーネスの一覧を開いて見る**: 要件に常に見える表があり、常時表示に害があるという根拠は無い（Kimi Code・pi-subagents・Claude Code のエージェントチームは常時表示を持つ）。却下。ただし、名の知れた実践者で作業役ごとの一覧を常時表示している人は見つからなかった（Steinberger・Willison はターミナルを並べ、Osmani は「張り付かない」と書く）。
- **Codex と DSH にも画面の外の仕組みで一覧を出す**: 画面に表示を足す口が無く（Codex #17827 は未実装）、第三者製の DSH の TUI は表示が止まる不具合が報告されている（dsh-TUI #1019・#1557）。見送り。

## Consequences

- `2026-09-27-swarm-extension.md` は、この記録で置き換える。同記録が `2026-09-22-subagents-and-workflows-by-scale.md` と `2026-09-22-loop-native-goal.md` に足した「実行系を持たない」の例外もなくなる。
- 約 3,800 行の自作コードを削除し、omp の一覧の拡張（150〜250 行の見込み）を新たに持つ。omp の内部通知は公開の拡張 API ではないので、本物の omp で動かす確認を入れる。
- pi-subagents は本体の毎回の呼び出しに約 5,200 トークンを上乗せする（作者は約 1,100 まで減らす予定、#2776）。
- Claude Code の `subagentStatusLine` は、完了した行がすぐ消え、更新は 5 秒ごとに固定（#102183）。

## Sources

- pstack の swarm: https://github.com/cursor/plugins （`pstack/skills/swarm/SKILL.md`）
- Orchestrator.inc: https://github.com/OrchestratorInc/agent-orchestrator （README、`docs/STATUS.md`、`docs/telemetry.md`、`backend/internal/service/usage/capabilities.go`）
- pi-subagents: https://github.com/nicobailon/pi-subagents 、https://github.com/tintinweb/pi-subagents/issues/389 、/396 、/304
- DSH のプリセットとサブエージェント: https://github.com/deepseek-ai/deepseek-harness （`packages/preset/agent-preset-registry/README.md`、`packages/subagent/subagent/README.md`）
- Claude Code の `subagentStatusLine`: https://code.claude.com/docs/en/statusline 、https://github.com/anthropics/claude-code/issues/102183
- omp の固定表示と内部通知: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md
- 並行の測定と実践: https://cognition.com/blog/multi-agents-working 、https://cursor.com/blog/scaling-agents 、https://arxiv.org/abs/2601.13295 、https://steipete.me/posts/just-talk-to-it 、https://simonwillison.net/2025/Oct/5/parallel-coding-agents/ 、https://addyosmani.com/blog/code-agent-orchestra/
- 違うエージェントの PR の衝突率（41.7% 対 19.8%）: arXiv 2607.04697（要約記事経由）
