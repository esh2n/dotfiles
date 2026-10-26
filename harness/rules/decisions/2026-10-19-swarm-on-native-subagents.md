# Swarmはpstackの手順と各ハーネスの本体のサブエージェントで組み、jigは5つを同じに整える

Status: accepted — 持ち主の裁定（2026-10-19）。piとDSHへのエージェントの配り方と、jigとしてのSwarmを調べて決めた

rule: A swarm is pstack's `swarm` procedure run on each harness's own subagents; jig owns no worker engine. jig delivers the house agents to every harness — Claude Code, Codex, omp, pi through nicobailon/pi-subagents, and DSH through a generated Cordis preset — sets each harness's concurrency limit from one setting, verifies after apply that each harness actually loaded them, and fails the apply when one did not. Fan out reading, research, verification and review freely; parallel writers each own separate files and land one at a time; aim for three to five workers; never mix harnesses inside one swarm (asking another harness for a second opinion is a single delegation). Show running workers in an always-visible list where the harness allows it — Claude Code (`subagentStatusLine`), omp (a jig extension below the editor) and pi (pi-subagents' fleet view); Codex and DSH keep their own views. Cost for pi, omp and DSH workers comes from the LiteLLM ledger by worker tag; Claude Code and Codex show tokens.

## Problem

- 自作のSwarm（omp・piの拡張、約3,800行）は、作業役の起動・表・結果の返却まで動くが、止まった作業役を打ち切れない、親が強制終了すると作業役が残る、本物の出力でのテストがない、という三つの重い欠点があった。使われたのは2026-09-30の9回だけで、失敗時とcomplex・deterministicのtierでは一度も動いていない。
- piには`@tintinweb/pi-subagents` 0.19.0が入っていたが、jigは定義を置いておらず、何も読まれていなかった。DSHにはAGENTS.mdしか届いていなかった。
- 作業役を動かす仕組みは、09-27以降に5つのハーネスすべてが本体に持つようになった（Claude Codeのサブエージェントとエージェントチーム、Codexのサブエージェント、ompの`task`とAgent Hub、piの拡張、DSHの本体のサブエージェント）。

## Decision

### 手順・仕組み・費用の三層

- **手順はpstackの`swarm`。** 枠組み（完了の条件、分担か競争か）、展開、集約（証拠の無い結果は捨てて1回だけやり直し、穴は合格にしない）、報告。全ハーネスに届いていて、道具名はpstack-adapterで読み替える。
- **仕組みは各ハーネスの本体。** jigはエージェント定義・tier・effort・同時実行の上限を5つに同じ形で配る。上限はjigの設定1か所から各ハーネスの欄（Claude Code、Codex、omp、piの拡張、DSH）へ書き出す。`executor`はllama-serverの1枠が上限になる。
- **費用はLiteLLMの台帳。** pi・omp・DSHの作業役は呼び出しに作業役の印を付け、台帳から作業役ごとに引く。Claude CodeとCodexはサブスクリプションなのでトークンを出す。台帳への反映は10秒以上遅れる。

### 家の規則

- 並べてよいのは、調べる・読む・確かめる・レビューする作業。
- 書き込む作業を並べるときは、担当するファイルを分け、取り込みは1つずつ行う。
- 同時に動かすのは3〜5体を目安にする。
- 1つのSwarmの中でハーネスを混ぜない。別のハーネスに意見を求めるのは1回の委任として扱う。

### エージェントの配り方

- **pi**: `@tintinweb/pi-subagents`を外し、`nicobailon/pi-subagents`に入れ替える。jigは`~/.pi/agent/agents/`に、piの流儀（小文字の道具名、`proxy/<tier>`、effortは`thinking`）に変換して書き出す。
- **DSH**: 自前のエージェントをCordisのプリセットに変換する変換器を作る。DSHは正式版の前なので、変換結果のテストと、DSHが実際に読み込めたかの確認を入れ、読み込めなければapplyをエラーにする。
- どのハーネスでも、applyのあとに、実際に読み込まれたエージェントを読み返して確かめる。

### 常に見える一覧

| ハーネス | 出し方 | 項目 |
|---|---|---|
| Claude Code | 本体の欄を`subagentStatusLine`のスクリプトで描き替える（jigが配る） | 名前・モデル・effort・状態・経過時間・トークン |
| omp | jigの拡張で入力欄の下に表を出す（ompの内部通知`task:subagent:progress`を受ける） | 上の項目に進み具合と費用を加える |
| pi | nicobailon版の一覧（入力欄の下） | 名前・状態・経過時間・トークン |
| Codex | 出せない。ステータスラインに会話全体の進み具合とトークン | — |
| DSH | 出せない。Web画面の一覧を使う | — |

