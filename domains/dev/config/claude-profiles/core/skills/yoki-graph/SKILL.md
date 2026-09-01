---
name: yoki-graph
description: Use to run a multi-agent workflow (review, research, implement, preflight, design-review, acceptance, code-study, deliberate, stocktake, go-optimize) from Codex or omp — the CLI launcher for the same Workflow-tool-shaped scripts Claude Code runs natively. Symptoms include a request to launch one of these workflows outside Claude Code, "codex から review 回して", "omp からワークフロー起動して", or checking a run's status/journal after launch.
---

# yoki-graph

## Overview

yoki-graph は `core/workflows/*.js`(Claude Code の Workflow tool が実行するのと
**同じ**スクリプト)を Claude Code の外から動かすための CLI
(`bin/yoki-graph`、実体は `runtime/yoki/scripts/lib/graph/cli.js`)。責務は
Workflow tool と同一 — スクリプトを書くのはこのスキルの仕事ではなく、
`workflow-authoring` スキルの領域。yoki-graph はその実行だけを担う。

**Claude Code の中では、ネイティブの Workflow tool がこれまでどおり本来の
経路。**yoki-graph に切り替える必要はない。yoki-graph を選ぶのは:

- Codex(`codex exec`)や omp など、Workflow tool を持たない harness から
  同じグラフを起動したいとき
- CLI から `--resume` / `--json` / `status` でランを直接触りたいとき

backend は `codex` / `omp` / `mock` の3つ。**`claude` backend は無い** —
Claude Code の中ではネイティブの Workflow tool が唯一のサポート経路で、
`claude -p` を叩くのはそれと二重の非サポート経路になる(かつ従量課金に
移る可能性がある)ため。`--backend claude` を渡すとその旨を名指しで拒否して
exit 1 になる。同じ理由で yoki-loop からも `--harness claude` を外した
(Claude Code は `/loop` と定期実行を自前で持つ)。

## いつワークフロー、いつ単発 subagent か

`core/CLAUDE.layer.md`(Expensive-Model Delegation)の原則そのまま:

> Workflow vs single agent: workflows for batches of adjudicated tasks
> (parallel, per-task verify + gate + delivery); a single agent for
> one-cause investigations with a tight repro loop; the main session only
> for judgment and acceptance

つまり「複数の判定/検証を伴うバッチ処理」はワークフロー、「原因が一つに
絞れている調査をタイトなループで回す」だけなら単発の subagent の方が軽い。
迷ったら `yoki-graph list` で既存グラフの `description`/`whenToUse` を見て、
今のタスクがどれかの型にはまるか先に確認する。

## コマンド

```
yoki-graph run <name|path> --backend codex|omp|mock
    [--args '<json>' | --args-file <f>] [--cwd <dir>]
    [--resume <runId>] [--dry-run] [--json] [--concurrency N]
    [--model haiku|sonnet|opus|<id>] [--effort low|medium|high|xhigh|max]
    [--mock <file>] [--timeout <ms>] [--retries N]
    [--max-agent-calls N] [--max-tokens N] [--max-wall-ms N]
    [--model-map <tier>=<id>,...]
yoki-graph list
yoki-graph status <runId> [--watch]
```

`<name>` は `~/.claude/workflows/<name>.js`(=`core/workflows/` からインストール
された実体。pack 由来のグラフは、そのパックが有効な機体でだけ同じ場所に
merge される)を指す。パス区切りを含む/`.js` で終わる引数はファイルパスとして
先に解決される。`--args` は JSON 文字列、`--args-file` はそれをファイルから
読む — 両方渡す必要はどちらか一方だけ。`--backend mock` は `--mock <file>`
の固定応答で流す(テスト/ドライラン用)。

### ワークフロー別コマンド

`core/workflows/` の9本 + `packs/go/workflows/go-optimize.js`(go pack 有効時
のみインストールされる)。各スクリプト冒頭の `meta`/args コメントから。

