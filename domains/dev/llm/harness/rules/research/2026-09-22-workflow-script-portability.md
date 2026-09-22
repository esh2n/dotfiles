---
question: 一本の Claude Code 形式の workflow スクリプトが pi・omp・Codex・DSH で無変更で動くか
date: 2026-09-22
verdict: 部分的に yes — Claude Code と pi（tintinweb/pi-subagents 0.19.0、meta.phases を {title} に・model を翻訳）は一本、omp は 10 行のシム（export/args なし、per-call model なし）、Codex は実行系が無く部下は親の fork で会話を継承、DSH は未導入で未検証
unverified:
  - Claude Code 本体での meta.phases の要素型（{title} オブジェクト）は間接証拠のみ
  - DSH（未導入）
  - pi を headless で回すには pty が要る（script -q /dev/null 経由で動作、-p 単体は落ちる）
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 一本のワークフロースクリプトは何台で無変更に走るか（実機検証 2026-09-22）

検証対象: `2026-09-22-subagents-and-workflows-by-scale.md` 決定 3「スクリプトは Claude Code の
dynamic workflow の書式で一本、走らせるのは各ハーネスの実行系」の未検証項目。

実機: macOS 25.6.0 / pi 0.85.1 / omp 18.0.4 / codex-cli 0.155.1 / Claude Code（本セッション）。
DSH は未インストールのため**スキップ**（決定メモの「DSH は本体・語彙を合わせたと文書に明記」は
今回未検証のまま）。

すべて隔離スクラッチで実施。`~/.pi` / `~/.omp` / `~/.codex` / dotfiles リポジトリへの設定変更なし。

---

## 結論表