### 退役するもの

自作のSwarm（`harness/jig/src/{app,domain,infra}/swarm`、omp・piの拡張の配線）を削除する。表を描く部品と、費用を台帳から引く部品はompの一覧の拡張に移す。

## Alternatives considered

- **自作のSwarmを5つのハーネスに広げる**: うまくいっている例に共通する部品（作業の台帳、作業用のworktree、PRとCI、レビュー役、失敗の扱い）を全部自作することになり、前例の無い規模になる。却下。
- **Orchestrator.incを使う**（5つすべてに対応した唯一の既製品、星1.3万）: pi・omp・DSHの費用が出ず（費用はClaude Code・Codex・Kimiだけ）、同時実行の上限も費用の上限も無く（提案のissue #2344・#4673のみ）、製品版はGitHubのユーザー名などを送る計測が既定で有効。足りない部分がjigに必要な部分そのもの。却下。
- **piにtintinweb版のまま定義を届ける**: モデル名が解決できないと黙って親のモデルで動き（#389）、大文字の道具名だと道具が1つも使えず（#396）、隔離モードでガードの拡張が動かない（#304）。却下。
- **Swarmにエージェント定義を読ませる**: 前例が無く、土台のSwarmに実績が無い。却下。
- **DSHは正式版まで待つ**: 変換器を作らない理由にはならず、形の変化はテストと読み込みの確認で検知できる。却下。
- **常に見える一覧を出さず、各ハーネスの一覧を開いて見る**: 要件に常に見える表があり、常時表示に害があるという根拠は無い（Kimi Code・pi-subagents・Claude Codeのエージェントチームは常時表示を持つ）。却下。ただし、名の知れた実践者で作業役ごとの一覧を常時表示している人は見つからなかった（Steinberger・Willisonはターミナルを並べ、Osmaniは「張り付かない」と書く）。
- **CodexとDSHにも画面の外の仕組みで一覧を出す**: 画面に表示を足す口が無く（Codex #17827は未実装）、第三者製のDSHのTUIは表示が止まる不具合が報告されている（dsh-TUI #1019・#1557）。見送り。

## Consequences

- `2026-09-27-swarm-extension.md`は、この記録で置き換える。同記録が`2026-09-22-subagents-and-workflows-by-scale.md`と`2026-09-22-loop-native-goal.md`に足した「実行系を持たない」の例外もなくなる。
- 約3,800行の自作コードを削除し、ompの一覧の拡張（150〜250行の見込み）を新たに持つ。ompの内部通知は公開の拡張APIではないので、本物のompで動かす確認を入れる。
- pi-subagentsは本体の毎回の呼び出しに約5,200トークンを上乗せする（作者は約1,100まで減らす予定、#2776）。
- Claude Codeの`subagentStatusLine`は、完了した行がすぐ消え、更新は5秒ごとに固定（#102183）。

## Sources

- pstackのswarm: https://github.com/cursor/plugins （`pstack/skills/swarm/SKILL.md`）
- Orchestrator.inc: https://github.com/OrchestratorInc/agent-orchestrator （README、`docs/STATUS.md`、`docs/telemetry.md`、`backend/internal/service/usage/capabilities.go`）
- pi-subagents: https://github.com/nicobailon/pi-subagents 、https://github.com/tintinweb/pi-subagents/issues/389 、/396 、/304
- DSHのプリセットとサブエージェント: https://github.com/deepseek-ai/deepseek-harness （`packages/preset/agent-preset-registry/README.md`、`packages/subagent/subagent/README.md`）
- Claude Codeの`subagentStatusLine`: https://code.claude.com/docs/en/statusline 、https://github.com/anthropics/claude-code/issues/102183
- ompの固定表示と内部通知: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md
- 並行の測定と実践: https://cognition.com/blog/multi-agents-working 、https://cursor.com/blog/scaling-agents 、https://arxiv.org/abs/2601.13295 、https://steipete.me/posts/just-talk-to-it 、https://simonwillison.net/2025/Oct/5/parallel-coding-agents/ 、https://addyosmani.com/blog/code-agent-orchestra/
- 違うエージェントのPRの衝突率（41.7% 対19.8%）: arXiv 2607.04697（要約記事経由）