- **review** — 独立コンテキストの多エージェントコードレビュー
  ```
  yoki-graph run review --backend codex --args '{"range":"origin/main...HEAD"}'
  ```
  `args: { range?: string, model?: string, providers?: array }`。`range`
  省略時は worktree vs `origin/main` の merge-base(未 push のコミット+
  未コミット変更を両方含む)。`providers` は **Claude Code から起動する
  ときだけ**意味を持つ(後述「Claude Code から Codex/omp レーンを混ぜる」)
  — yoki-graph から起動する場合は `--backend` が全レーンを決めるので不要。

- **research** — 複数角度の調査、根拠つき統合
  ```
  yoki-graph run research --backend omp --args '{"question":"..."}'
  ```
  `args: { question: string, context?: string, model?: string,
  language?: string, providers?: array }`

- **implement** — 合意済みタスクリストのバッチ実行(依存波・ファイル重複
  バッチ・per-task verify+retry・最終ゲート・任意 delivery)
  ```
  yoki-graph run implement --backend codex --args '{"tasksFile":"tasks.md","delivery":"none"}'
  ```
  `args: { tasks?: [{id,title,spec,files?,deps?}], tasksFile?: string,
  rules?: [path], docs?: [path], model?: string, max_retry?: number,
  delivery?: 'none' | 'commit' | 'draft-pr', deliveryBranch?: boolean }`

- **preflight** — PR前のローカル品質ゲート(fan-out review → judge → 自動
  修正 → lint/build ゲート)
  ```
  yoki-graph run preflight --backend codex
  ```
  `args: { model?: string }`

- **design-review** — 設計/spec をプロジェクトの実態に照らして精査
  ```
  yoki-graph run design-review --backend omp --args '{"target":"docs/design.md"}'
  ```
  `args: { target: string (path/URL/inline text), model?: string, language?: string }`

- **acceptance** — 実装済みの完了判定(基準ごとの証拠マッピング + 敵対的検証)
  ```
  yoki-graph run acceptance --backend codex --args '{"criteriaFile":"acceptance.md","scope":"..."}'
  ```
  `args: { criteria?: [{id,text}], criteriaFile?: string, scope?: string,
  out?: string, language?: string, model?: string }`

- **code-study** — 既存実装を固定質問に沿って読む(file:line 根拠つき)
  ```
  yoki-graph run code-study --backend codex --args '{"target":"./pkg","questions":["..."]}'
  ```
  `args: { target: string, questions: string[], context?: string, out?: string,
  language?: string, model?: string }`

- **deliberate** — ダブルダイヤモンド型の設計検討(発散→ゲート→収束→反証)
  ```
  yoki-graph run deliberate --backend omp --args '{"question":"..."}'
  ```
  `args: { question: string, context?: string, grounding?: string[],
  evidence?: 'auto' | 'never', model?: string, language?: string }`

- **stocktake** — `~/.claude` の定期棚卸し(skills/hooks/MCP/memory、report-only)
  ```
  yoki-graph run stocktake --backend omp
  ```
  `args: { model?: string, language?: string }`

- **go-optimize**(go pack 有効時のみ)— pprof 起点の Go 性能最適化提案、
  worktree 隔離 + benchstat ゲート
  ```
  yoki-graph run go-optimize --backend codex --args '{"pkg":"./internal/codec"}'
  ```
  `args: { pkg: string (必須), bench?: string, threshold?: number,
  budget?: {maxProposals?, maxRounds?}, delivery?: 'draft' | 'commit' | 'pr',
  runId?: string }`。`go-optimize` が `yoki-graph list` に出ないマシンでは
  `yoki-switch pack enable go` が先。

## モデルの指定と表示

優先順は **呼び出しごとの `agent({model})` > run の `--model` > バックエンド
既定**。tier(`haiku`/`sonnet`/`opus`、omp の `review`/`scout`)は
`core/harness-models.json` で実 ID に解決され、`gpt-5.5` のような具体的な
ID はそのまま通る。