| harness | runner | CC script 無変更? | fresh context | model/tier per agent | 並列上限 | 壊れた点 | 証拠 |
|---|---|---|---|---|---|---|---|
| **Claude Code** | 本体 `Workflow` tool（`script` / `scriptPath` / `name` + `args`） | 基準 | fresh（「its own context window」） | `model`（サブエージェントの選択順に従う） | 既定 16（`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` 1–256）/ `parallel()`・`pipeline()` 1 呼び出し 4,096 件 / 1 run 1,000 agents | 今回は実行せず（課金回避）。`meta.phases` の要素の型が公開ドキュメントに書かれていない | [workflows.md](https://code.claude.com/docs/en/workflows.md) / [agent-sdk/typescript.md](https://code.claude.com/docs/en/agent-sdk/typescript.md) §Workflow |
| **pi 0.85.1 + @tintinweb/pi-subagents 0.19.0** | 拡張の `SubagentWorkflow` tool、または `--subagents-workflow-file=<path>`（LLM ターンを消費しない起動口） | **ほぼ YES**（2 点だけ要調整、下記） | **fresh（実測）** | `model`（fuzzy `haiku` も `provider/id` も可）。**`tier` は無い** | `max(1, min(16, cpus-2))` / 4,096 per call / 1,000 per run | `pi -p`（headless）では使い物にならない（下記） | 本文の実測ログ |
| **omp 18.0.4** | `eval` tool の JS カーネル（`workflowz` は起動口ではなく**プロンプトのマジックワード**） | **NO — 10 行のシムが要る** | **fresh（実測）** | **無し**（`model` は黙って無視される） | `task.maxConcurrency` | `export const meta` が `SyntaxError`、`args` 未定義、決定性ガード無し | 本文の実測ログ |
| **Codex 0.155.1** | **スクリプト実行系は存在しない**。`collab: spawn_agent` / `wait` を AGENTS.md の文章で誘導するだけ | **継承（実測）** — 子は親スレッドの **fork** | `[agents]` 既定 / custom agent ファイル / プロンプトで指定。未指定なら親を継承 | `features.multi_agent_v2.max_concurrent_threads_per_session = 4` | 同じ手順を「スクリプト」として持てない | 子スレッドの rollout JSONL |
| **DSH** | 未インストール | 未検証 | 未検証 | 未検証 | 未検証 | — | — |

---

## テストスクリプト

`review-probe.js`（Claude Code の dynamic workflow 書式、canonical）:

```js
export const meta = {
  name: 'review-probe',
  description: 'Two lanes read README.md in parallel, a third agent merges them',
  phases: [{ title: 'Lanes' }, { title: 'Merge' }],
}

const MODEL =
  typeof args !== 'undefined' && args && args.model ? args.model : 'haiku'

const laneSchema = {
  type: 'object',
  required: ['lane', 'finding'],
  properties: { lane: { type: 'string' }, finding: { type: 'string' } },
  additionalProperties: false,
}

const ask = (lane) =>
  `Answer with JSON only: lane="${lane}", finding=one sentence about the file README.md in the current working directory.`

phase('Lanes')
log('probe: two lanes starting')

const lanes = await parallel([
  () => agent(ask('alpha'), { label: 'alpha', phase: 'Lanes', schema: laneSchema, model: MODEL }),
  () => agent(ask('beta'),  { label: 'beta',  phase: 'Lanes', schema: laneSchema, model: MODEL }),
])

phase('Merge')

const merged = await agent(
  `Merge these two lane findings into one. Answer with JSON only: lane="merged", finding=one sentence. Findings: ${JSON.stringify(lanes)}`,
  { label: 'merge', phase: 'Merge', schema: laneSchema, model: MODEL },
)

return { model: MODEL, lanes, merged }
```

付随プローブ:
- `context-probe.js` — 各レーンが「自分の context で見える最古の user message の先頭 120 文字、
  無ければ NONE」をファイルに書く。fresh context の直接証拠。
- `evidence-probe.js` — 各レーンが `date +%s` で start/end を書く。並列実行の直接証拠。

Claude Code のローダ規則（`meta` は先頭の純リテラル、body は async 関数本体＝トップレベル
`await` と裸の `return` が合法、`import()` 禁止、`Date.now()`/`Math.random()`/`new Date()` は throw）
に対して静的検証済み: `meta` は空 vm context で評価でき、body は `async` ラップで構文 OK、
禁止構文なし。

---

## 1. pi（tintinweb/pi-subagents）

### 拡張 3 本の比較（README / GitHub API 実測、2026-09-22）

| | tintinweb/pi-subagents | QuintinShaw/pi-dynamic-workflows | nicobailon/pi-subagents |
|---|---|---|---|
| ★ | 1,208 | 535 | 3,737 |
| last push | 2026-09-03 | 2026-09-20 | 2026-09-22 |
| open issues | 114 | 1 | 12 |
| license | MIT | MIT | MIT |
| install | `pi install npm:@tintinweb/pi-subagents`（`pi -e ./src/index.ts` でも可） | `pi install npm:@quintinshaw/pi-dynamic-workflows` | `pi install npm:pi-subagents` |
| CC スクリプト無変更 | **明言**「A script written for Claude Code's `Workflow` tool runs here unchanged」。互換テスト `test/workflow-claude-code-compat.test.ts` が CC のツール説明にある `review-changes` 例を**逐語で**回す | 「How it maps to Claude Code dynamic workflows」= **対応表**。無変更とは言っていない | **該当なし**。CC スクリプトのランナーではなく非同期サブエージェント委譲 |
| globals | `agent` `pipeline` `parallel` `workflow` `phase` `log` `args` `budget` | `agent` `parallel` `pipeline` `phase` `log` `args` | — |
| per-agent model | `model`（`provider/modelId` または fuzzy） | `model` **と** `tier`（`small`/`medium`/`big`、`~/.pi/workflows/model-tiers.json`） | 別系統（role ごとの override） |
| 並列上限 | `max(1, min(16, cpus-2))` | 16 にクランプ、1 run 1,000 | `maxSubagentSpawnsPerRun` 既定 64 |
| 既知の差分 | `budget.total` は常に `null`（pi にトークン目標の指示が無いため。CC の `budget.total` ガードは「発火しない」形で素通り）。`workflow()` のネストは 1 段 | 位置インデックスでの journal replay は CC と同契約 | — |

→ **CC スクリプトを走らせる用途では tintinweb 一択。** QuintinShaw は `tier` を持つが「無変更で走る」
とは主張していない。nicobailon は星は一番多いが別カテゴリ（決定メモが 3 本を並べて「pi に部下の
機構がある」証拠にしたのは正しいが、「一本のスクリプト」を走らせられるのは tintinweb だけ）。

**決定メモの訂正点**: 決定メモ Consequences は「pi 拡張 `tier`」と書いているが、
採用候補である tintinweb の `agent()` に `tier` オプションは**無い**（`label` `phase` `model`
`agentType` `isolation` `gate` `resume` `effort` `schema` のみ）。`tier` を持つのは QuintinShaw 版。

### インストール（`~/.pi` 非改変）

```
npm install @tintinweb/pi-subagents   # スクラッチの package.json 配下
pi -ne -e <scratch>/node_modules/@tintinweb/pi-subagents/src/index.ts ...
```

`-ne`（拡張の自動探索を切る）+ `-e`（明示ロード）で、`~/.pi/agent/settings.json` に一切触れずに
ロードできた。`npm pack` だけでは依存（`croner` 等）が無く
`Cannot find module 'croner'` で失敗するので `npm install` が必要。

### 実行結果

**成功したのは pty 経由（`script -q /dev/null pi ... --subagents-workflow-file=<path>`）。**
この経路は LLM ターンを一切使わずセッション開始時にスクリプトを走らせる。

`review-probe.js`（`model` をこの機械にあるモデルへ差し替えた版、他は無変更）:

```
▸ SubagentWorkflow  review-probe                         3/3 agents · 23s · done
  Two lanes read README.md in parallel, a third agent merges them
  ╭─ Lanes
  │ ├─ ✔ alpha · general-purpose · gpt-5.5 · 22.2k · 2 tool calls · 12s
  │ └─ ✔ beta  · general-purpose · gpt-5.5 ·  3.0k · 2 tool calls · 14s
  ╰─ Merge
    └─ ✔ merge · general-purpose · gpt-5.5 ·  2.2k · 1 tool call  ·  9s
  ⎿  probe: two lanes starting
```

- **走った**: 3/3 agents、wall 23s、27.4k tokens。
- **並列**: 進捗行が 0s〜12s の間ずっと `0/2 agents` → 12s で `1/2` → 14s で `2/3`。
  2 レーンが同時に走り、`parallel()` のバリア後に merge が始まっている。
- **`schema` 検証が効いた**: 各レーン 2 tool calls（bash + 構造化出力）で、スクリプトは
  素のテキストではなく検証済みオブジェクトを受け取り、それを merge プロンプトへ内挿できた。
- **`meta.phases` 通りにフェーズが描画**（`╭─ Lanes` / `╰─ Merge`）、`log()` も表示。
- **per-agent `model` が効いた**: 各行が解決後のモデル名を表示（tintinweb のドキュメント曰く
  「read back from its session once pi has resolved its defaults」）。

`context-probe.js`（同じ経路）:

```
├─ ✔ alpha · general-purpose · gpt-5.5 · 3.0k · 2 tool calls · 12s
└─ ✔ beta  · general-purpose · gpt-5.5 · 3.0k · 2 tool calls · 15s
alpha.ctx: NONE
beta.ctx:  NONE
```

→ **fresh context 確認**。子は親会話の最古 user message を見ていない。

さらに強い証拠として、子エージェントのセッション JSONL を直接読んだ
（`~/.pi/agent/sessions/<cwd スラグ>/*.jsonl`、検証後に削除）。
**各子セッションの最初の user message は `agent()` に渡したプロンプトそのもので、それ以外は何も無い**:

```
…-7fb9-….jsonl | model: [('openai-codex','gpt-5.5')] | n_user: 2
   user[0]: "Step 1: run this one bash command, … > alpha.ctx\nStep 2: answer…"
   user[1]: "You did not call StructuredOutput, so your answer was not recorded. …"
…-35c4-….jsonl | model: [('openai-codex','gpt-5.5')] | n_user: 1
   user[0]: "Answer with JSON only: lane=\"alpha\", finding=one sentence about the file README.md …"
…-6a94-….jsonl
   user[0]: "Merge these two lane findings into one. … Findings: [{\"lane\":\"alpha\",\"finding\":\"…\"},…"
```

ここから 3 つ分かる:
- **fresh context**（親の会話は子の transcript に一切入っていない）。
- **`schema` の実装は `StructuredOutput` ツール**で、呼ばなかった子には
  「You did not call StructuredOutput, so your answer was not recorded.」という追い打ちが入る。
- レーン 2 本の子セッションのファイル名タイムスタンプが `14-38-08-825Z` と `14-38-08-842Z`
  （**17 ms 差**）＝ `parallel()` が同時に起動している。

### pi で壊れた点（3 つ、すべて具体）

1. **`meta.phases` の要素は文字列ではなくオブジェクト。**
   `phases: ['Lanes', 'Merge']` を渡すと
   `[pi-subagents] meta.phases[0] must be an object with a title.`
   で拒否される（警告扱いで run 自体は続く＝フェーズだけ落ちる）。正しくは
   `phases: [{ title: 'Lanes' }, { title: 'Merge' }]`。
   **Claude Code の公開ドキュメントはこの要素型を書いていない**
   （workflows.md は「give each entry exactly the title you pass to `phase()`」、
   SDK リファレンスは「An optional `phases` array in `meta`」まで）。
   tintinweb は CC の移植でありその互換テストが CC の例を逐語で回しているので、
   CC 側も `{title}` オブジェクトだと考えるのが妥当だが、**一次資料では確認できていない**。
   一本のスクリプトを書く前に Claude Code 側で 1 回確かめるべき唯一の未解決点。

2. **`model` の文字列は移植可能でない。**
   canonical スクリプトをそのまま（`model: 'haiku'`）走らせると、この機械には Anthropic の
   モデルが無いため **3 エージェント全部が 56ms で失敗**する:
   ```
   ▸ SubagentWorkflow  review-probe  0/3 agents · 56ms · done
     ╭─ Lanes
     │ ├─ ✘ alpha · general-purpose · haiku
     │ └─ ✘ beta  · general-purpose · haiku · 1ms
     ╰─ Merge
       └─ ✘ merge · general-purpose · haiku
   ```
   スクリプト本体は無変更で通るのに**モデル名だけが通らない**。
   決定メモ 4 の「jig は `tiers.json` を各ハーネスの書式へ翻訳する」は、この 1 行のためにある。
   スクリプトは `args.model` 経由で受け取る形にしておくのが実務的
   （`args` は CC・tintinweb 双方にあり、実測で機能した）。

3. **`pi -p`（headless）ではワークフローの結果が取れない。**
   - `pi -p --subagents-workflow-file=...` は起動直後に
     `Error: This extension ctx is stale after session replacement or reload`
     （`@earendil-works/pi-coding-agent` の `assertActive` → 拡張 `src/index.ts:2719` の `appendEntry`）
     でプロセスごと落ちる（exit 1）。pi 0.85.1 + 拡張 0.19.0 の組み合わせのバグ。
   - `pi -p` からモデルに `SubagentWorkflow` を呼ばせる経路は起動はする
     （`scriptPath` + `args` を受け付け run id を返す）が、run は常にバックグラウンドで、
     ターンが終わるとプロセスが終了して run ごと死ぬ。5 回中 1 回だけ 320s 待ったが
     再現しない（他は 8〜9s で終了、ディスクにマーカーが 1 つも残らなかった）。
     `--session-dir` にも run の journal は書かれない。
   - **pty を与えれば `--subagents-workflow-file=` は完全に動く**（上記の成功ログ）。
     CI / jig から回すなら pty 必須。
   - 副作用: 子エージェントのセッションは `--session-dir` を無視して
     `~/.pi/agent/sessions/<cwd スラグ>/` にディレクトリを作る（今回は空ディレクトリのみ生成、
     検証後に削除）。

---

## 2. omp

### `workflowz` は起動口ではない

`omp --help` にサブコマンドは無い（`omp workflowz` も `omp eval` も `omp launch` にフォールバックする）。
`docs/magic-keywords.md` によれば `workflowz` は**プロンプト中の単語**で、
「`eval` カーネルの `agent()` / `completion()` / handle / `wait()` / `workpool()` を中心にした
決定的マルチサブエージェント契約」を注入するだけ。実行系は `eval` tool の JS カーネル。
つまり **omp には「スクリプトファイルを渡すランナー」が無い**。モデルに `eval` を呼ばせるのが唯一の口。

### 実測した globals（`eval` の js セル内）

```json
{
  "globals": ["agent=function","parallel=function","pipeline=function","phase=function",
              "log=function","args=undefined","budget=object","workpool=undefined",
              "completion=function","wait=undefined","workflow=undefined",
              "display=function","read=function","tool=object"],
  "determinism": { "dateNow": "number", "mathRandom": "number" },
  "wholeFileParse": "SyntaxError: Unexpected keyword 'export'",
  "bodyOnlyParse": "ok",
  "agentShape": { "returnedType": "string", "keys": null, "hasWait": false }
}
```

**ドキュメントより実装のほうが CC に近い。** `docs/tools/eval.md` は prelude helper として
`completion(...)`, `agent(...)`, `wait(...)`, `workpool(...)`, `log`, `phase`, `budget` しか挙げず、
`agent()` は「`AgentHandle` を即時に返す」と書いているが、実機では:

- `parallel` と `pipeline` が**実在する**（ドキュメント未記載）。
- `await agent(prompt, opts)` は**文字列（`schema` 付きならオブジェクト）を直接返す**。
  ハンドルではない＝CC と同じセマンティクス。
- `workpool` と `wait` は**このセルからは見えなかった**（`undefined`）。

### Claude Code スクリプトとの差分（正確に 4 点）

| # | 差分 | 影響 |
|---|---|---|
| 1 | `export const meta = {...}` が `SyntaxError: Unexpected keyword 'export'` | **致命**。セルは module ではないので meta ブロックを剥がす必要がある |
| 2 | `args` が `undefined` | パラメータ化されたスクリプトが `args.model` 等で落ちる。シムで注入 |
| 3 | `agent()` に **per-call `model` が無い**。`model:'no-such-model-xyz'` を渡しても throw せず、素知らぬ顔で親のモデルで実行された（`"bogusModel": "\"PONG\""`）。`docs/tools/eval.md`:「the selected agent's frontmatter model and settings always apply (no per-call `model`)」 | **決定メモ 5 の「部下の既定は安い層」が omp では `agent()` から指定できない**。安いモデルを指定できるのは `completion()`（`model: "smol"/"default"/"slow"` の tier）だけで、これはツール無しの一発完了。モデル階層をやるなら omp 側は agent frontmatter か `task.agentModelOverrides` で持つしかない |
| 4 | `Date.now()` / `Math.random()` が **throw しない** | CC/tintinweb は決定性のため throw させる。omp では replay の同一性が保証されない |

### シム（10 行）

```js
// cc-shim.js — run a Claude Code workflow script inside omp's eval kernel
const fs = require('fs');
const src = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const open = src.indexOf('{');
const close = src.indexOf('\n}') + 2;
const meta = (0, eval)('(' + src.slice(open, close) + ')');
const body = src.slice(close);
globalThis.args = WORKFLOW_ARGS;
const run = new Function('agent','parallel','pipeline','phase','log','args','budget',
  'return (async () => {' + body + '})()');
display({ meta, out: await run(agent, parallel, pipeline, phase, log, globalThis.args, budget) });
```

`phase` と `log` はそのまま omp の同名 global に通る。`parallel(thunks)` もそのまま。

### 実行結果（シム経由、canonical `review-probe.js` 無変更）

```json
{ "meta": { "name": "review-probe", "phases": [{"title":"Lanes"},{"title":"Merge"}] },
  "out": { "model": "openai-codex/gpt-5.6-luna",
           "lanes": [ {"lane":"alpha","finding":"README.md is a minimal probe fixture ..."},
                      {"lane":"beta", "finding":"README.md is a small probe fixture ..."} ],
           "merged": {"lane":"merged","finding":"README.md is a minimal probe fixture ..."} } }
```

wall 44.3s。**`schema` が効いている**（プロンプトは「JSON で答えろ」と言っているだけだが、
返ってきたのは検証済みオブジェクトで、`lanes` をそのまま merge プロンプトへ内挿できた）。

`evidence-probe.js`（ディスクにタイムスタンプを書く版）:

```
alpha.start: 1790087677   beta.start: 1790087679
alpha.end:   1790087695   beta.end:   1790087697
```
区間が重なる → **並列実行を実測で確認**。

`context-probe.js`: 親のターンに `PURPLE-OTTER-4417` を置いた上で、両レーンとも
`alpha.ctx: NONE` / `beta.ctx: NONE` → **fresh context 確認**。

（注: 先に「SENTINEL がプロンプトに現れるか」で試した版は、そのトークンが
`evidence-probe.js` 自身に書かれていたため両方 `SEEN` になり無効だった。
親に何も置かない対照群も `SEEN` を返したことで設計ミスを検出し、
「見える最古の user message を書き出す」方式に作り直した。）

### 隔離

`PI_CODING_AGENT_DIR=<scratch>` で agent ディレクトリ（settings / sessions / auth）を分離できた
（`docs/environment-variables.md`: 「Full agent-directory override for the default profile only」）。
`--profile` は `~/.omp` 配下に作られるので今回は使わなかった。
`~/.omp/logs` と `~/.omp/cache` は分離できない（`PI_CONFIG_DIR` は home 直下の**ディレクトリ名**
しか変えられない）。

---

## 3. Claude Code（構文検証のみ、実行せず）

`https://code.claude.com/docs/en/workflows.md` と
`https://code.claude.com/docs/en/agent-sdk/typescript.md` §Workflow に対して静的に検証:

- `export const meta` が先頭の純リテラル → 空 vm context で評価でき、`{name, description, phases}` を得る。
- body は async 関数本体として構文 OK（トップレベル `await` + 裸の `return`）。
- `import()` / `Date.now()` / `Math.random()` / `new Date()` を含まない。
- `parallel()` の意味論: workflows.md 「`parallel()` runs a set of agent tasks at the same time and
  waits for all of them」。tintinweb の移植ドキュメントも `await parallel(thunks)` = バリア、
  `await pipeline(items, ...stages)` = バリア無し、と同じ定義。
- `schema`: 「If you pass a `schema` on an `agent()` call, that subagent returns JSON matching the
  shape instead of prose」。矛盾スキーマは起動前に検出、検証失敗は 5 回リトライ
  （`MAX_STRUCTURED_OUTPUT_RETRIES`）。
- `model`: workflows.md 「A model the script names for a stage counts as the per-invocation model
  in that order」。オプション名そのものは公開ドキュメントに出てこない（`/workflow-authoring`
  バンドルスキルが一次資料だが、この機械のディスク上には見つからなかった）。

**pi / omp の実行と食い違った点**: `meta.phases` の要素型のみ（上記 pi の壊れた点 1）。
それ以外（`parallel` がバリア、`schema` が検証済みオブジェクトを返す、`phase`/`log`/`args`、
裸の `return`）は 3 者で一致した。

---

## 4. Codex

### 設定（`~/.codex/config.toml`、読むだけ）

```toml
[features]
hooks = true
multi_agent = true

[features.multi_agent_v2]
max_concurrent_threads_per_session = 4
```

決定メモの「Codex は 4」と一致。

### ドキュメントは context について沈黙している

`https://learn.chatgpt.com/docs/agent-configuration/subagents` が「継承する」と書いているのは
**model / `model_reasoning_effort` / sandbox policy / permission mode / `skills.config`** だけ:

> If you don't configure a subagent model or `model_reasoning_effort`, the subagent inherits the
> parent agent's model and reasoning effort.
> Subagents inherit your current sandbox policy.
> Subagents inherit the permission mode selected beneath the composer.

会話コンテキストについては一文も無い。`Agent thread: The thread where a subagent does its work`
と書くだけで、そのスレッドが親の続きなのか新規なのかを言わない。
動機として挙がっているのは "context pollution" / "context rot"（＝**子の出力が親を汚さない**）で、
**親の内容が子に入るかどうか**ではない。

### 実測: 子は親スレッドの fork で、親の会話を見ている

隔離した `CODEX_HOME`（`auth.json` のコピー + 最小 config）で `codex exec --json` を実行。
親のターンに `SENTINEL-7Q4X9` を置き、子には**そのトークンを含まないプロンプト**を渡すよう指示。

子スレッドの rollout `~/…/sessions/2026/09/22/rollout-…-01a0c976-78e3-….jsonl` の中身:

```json
{"session_id":"01a0c976-565f-…","id":"01a0c976-78e3-…",
 "forked_from_id":"01a0c976-565f-…","parent_thread_id":"01a0c976-565f-…", …}
```

そして**子自身の rollout の中に親の user message がそのまま入っている**（子のプロンプトより前）:

```json
{"type":"message","role":"user","content":[{"type":"input_text",
 "text":"The secret sentinel for THIS conversation is SENTINEL-7Q4X9. Remember it but never
         write it out again.\n\nNow spawn exactly one subagent. …"}]}
```

`grep -c SENTINEL-7Q4X9 <子の rollout>` → 3。
子の最初の assistant メッセージは
「I'm checking the available agent-spawn capability, then I'll run exactly one subagent…」
＝**親への指示に反応している**。子の最初のリクエストは `cached_input_tokens: 16128` で
親のプレフィックスキャッシュを再利用している。

再帰は止まっている: 子が `exec` で `ALL_TOOLS` を絞り込み、spawn 系のツールが無いことを確認して
「no subagent tool is available in this environment」で終わった。

**結論: Codex のサブエージェントは fresh ではなく、親スレッドの fork（会話を継承）。**
これは Claude Code / pi / omp の 3 者（いずれも fresh を実測）と唯一逆。

なお `codex exec` の非対話でもサブエージェントは動く（spawn → `pending_init` → `completed` を確認）。
ただし挙動は安定せず、同じプロンプトで `collab: SpawnAgent` すら呼ばずに
「I can't spawn a subagent in this environment」と答える回が 2/4 あった。

---

## 決定メモへの反映候補

1. **決定 3「一本で本当に五つで動くか」→ 部分的に YES。**
   Claude Code / pi（tintinweb）で一本、omp は 10 行のシム、Codex は不可（文章で誘導するだけ）。
   DSH は未検証。メモの「動かないハーネスには薄い変換を作る（Codex と omp が候補）」は
   omp については当たり（シムは実測で動いた）、Codex については**変換では埋まらない**
   （ランナーが無く、かつ子が fresh でない）。
2. **Consequences の「未検証: Codex の部下が fresh か継承か」→ 継承（fork）。実測済み。**
3. **Consequences の「pi 拡張 `tier`」は誤り。** tintinweb は `model` のみ。
   `tier` を持つのは QuintinShaw 版で、そちらは「無変更で走る」とは主張していない。
4. **決定 5「部下の既定は安い層」は omp で実現できない。**
   `eval` の `agent()` に per-call model が無く、指定しても黙って無視される。
   omp でモデル階層をやるなら agent frontmatter / `task.agentModelOverrides` 側。
5. **`model` 文字列は jig が翻訳しないと pi で全滅する**（`model:'haiku'` → 3/3 失敗、56ms）。
   スクリプト側は `args.model` を読む形にしておくと、Claude Code と pi の両方で機能する。
6. **`meta.phases` の要素型を Claude Code 側で 1 回確認すること。**
   `[{title}]` が正しいという間接証拠（tintinweb の逐語互換テスト）しか今回は取れていない。
7. **pi を headless から回すなら pty が要る。** `pi -p` は結果を返さず run ごと落とす。

## 検証コマンド（再現用）

```
# pi（~/.pi 非改変、pty 必須）
npm install @tintinweb/pi-subagents           # スクラッチ
( sleep 200 ) | script -q /dev/null pi -ne -e <scratch>/node_modules/@tintinweb/pi-subagents/src/index.ts \
    --session-dir <scratch>/pi-sessions --model openai-codex/gpt-5.5 --thinking off --approve \
    --subagents-workflow-file=<cwd>/review-probe.js

# omp（PI_CODING_AGENT_DIR で隔離）
PI_CODING_AGENT_DIR=<scratch>/omp-agent omp -p --model openai-codex/gpt-5.6-luna \
    --thinking off --auto-approve --no-session < /dev/null "<cc-shim を eval で回す指示>"

# codex（CODEX_HOME で隔離、auth.json はコピー）
CODEX_HOME=<scratch>/codex-home codex exec --json -m gpt-5.6-luna --skip-git-repo-check "<prompt>" < /dev/null
# 子の rollout: <scratch>/codex-home/sessions/YYYY/MM/DD/rollout-*-<child thread id>.jsonl
```