- **存在しない tier はエラー**(有効な tier を並べて拒否)。以前は素通りして
  `codex -m sonnett` が typo から遠い場所で落ちていた。
- `--model-map haiku=gpt-5.4-mini,sonnet=gpt-5.5` でその run だけ上書き
  (ファイルに無い tier を足すこともできる)。
- 進捗行・journal・`--json` イベント・`status` はすべて**解決後の ID**を出す:
  `→ review:security (codex gpt-5.6-sol) [Review]`。`--model-map` や
  呼び出しごとの `model` が絡むと "sonnet" という表示は何も特定しないため。
- ラン終了時にモデル別の表(calls / tokens / cached / wall)が出る。
  `run.json` にも入るので `yoki-graph status <runId>` で後から同じ表を見られる。
  行のキーは **backend + 解決後の ID**。backend 列は複数 backend を混ぜた
  ランでだけ出る(単一 backend のランの表は従来どおり)。表と usage 行は
  **JSON の result より前**に出る — result は数千行になり得るので、後ろに
  置くと TTY では流れ、リダイレクトしたログでは最下部に埋もれるため。
- `cached` は「入力のうちキャッシュから供給された分」。**`tokens` には
  足さない**。codex の `cached_input_tokens` は `input_tokens` の
  部分集合(足すと二重計上 — 実際に 4.1M のランが 7.46M と報告された)、
  omp の `cacheRead` は `input` と互いに素でレコード自身の `totalTokens` に
  既に含まれる。向きが逆なので backend ごとに扱いを変えている。

## 進捗の見かた

- **TTY**: 恒久的な行(phase 見出し・log・終わった agent)はそのまま流れ、
  その下に1行のライブ状態が `\r` で更新される:
  `phase 2/5 Review — running 3 / done 7 / failed 0 — [security gpt-5.6-sol 41s +3 tools]`
- **パイプ/ファイル**: ライブ行は出さず、イベント1件=1行(ログに `\r` の
  再描画を残さないため)。
- `--json` は従来どおり NDJSON。`model` / `backend` / `index` / `phases` が
  増え、実行中の tool 呼び出し数を伝える `agent-progress` イベントが増えた
  (codex は `--json` の item イベント、omp は json モードのイベント列から
  数える。mock は合成値を1回だけ返す)。
- `yoki-graph status <runId> --watch` は2秒ごとに journal の**追記分だけ**を
  読んで同じ状態行を描き(全文再読み込みではないので、長いランでも1tickの
  コストが増えていかない)、ランが終わったら通常の `status` 出力を出して
  終了する。ファイルが短くなったら(切り詰め・ローテート)全文を読み直す。

## guard / 日次キャップ

`workflow-guard.sh`(Claude Code の Workflow tool 用 PreToolUse フック)と
**同じカウンタファイル**(`~/.claude/.cache/workflow-guard/count-YYYYMMDD`)を
使う — Claude Code から起動した回数と `yoki-graph run` で起動した回数は
同じ日次上限を共有する。

- キャップの解決順: `.yoki.json` の `workflowDailyCap`(`cwd` から上に探索)
  → 環境変数 `YOKI_WORKFLOW_DAILY_CAP` → デフォルト 5。
- 逃げ道: `WORKFLOW_GUARD_DISABLED=1`、または `.yoki.json` の
  `disabledHooks` に `"workflow-guard"`。
- 内部エラー(state dir が壊れている等)では fail-open — ガードのせいで
  ランが止まることはない。
- **フックにあって yoki-graph には無い挙動**: 「セッション内でそのワーク
  フローを初めて起動したときは理由つきで1回だけ拒否し、同じ内容の再試行は
  通す」というターン。これは Claude Code セッションが拒否理由を読んで
  同じターン内で再試行できることに依存する挙動で、CLI プロセスにはその
  リトライループが無い(拒否されたら単にその起動が失敗して終わる)ため、
  意図的に再現していない。効くのは日次キャップだけ。
- `--dry-run` はガード自体を一切通らない(カウントも消費しない) —
  `agent()` はどのバックエンドも呼ばずプレースホルダを返すだけなので、
  backend 固有の実行を検証したことにはならない点に注意。
- 拒否されると exit code 1、標準出力に理由(トークン消費の目安つき)が出る。

## 1つのランで backend を混ぜる(呼び出しごとの backend)

`--backend` はランの既定値。呼び出し1つだけ別の backend に振るには
`agent(prompt, { backend: 'omp' })`。1つのランで codex と omp のレーンを
混ぜられる。

| 呼び出しごと | ラン全体で共有 |
| --- | --- |
| backend モジュール(argv・実行・usage の読み方・schema ネイティブ対応) | 同時実行セマフォは**1つ**。混ぜても並列度は倍にならない |
| モデル解決(その backend の tier マップで引く。`sonnet` の実 ID は codex と omp で違う) | journal / ロック / `--resume` の index 列 |
| sandbox の既定値と表現方法 | 実行キャップ(agent 呼び出し数・トークン・wall) |

存在しない backend 名は**致命的エラー**でランごと止まる(`null` に
落とさない)。`{backend: 'codexx'}` が黙って `null` になると「その
プロバイダは何も見つけなかった」と区別がつかず、しかも全レーンで同時に
そうなるため。

## `yoki-agent`(1回だけのバックエンド呼び出し)

`domains/dev/bin/yoki-agent` は **`agent()` を1回だけ**実行する CLI。
中身は yoki-graph とまったく同じ経路(api.js の `agent()`)を通るので、
モデル解決・スキーマ検証とリトライ・タイムアウト・journal・実行キャップ・
usage 計上のすべてがワークフロー内の1呼び出しと同一に振る舞う。

```
yoki-agent --backend codex|omp|mock [--model <tier|id>]
    [--schema <f.json> | --schema-base64 <b64>]
    [--sandbox read-only|workspace-write|danger-full-access] [--cwd <dir>]
    [--effort <level>] [--agent-type <name>] [--timeout <ms>] [--retries N]
    [--model-map <tier>=<id>,...] [--label <text>] [--mock <file>]
    [--allow-mock] [--run-id <id>] [--dry-run]
    (--prompt-file <file> | --prompt-base64 <b64>) [--json]
```

- **exit code**: `0` 成功 / `1` 使い方の誤り(必須フラグ欠落、**知らない
  フラグ**、prompt や schema が読めない/base64 として壊れている、未知の
  backend、綴りを間違えた tier、`^[A-Za-z0-9._:/-]{1,64}$` に合わない
  `--model` / `--backend`)/ `2` バックエンド失敗(spawn 失敗・非ゼロ終了・
  リトライ後のタイムアウト・キャップ超過)/ `3` リトライ後もスキーマを
  満たさなかった。`--jsonn` のようなタイポは黙って無視されない。
- `--json` を付けると **stdout は結果 JSON だけ**(そのままパースできる)。
  解決後のモデル・トークン・cached・所要時間を1行にまとめたフッターは
  stderr に出る。付けない場合は結果もフッターも stdout。
- `--prompt-base64` / `--schema-base64` がレーンの実際の渡し方。レーンの
  payload は信用できないテキスト(diff・設計文書・取得したページ)で、
  呼び出し元は haiku の運搬 subagent なので、**payload が指示やシェル構文
  として読まれうる位置に置かれてはいけない**。base64 は argv が確定した
  あとで yoki-agent が復号するため、途中でだれも解釈しないし、一時ファイル
  も要らない(だから運搬役に書き込み権限が要らない)。
- `--run-id <既存>` で既存ランの journal に追記できる。`index` は既存の
  続きから振られ、フッターと exit code は**今回の呼び出しだけ**を報告する。
- `YOKI_AGENT_MOCK=<fixture.json>` は **`--allow-mock` と併用したときだけ**
  効き、要求された backend が何であれ mock に差し替わる(codex/omp が
  入っていない機体でレーンの配線を試すため)。環境変数だけでは何も起きず、
  無視したことを stderr に出す — レビュー対象リポジトリの `.envrc` や
  検証の消し忘れ export が、別プロバイダのレビュー結果を差し替えられては
  ならない(空の fixture は「codex は何も見つけなかった」と見分けがつかない)。
  差し替えたときはフッターに `backend=mock (requested codex)` が出るうえ、
  **stdout の結果自体に `"_mock": true` が付く**(フッターは stderr なので
  `--json` の呼び出し元には届かない)。
- **日次キャップ(`workflow-guard.sh` と共有するワークフロー起動カウンタ)は
  消費しない**。codex レーンを6本持つ review 1本は「ワークフロー起動1回」で
  あって7回ではない。ラン単位の実行キャップ(`graphMaxAgentCalls` など)は
  従来どおり効く。
- PATH に無い機体もあるので、シェルから叩くときは
  `"$(cd -P ~/.claude/skills/yoki-graph && cd ../../../../.. && pwd)/bin/yoki-agent"`
  で解決できる(下のレーンの proxy prompt もこの手順を踏む)。

## Claude Code から Codex/omp レーンを混ぜる

**これは Claude Code 内で使う機能**で、yoki-graph の CLI 機能ではない。
`review` / `research` / `design-review` に `providers` 引数が増えた:

```js
Workflow({ name: 'review', args: { providers: ['claude', 'codex'] } })
Workflow({ name: 'research', args: {
  question: '…',
  providers: ['claude', { provider: 'codex', model: 'gpt-5.6-sol' }],
} })
```

- 既定は `["claude"]`。**指定しなければ挙動は従来と完全に同じ** —
  ラベルも prompt も agent() の呼び出し列(= journal と `--resume` の
  prefix)も変わらない。
- 指定するとレーンが「次元 × プロバイダ」に増える。review なら
  `review:security` に加えて `review:security@codex/opus` が走る。
- **知らないプロバイダ名・変なモデル id はランを止める(fatal)**。以前は
  黙って捨てていたので、`["claude","codeex"]` は claude だけのランになり、
  それは既定のランと見分けがつかなかった(ログ行すら出ない)。「2社で見た」
  と思っている読み手に1社の結果を渡すのが、この機能がいちばん避けたい
  失敗。モデル id は `^[A-Za-z0-9._:/-]{1,64}$` に限る — コマンドラインに
  そのまま乗る値なので、空白や `;` が入ると1つのコマンドが2つになる。
- **なぜ proxy が要るか**: Claude Code は codex/omp を自分で起動できず、
  yoki-graph には(意図的に)claude backend が無い。そこで橋渡しとして
  安い Claude subagent(haiku・effort low・**sandbox は read-only**)を
  1つ立て、それが `yoki-agent --backend <p> --model <m> --schema-base64
  <b64> --sandbox read-only --prompt-base64 <b64> --json` を
  **1回だけ、それ以外は何もせず**実行し、返ってきた JSON を**一切言い換えず
  そのまま**返す。非ゼロ終了なら `{ok:false, error, exitCode, stderrTail}`。
  proxy は運搬役であって評価者ではない — 別プロバイダの意見を得るのが
  目的なので、要約・再スコアリング・並べ替え・自前回答はすべて禁止。
- **payload は base64 の引数で渡す**。以前は proxy の指示文の中に固定の
  `<<<YOKI_PROMPT` 区切りで貼り付けていたので、payload の中に
  `YOKI_PROMPT` の行と新しい手順を書けば、ランで最弱のモデルに対する
  トップレベルの指示として読めてしまった。いまは指示文に入るのは
  `[A-Za-z0-9+/=]` だけで、ブロックは**呼び出しごとに変わる fence**で
  囲み、payload がその fence を含んでいたらレーンの生成自体を拒否する。
  一時ファイルを作らないので proxy に書き込み権限も要らない。
- **失敗したレーンは落ちる。ただし黙っては落ちない**: `log()` に
  `review:tests@codex/sonnet: dropped — codex exec exited 1 — exit 2` の
  ような1行が出る。捏造した所見で埋めることはしない。fixture で答えた
  レーン(`--allow-mock`)も `MOCK RESULT` として1行出る。
- **Verify とマージ**: 検証(adversarial verify)は必ず Claude 側で回す —
  プロバイダに自分の審判をさせない。確定した所見は
  **file + line + title**(research は claim + source、design-review は
  claim)で重複排除し、**和集合**を残す: 両者が挙げた所見は
  `providers: ["claude","codex"]` を持つ1件にまとめ、片方しか挙げなかった
  所見はそのまま残る。所見には `provider` / `model` が付き、返り値には
  プロバイダ別にまとめた `by_provider` が入る。
- **ヘルパの正本は `core/workflows/lib/lanes.js`**。Workflow スクリプトは
  モジュールを持たない(`require`/`import`/fs いずれも不可 — 両ランタイムとも
  固定のグローバルだけを注入した素の async 関数に body をコンパイルする)ため、
  3本のスクリプトに**同一の本文をインライン複製**している。直すときは
  lanes.js を先に直してから3本に貼り直す(`lanes.test.js` が
  4つのコピーのバイト一致を検査していて、ズレると落ちる)。

## sandbox(agent() ごとの書き込み権限)

**デフォルトは `read-only`**(codex 自身のデフォルトと同じ)。
書き込む呼び出しだけがスクリプト側で明示的に要求する:

```js
await agent(prompt, { label: 'impl:t1', sandbox: 'workspace-write' })
```

- 値は `read-only` / `workspace-write` / `danger-full-access`。未知の値は
  黙って広げずエラーになる。
- `isolation: 'worktree'` は書き込み権限を**含まない** — scratch worktree で
  編集する呼び出しは `sandbox` も明示する(go-optimize.js の Propose 参照)。
- 実際に `workspace-write` を要求しているのは、編集・コミット・ビルド/テスト
  実行・レポート書き出しの段だけ。レビュー/調査/検証の段は read-only のまま
  — これらのプロンプトは diff hunk や取得した外部テキストで組み立てられる。
- どのバックエンドも黙って無視しない: codex は `-s <mode>`(ネイティブ)、
  omp は `--tools read,grep,glob,web_search` の許可リストで read-only を
  表現する。`workspace-write` / `danger-full-access` は omp では追加フラグ
  無し(それ自身の既定より広い権限が無いため)。

## journal の読み方 / `--resume` は prefix 再生

`agent()` 呼び出し1回につき1行、
`~/.local/state/yoki/graph/<runId>/journal.jsonl`
(`YOKI_STATE_HOME` があればそちら配下、なければ `XDG_STATE_HOME` — 他の
yoki state ファイルと同じ解決)に
`{gen, index, key, label, phase, status, result, tokens?, tokensSource?,
usage?, durationMs}` が追記される。`index` は呼び出しの到着順、`gen` は
その runId に対する何回目の実行か、`key` は
`sha256(prompt + JSON(opts + 解決後の backend + 解決後の model))`
(スクリプトが付けた `label` も含む)。`opts.model` だけでは足りない —
省略されてランの `--model` を継ぐことも、`--model-map` で意味が変わる
tier 名であることもあるため。これが無かった頃は、`--model` を差し替えて
`--resume` すると**別のモデルが出した答え**が再生されていた。

- `yoki-graph run` の標準出力/`--json` は `run.json`(name/backend/args/cwd/
  status/error/usage)とこの journal をそのまま反映したイベントストリーム。
  `--json` なら1行1 JSON(NDJSON)、素の実行なら人間向けの進捗行。
- `yoki-graph status <runId> [--json]` で run.json + journal 集計
  (`agentCalls`/`ok`/`errors`/`retries`/`usage`)を見る。
- **`--resume <runId>` は「順序つき prefix の再生」**であって key 引きの
  キャッシュではない。再開したランは自分の呼び出しを 0, 1, 2, … と辿り、
  journal の同じ位置に同じ key の完了エントリがある間だけ再生する。最初に
  食い違った呼び出しから先は**すべて実行される** — 途中の入力が変われば
  下流の結果は別物なので、prompt が同一でも古い結果は再利用しない。
  食い違った位置は `resume-diverged` イベント(素の実行では `↯ resume
  diverged at call #N`)で出る。
- したがって `--args` を変えて同じ runId に `--resume` しても安全:
  変わった呼び出し以降はライブで走り直る。逆に、**変えていない**ランを
  再開すると全件が再生されてバックエンドは1回も起動しない。
  `--model` / `--model-map` / 呼び出しごとの `{backend}` を変えた場合も
  同じで、影響を受けた呼び出しから先はライブで走り直る。
- 失敗した呼び出し(`status: "error"`)は再生されない — 再開すると再試行
  される。リトライ行(`status: "retry"`)も再生対象外。

## 実行キャップ(暴走防止)

日次キャップ(前節)は「その日の起動回数」の上限で、**1回のランの暴走は
止めない**。ラン単位の上限はこの3つ:

| cap | `.yoki.json` | CLI | 既定 |
| --- | --- | --- | --- |
| `agent()` 呼び出し数 | `graphMaxAgentCalls` | `--max-agent-calls` | 1000 |
| トークン | `graphMaxTokens` | `--max-tokens` | 無制限 |
| 実行時間(ms) | `graphMaxWallMs` | `--max-wall-ms` | 無制限 |

- 解決順は CLI フラグ → `.yoki.json`(`cwd` から上に探索)→ 環境変数
  (`YOKI_GRAPH_MAX_AGENT_CALLS` など)→ 既定値。値 `0` はそのキャップの無効化。
- 超過は**ハードフェイル**(ランが `status: error` で終わる)。`parallel()` /
  `pipeline()` は普通の失敗を `null` に畳むが、キャップ超過だけは畳まずに
  再送出する — `null` に落としたら暴走ループはそのまま回り続けてしまう。
- `budget.total` / `budget.remaining()` は `graphMaxTokens` を設定していれば
  実数を返す(未設定なら `null` / `Infinity`)。再生された呼び出しは
  `agent()` 呼び出し数を消費しない。

## リトライ・タイムアウト・トークン計上

- **リトライ**: バックエンドの一時障害(429、5xx、timeout、EPIPE/ECONNRESET
  など)は指数バックオフ(500ms → 1s → …、上限5s)で既定2回まで再試行する
  (`--retries N`)。`ENOENT` や不正なフラグのような「やり直しても同じ」失敗は
  1回で諦める。再試行は journal に `status: "retry"` として残る。
  これはスキーマ違反のリトライ(schema.js が1回だけ行う)とは別の層。
- **タイムアウト**: `agent(prompt, { timeoutMs })` > `--timeout <ms>` >
  既定15分。超えた子プロセスは SIGKILL され、`timedOut: true` で journal に
  記録される(タイムアウトは一時障害扱いなのでリトライ対象)。
- **トークン**: 各バックエンド自身の出力から読む — codex は `--json` の
  `turn.completed` の usage、omp は assistant レコードの `usage`。報告が
  無い場合だけ出力長からの**推定**にフォールバックし、
  `tokensSource: "estimated"` と明示する(黙って 0 にはしない)。ラン終了時に
  `tokens: N (X reported, Y estimated) — over K agent calls — M cached` の
  1行が出る。codex の課金対象は `input + output` のみで、キャッシュ分は
  加算しない(上の「モデルの指定と表示」参照)。

## 同一 runId の同時実行はロックで防ぐ

`<runDir>/lock` に pid/host/token を書いて排他する。同じ runId に2つ目の
`--resume` を掛けると `status: locked` / exit 1 で拒否され、スクリプトは
1行も走らない。プロセスが死んで残ったロックは、pid が居ない(同一ホスト)
か1時間経過で自動的に奪われる。

## delivery(commit / draft-pr)のルール

`implement.js` と `go-optimize.js` はどちらもコード上でこう明言している:

> delivery mode must be confirmed with the user BEFORE launching this
> workflow — the graph itself never asks mid-run (boundary principle:
> interactive decisions happen outside the graph, not inside a phase)

つまり `args.delivery`(`implement`: `'none' | 'commit' | 'draft-pr'`、
`go-optimize`: `'draft' | 'commit' | 'pr'`)は **`yoki-graph run` を叩く前に
ユーザーへ確認して決める** — グラフの途中で聞き返してくることは無い。
未知の値や無指定は必ず安全側(`implement` は `'none'`、`go-optimize` は
`'draft'`)にフォールバックし、`'commit'`/`'pr'` 側へは絶対に倒れない。
Codex/omp からこの2本を起動するときも同じ順番を守る: 先にユーザーの
delivery 選択を得てから `--args` に載せる。

## よくある失敗

- **Claude Code の中なのに yoki-graph に切り替える** — ネイティブの
  Workflow tool がそのまま使える。harness をまたぐ必要が無いなら回り道で、
  そもそも `--backend claude` は存在しない(拒否される)。
- **`--args` に文字列化した JSON を二重にエスケープして渡す** — 各
  スクリプトは `typeof A === 'string'` なら自分で `JSON.parse` する保険を
  持っているが、それに頼らず `--args '<JSON>'` はそのまま JSON として渡す。
- **delivery をユーザーに確認せず `implement`/`go-optimize` を起動する** —
  デフォルトは安全側に倒れるので何も壊れはしないが、意図した commit/
  draft-pr を出すには前節の順番どおり事前確認が要る。
- **`go-optimize` が `yoki-graph list` に出ないと言って直接パス指定で呼ぶ** —
  go pack が無効な機体ではそもそも `~/.claude/workflows/go-optimize.js` が
  存在しない。`yoki-switch pack enable go` が先。
- **`--dry-run` の結果を「backend 固有の動作確認ができた」と扱う** —
  `agent()` はどのバックエンドでも実プロセスを起動せずプレースホルダを
  返すだけで、backend ごとの argv や実行結果の違いはここでは見えない。
- **`WORKFLOW_GUARD_DISABLED=1` を常時 export する** — 日次キャップという
  暴走防止そのものを恒久的に無効化してしまう。単発の起動のときだけ付ける。
- **`--resume` を「変わっていない呼び出しは古い結果が返る」ものとして扱う** —
  prefix 再生なので、食い違った位置から先はすべて走り直る。`--args` を変えた
  再開でも下流に古い結果は混ざらない。
- **`status: locked` を「壊れた」と読む** — 同じ runId を別プロセスが
  掴んでいるだけ。終わるのを待つか、その pid が本当に死んでいるなら
  `<runDir>/lock` を消す(放っておいても1時間で stale になる)。
- **`tokensSource: "estimated"` の数字をコストトラッカーと突き合わせる** —
  バックエンドが usage を報告しなかった呼び出しの推定値なので、実測と
  混ぜて集計しない(表示も reported / estimated を分けている)。
- **Claude Code の「セッション内初回起動は1回だけ拒否」を CLI でも期待する** —
  yoki-graph にそのリトライループは無い(前節参照)。効くのは日次キャップ
  だけなので、初回起動がいきなり拒否されることはない(キャップ超過時を除く)。
