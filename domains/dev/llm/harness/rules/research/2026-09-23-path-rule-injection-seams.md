---
question: "Claude Code の `paths:` 付き条件ルール(該当グロブのファイルに触れたときだけ本文を文脈に入れる)と同じ意味を、Codex / omp / pi / DSH で実現する『口』は各ハーネスに存在するか — フックや拡張が (1) ツール呼び出しのファイルパスを受け取れるか、(2) その場でモデルの文脈に本文を追加できるか(additionalContext / system prompt 追記 / tool result への付加のどれか)、(3) 一度入れたものをセッション内で重複させない手段があるか。口が無いハーネスでは、業界は言語別の条件ルールをどう届けているか。"
date: 2026-09-23
verdict: "4ハーネスとも(1)パス受け取りは全部YES。(2)文脈追加の口はCodex(hookSpecificOutput.additionalContextがPreToolUse/PostToolUse両方に文書化されている、ただし自前でglobマッチを書く必要がある)・omp(tool_result content patchは常時可能、TTSRのglobs+condition/astCondition/question併用時のみ真に自動発火)・DSH(dsh-agent-instructionsネイティブプラグインがtool-call経由のディレクトリ到達で自動発火、ただしdsh-hooks-claude-codeブリッジはPreToolUseのadditionalContextを明示的に握りつぶす)にはある。piだけは tool_call がinputの書き換え/ブロックしかできず、文脈追加は tool_result のcontent patchという未使用の理論的な口のみで公式/実地とも実装例ゼロ。(3)重複抑止はomp(repeatMode+ルール名dedup+resume復元)とDSH(SHA-1コンテンツダイジェストで未変更パスは二度と注入しない)がベンダー実装として持つ唯一の2つ、Codexとpiは自前実装が必須。"
unverified:
  - "Codexの`hookSpecificOutput.additionalContext`を条件付きで返すPreToolUse/PostToolUseフックスクリプトの実例(gh code search 7,728件中、個別に開いて配線を確認したものはゼロ)"
  - "dsh-hooks-claude-codeブリッジが実際にtool_inputへfile_pathを渡すかどうかのソースレベル確認(README記述のみで`src/index.ts`は未読)"
  - "ompのTTSR `globs`+`condition`併用による実運用リポジトリの実例(ドキュメント記述のみ、2026-09-23記録から継承する既知の欠落)"
  - "Codexの`additionalContextLimit`(既定2,500トークン)とClaude Codeの`paths:`予算(1,000パターン/4MiB)を同条件で比較した実測"
sources_note: "URLとverbatim引用は本文中。直接fetchはdirect、要約経由はlane、ローカルにインストール済みパッケージのREADMEはdirect(local)と明記。"
---

# `paths:`相当の文脈注入の口 — Codex / omp / pi / DSH 個別精読

前提として読んだ既存記録(再調査しない、結論の出発点として使う):

- `rules/research/2026-09-23-per-language-hooks-and-rule-delivery.md` §1.4/§1.5/§1.6/§(d) — Claude Codeの`paths:`はv2.1.198+のネイティブ自動発火、ompの`globs`はadvisory止まり(TTSR併用で自動化可)、Codexのhookマッチャーはツール名のみでパス次元が無い、piの`tool_call`は`event.input.path`を受け取れるが公式サンプルはadvisory実装のみ、ネストAGENTS.mdが唯一の横断代替。本記録はこの4行の「一段深く」を掘る——(1)パス受信、(2)文脈追加の口、(3)重複抑止という3つの未回答の仕組みを、ハーネスごとに1段深く検証する。DSHは前回「未調査」のまま残されていたので、本記録で初めて一次資料に当たった。

現地事実として読んだjigのアダプタ(発注者から検証済みとして提供、再導出しない):

- `jig/adapters/omp/src/{index,guard,session}.ts` — omp向けは`tool_call`(guard、block/reason/ask/undefinedのみを返す)・`tool_result`(format、フォーマッタの実行のみ)・`session_start`・`session_stop`の4フック。**jig自身のomp guardは`tool_result`のcontent patchも`before_agent_start`のmessage注入も使っていない** — jigがompに実装しているのは許可判定だけで、文脈注入の口は使われていない。
- `pi/extensions/{guard,skill-router}.ts` — guardは`tool_call`でblock/reason/undefinedのみ返す(pathは読むが文脈には使わない)。skill-router.tsは`before_agent_start`から`{ message: { customType, content, display: false } }`を返す——これはpi公式ドキュメントの「`systemPrompt`はキャッシュを壊す、messageはキャッシュ中立」という設計に沿った実装で、prompt-submit時点の文脈注入の実例そのものだが、**トリガーはプロンプトのテキストであってファイルパスではない**。piでツールコールのパスをトリガーに文脈を足す実装はjig自身のコードにも存在しない。
- `jig/adapters/dsh/src/index.ts` — dshの`tools/pre-execute`waterfallに乗る許可判定のみ。`exec.arguments`からpathを含む引数一式は読めるが、jigはそれを許可判定にしか使わず、文脈注入はしていない。
- `jig/src/domain/codex/register.ts` — jigがCodexに登録しているのは`PreToolUse`グループ1つ(guard)のみ。`hookSpecificOutput.additionalContext`を使うグループは登録していない。

**含意**: jig自身は4ハーネスのどこでも文脈注入の口をまだ使っていない。以下の調査は「ハーネスが口を持っているか」であって「jigが使っているか」ではない——jigのコードを根拠にしない、という調査四原則どおり、jigの不在を「口が無い」の証拠として扱わない。

---

## 1. Codex — 一次資料で確定(前回のlane要約を上書き)

(direct, https://learn.chatgpt.com/docs/hooks — `curl`で直接取得したHTMLから`additionalContext`の22箇所全出現を抽出して精読。前回記録の同URLはWebFetch要約=lane扱いだった。今回はdirectで確認できたので、前回の「UserPromptSubmit/SessionStart限定かのように読める」という要約の不確かさを解消する。)

### (1) パス受信 — YES、`tool_input.file_path`が確認できる

引数テンプレートの例として、ドキュメントは次を挙げる:

> "For an event containing `{"tool_input":{"file_path":"src/main.rs","count":3}}`, this argument template: `{ "path": "${tool_input.file_path}", "count": "${tool_input.count}", "message": "Scanning ${tool_input.file_path}" }`"

`tool_input.file_path`というフィールド名がドキュメント自身の例に現れる——Codexのフックイベントはファイルパスを受け取れる。

### (2) 文脈追加の口 — YES、PreToolUseとPostToolUse両方に`hookSpecificOutput.additionalContext`が明記されている

前回記録は「PreToolUse/PostToolUseに存在するかは要約が曖昧」という状態だったが、HTML内の実例コードブロックを直接読むと、5イベント全部(SessionStart, SubagentStart, PreToolUse, PostToolUse, UserPromptSubmit)に同じ形の例がある。PreToolUseの例:

> "To add model-visible context without blocking, return `hookSpecificOutput.additionalContext`:"
> ```json
> { "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "The pending command touches generated files." } }
> ```

PostToolUseの例も同型で、地の文が続く:

> "That `additionalContext` text is added as extra developer context."

さらに`additionalContextLimit`という予算フィールドがあり、既定値と挙動が明記される:

> "Omit `additionalContextLimit` to use the default `2500`-token threshold. Use a positive integer to select a different threshold, or `0` to pass the handler's complete additional context directly to the model. ... For events that can't produce additional context, Codex ignores `additionalContextLimit` and reports a configuration warning."

**結論**: Codexの`PreToolUse`/`PostToolUse`ハンドラは、(1)で確認した`tool_input.file_path`を読み、ハンドラ自身(シェルスクリプト等)の中でglobマッチを行い、マッチしたときだけ`hookSpecificOutput.additionalContext`を返す——という実装が仕様として成立する。「Codexのフックmatcherにパス次元が無い」(前回記録の結論、本記録でも§1.4の直接引用で再確認済み——マッチャーはツール名のみで、パスでのフィルタはどのイベントにも無い)は変わらないが、**マッチャーの外側、ハンドラの中身でなら`paths:`相当は組める**——ただしハーネスが自動でやってくれるのではなく、フックスクリプトの作者が自分でglobマッチのコードを書く必要がある。前回記録の結論「Codexには存在しない」は、正確には「マッチャーには無いが、ハンドラの中でなら作れる」に訂正が要る。

### (3) 重複抑止 — 仕組みなし(自前実装が前提)

ドキュメント全体を検索したが、同じ`additionalContext`を二度注入しないための仕組み(dedup、once、repeat-gap相当)への言及は見つからなかった [negative]。`additionalContextLimit`はサイズ予算であって重複抑止ではない。Codexのフックはコマンド呼び出し(多くはワンショットプロセス)なので、重複抑止をしたければハンドラ自身が状態ファイル(例:`~/.codex/state/injected-paths.json`)を読み書きする以外に手段がない。

### 補足: `~/.codex/rules/*.rules`は許可専用、AGENTS.mdはネストを連結する

(direct, https://learn.chatgpt.com/codex/agent-configuration/rules)

> "Use rules to control which commands Codex can run outside the sandbox." ... `prefix_rule(pattern=[...], decision="allow"|"prompt"|"forbidden", justification=..., match=[...], not_match=[...])`

`.rules`はシェルコマンドの許可/確認/禁止だけを扱うStarlark DSLで、ファイル内容やモデル文脈には一切関与しない——前回記録の「rules/は許可専用」という推測を一次資料で確定させる。

(direct, https://learn.chatgpt.com/codex/agent-configuration/agents-md)

> "Codex builds an instruction chain when it starts (once per run) ... Merge order: Codex concatenates files from the root down, joining them with blank lines. Files closer to your current directory override earlier guidance because they appear later in the combined prompt."

これは一般的なAGENTS.md仕様の「最も近いファイルが優先」(前回記録§1.7)より具体的で、Codexの実装は「最も近いものだけ読む」のではなく**ルートからcwdまでの全階層を連結**する。さらに"once per run"——セッション開始時に一度組み立てられるだけで、Claude Codeの`paths:`のようにセッション中にファイルを読むたびには再発火しない静的な仕組み。

---

## 2. omp — advisoryとTTSR自動発火の境界を精密化、重複抑止を確定

(direct, `raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md` と `docs/ttsr-injection-lifecycle.md`)

### (1) パス受信 — YES、TTSRは複数の経路でパスを再構成している

`tool_call`イベントの`input`にパスが乗ることは前回記録で確定済み。本記録で新たに確認したのは、TTSRのストリーミング監視自体がパスを積極的に再構成している点:

> "the match context's file paths prefer the tool's `matcherPaths(args)` hook — edit strategies surface paths embedded in the wire payload (hashline `[path#TAG]` section headers, apply_patch `*** Add/Update/Delete File:` envelope markers) ... falling back to the generic top-level `path`/`paths` argument scan"

マルチファイル編集は「ファイルごとに」評価される: "Multi-file hashline/apply-patch calls are split into separate `{ path, digest }` entries, so AST language, path scope/globs, buffers, and matching are evaluated per file."

### (2) 文脈追加の口 — 2つある。1つは常時使える手動の口、もう1つはTTSRの自動の口

**手動の口(常時使える)**: `tool_result`ハンドラは"post-exec, may patch content/details/isError"——ツール結果のcontentを書き換えられ、これはモデルに見える。`tool_call`と`tool_result`は同じツール呼び出しに対応するので、「`tool_call`でパスを見て、対応する`tool_result`のcontentに条件付きでルール文を足す」実装は技術的に成立する。jig自身のompアダプタはこれを使っていない(§前置き参照)。

**自動の口(TTSRのglobs+condition/astCondition/question併用時のみ)**: 前回記録は「`globs`だけでは自動発火せずadvisory止まり」と結論したが、これは正確には「ルールブックの選定条件としてのglobs」の話であって、TTSRルール登録時のglobsは別の扱いを受ける:

> "If a TTSR rule defines `globs`, those globs are compiled as a global file-path gate for matching."

TTSRルールは`condition`(正規表現)・`astCondition`(ast-grep)・`question`(判定モデル問い)のいずれかが無いと登録自体が拒否される("Registration is skipped when: ... `rule.condition`, `rule.astCondition`, and `rule.question` are all absent")——つまり**globsだけのTTSRルールは存在できない**。しかしglobs+condition(またはastCondition/question)を両方満たせば、そのルールは`checkDelta()`/`checkSnapshot()`/`checkAstSnapshot()`によって**ストリーミング中に自動的にマッチし、`agent.abort()`で割り込み、コンテキストを注入する**——これはClaude Codeの`paths:`より能動的(ストリーム割り込みまでする)で、正確には"globsだけなら advisory、globs+条件なら自動発火"という二段構えが実態。前回記録の「advisory止まり」は"rulebook"バケツ(globsのみ、条件なし)についてのみ正しく、TTSRバケツ(globs+条件必須)には当てはまらない——この区別を前回記録は明示していなかった。

### (3) 重複抑止 — 4ハーネス中もっとも作り込まれている

ドキュメントは`repeatMode`という専用フィールドを持つ:

> `repeatMode`(既定`"once"`)、`repeatGap`(既定`10`完了ターン)

> "### `repeatMode: "once"`" ... "### `repeatMode: "after-gap"`" — "`messageCount - lastInjectedAt >= repeatGap`"

ルール名でのdedupも明記: "Pending injections are deduplicated by rule name before injection." さらにセッション再開をまたいだ復元も documented:

> "`TtsrManager` supports restoration via `restoreInjected(ruleNames)`." ... "Injected-rule suppression is therefore restored from the current branch path."

**結論**: ompはTTSR経由でなら、Claude Codeの`paths:`より重い代わりに、より作り込まれた重複抑止(ルール名dedup+ターン数ゲート+セッション再開時の復元)を持つ——4ハーネス中、重複抑止をベンダー自身が設計しているのはompとDSH(§4)だけ。

---

## 3. pi — 文脈追加の口はあるが、誰も使っていない

(direct, `raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md`)

### (1) パス受信 — YES(前回記録で確定済み、`event.input.path`)

### (2) 文脈追加の口 — `tool_call`には無い、`tool_result`にはある(が実例ゼロ)

公式ドキュメントが明記する`tool_call`の権能:

> "`tool_call` can mutate input or block execution."

追加のコンテキストを返す権能は無い——ブロックか入力書き換えのどちらかのみ。一方`tool_result`は:

> "`tool_result` handlers compose, with each handler seeing prior changes."

「composeする」=前のハンドラの変更を見た上で自分も変更を重ねられる、という意味で、これはompの`tool_result`パッチと同種の口——**技術的には`tool_call`でパスを見て、対応する`tool_result`のcontentに条件付きテキストを足す実装が可能**。

しかし公式サンプル集(前回記録で精読済みのclaude-rules.ts/protected-paths.ts)にこの実装は無く、今回`gh code search`で新たに"`tool_result` glob rule"を狙って探した結果もこれを裏付ける: ヒットした28件のうち`itayinbarr/little-coder`の`skill-inject/index.ts`と`arcasilesgroup/ai-engineering`の`graft.ts`を開いて確認したが、両方とも`tool_result`はツール実行の**観測**(state追跡)にだけ使い、文脈注入は`before_agent_start`から**プロンプトのテキスト**をトリガーに行っている——ファイルパスをトリガーにした文脈注入ではない。

```
// skill-inject/index.ts (direct)
pi.on("tool_result", async (event) => { /* state tracking only */ });
pi.on("before_agent_start", async (event, ctx) => { /* inject by prompt text, not path */ });
```

```
// graft.ts (direct)
pi.on("before_agent_start", async (event, ctx) => { /* runs `graft ask --json` on the prompt */ });
pi.on("tool_result", async (event, ctx) => { /* observation only */ });
```

**結論**: piの`paths:`相当は「理論上作れる口はあるが、公式サンプルにも実地の2例にも実装例がゼロ」——前回記録の結論を追加の的を絞った検索でも裏付ける、確定した否定的証拠。

### (3) 重複抑止 — 仕組みなし(自前実装が前提)

ドキュメントの状態管理表: "Durable data excluded from model context" → `pi.appendEntry()`。これは汎用の永続化APIであって、`paths:`相当の重複抑止に特化した仕組みではない——実装するなら拡張作者が自分で「このパスにこのルールを注入済み」を`appendEntry`に記録し、次回の`tool_call`/`tool_result`で読み返す必要がある。ompの`repeatMode`のようなビルトインは無い。

---

## 4. DSH — ネイティブに近い口が1つ、Claude Codeブリッジには穴がある

前回記録の「DSHは未調査」を本記録で解消する。一次資料はこのマシンにインストール済みの2パッケージのREADME(direct, local — `~/.npm/_npx/c40503fdf38a82ea/node_modules/@deepseek-ai/{dsh-agent-instructions,dsh-hooks-claude-code}/README.md`、npm経由でインストールされた公式パッケージ自身のドキュメントであり、二次資料ではない)。

### 4.1 `dsh-agent-instructions` — DSHがネイティブに持つ、`paths:`にもっとも近い挙動

これはjigの実装ではなくDSH自身(`@deepseek-ai`名前空間)のプラグインで、`dsh-base`が既定で有効にする。

**(1) パス受信**: YES、ツール呼び出しのパスを能動的に追跡する。

> "After a successful `read`, `write`, or `edit` call reaches a deeper directory, the next request includes the newly applicable instruction file"

ソースマップにも明記: "`src/index.ts` | Plugin entry: pre-step listener, `tools/result` touch tracking, inbox composition"

**(2) 文脈追加の口**: YES、自動発火。ファイル発見がディレクトリ階層に基づく点はClaude Codeの任意globとは違うが、「ツール呼び出しがあるパスに触れたときだけ、そのパスに対応する指示ファイルを文脈に足す」という動作原理はほぼ同じ:

> "Instructions from: AGENTS.md" ... "These instructions apply to work under `packages/app`. Use them as guidance when relevant; more specific instructions take precedence."

`<system-reminder>`枠で注入され、Claude Code自身の記憶注入と同じ見た目の形。プロンプトインジェクション対策も明記: "literal `</system-reminder>` text anywhere in instruction content ... is escaped so repository-controlled text cannot close the plugin-owned frame."

**(3) 重複抑止**: YES、4ハーネス中もっとも具体的——SHA-1コンテンツダイジェストベース。

> "An unchanged path with an unchanged digest is never injected again." ... "Sibling files whose content matches after trimming render once, so a `CLAUDE.md` that duplicates its `AGENTS.md` is not repeated."

ソースマップ: "`src/digest.ts` | SHA-1 content identity and per-directory duplicate keys" "`src/state.ts` | Durable message sources, version/digest cache, reconciliation"。変更/削除も明示的に扱う: 変更時は"Updated instructions from: `<path>`"、削除・重複判定時は"Instructions removed: `<path>`"という通知メッセージを出す。

**制約**(README自身の「既知の限界」節、direct):

> "Candidate semantics stay intentionally small — lowercase names, `.claude/rules/`, and `@path` imports are not interpreted"

つまりこの仕組みはAGENTS.md/CLAUDE.md(+ローカルオーバーレイ)専用で、`.claude/rules/*.md`の`paths:`フロントマターは読まない——**ネストされたファイル単位のトリガーであって、1ファイル内の任意globパターンではない**。これはCodexのAGENTS.mdネスト連結と同じ系統の制約で、Claude Codeの`paths:`(1つの`.claude/rules/x.md`が複数の任意globに条件付けできる)とは表現力が違う。

### 4.2 `dsh-hooks-claude-code`ブリッジ — PreToolUseの`additionalContext`は明示的に握りつぶされる

このパッケージはClaude Code形式の`hooks.json`をDSH上でそのまま動かすブリッジで、4.1のネイティブプラグインとは別物。

**(2) 文脈追加の口、イベントごとの対応表**(direct、README自身の表):

| フック | いつ動くか | 何ができるか |
|---|---|---|
| `SessionStart` | セッション開始時 | そのセッションでモデルが見る文脈を付ける |
| `UserPromptSubmit` | プロンプト受信時 | プロンプトをブロック、または追加文脈を付ける |
| `PreToolUse` | ツール実行前 | ツールをブロック、または承認を求める |
| `PostToolUse` | ツール実行後 | 結果をフィードバックでブロック、または追加文脈を付ける |

「既知の限界」節がPreToolUseについて明示的に書く:

> "**`PreToolUse` is partial** — `deny` and `ask` decisions work; `allow` does not pre-approve, `defer` is unsupported, **`additionalContext` is ignored**, and `updatedInput` is logged + warned but not honored."

つまりClaude Code側の`hooks.json`で`PreToolUse`が`hookSpecificOutput.additionalContext`を返すよう書いてあっても、DSHのこのブリッジ経由では**その部分だけ無視される**——ブロック/確認だけは効く。一方`PostToolUse`は効く:

> "**`PostToolUse` is partial** — blocking feedback and JSON `additionalContext` work"

マッチャー次元は"the tool name (`PreToolUse` / `PostToolUse`)"のみで、パス/globでのフィルタは無い——CodexやClaude Codeのhooks.json形式をそのまま継承した制約。

**(3) 重複抑止**: このブリッジ自体には無い、それどころか設定レベルのdedupすら後退している:

> "Matching handlers run serially and are not deduplicated, whereas Claude Code runs them in parallel and deduplicates identical handlers."

これは`paths:`の重複抑止(同じルールを二度読まない)とは別軸(同一ハンドラ定義の重複排除)だが、「Claude Codeの挙動をそのまま持ってこようとして、実は一部退化している」という同じ種類の罠として記録しておく価値がある。

**結論**: DSHで`paths:`相当を実現するなら、Claude Code形式の`hooks.json`をブリッジ経由で流用するのは**PreToolUseでは効かない**(additionalContext無視)。効くのはDSHネイティブの`dsh-agent-instructions`(AGENTS.md/CLAUDE.mdのネスト専用)か、PostToolUse限定でのブリッジ利用のみ。

---

## 5. まとめの表

| ハーネス | (1) パス受信 | (2) 文脈追加の口 | (3) 重複抑止 | 出典 |
|---|---|---|---|---|
| Claude Code(参照) | ネイティブ、ファイル読込イベント | `paths:`フロントマターが自動 | ランタイム内部(未公開の実装詳細) | code.claude.com/docs/en/memory |
| **Codex** | YES — `tool_input.file_path`(ドキュメントのプレースホルダ例に明記) | YES — `hookSpecificOutput.additionalContext`はPreToolUse/PostToolUse両方に文書化(手動:ハンドラ自身がglobマッチを書く。マッチャー自体はツール名のみ) | 無し(自前の状態ファイルが前提) | learn.chatgpt.com/docs/hooks(direct) |
| **omp** | YES — `event.input`+TTSRの`matcherPaths`/`matcherEntries`(ファイル単位で再構成) | YES、二段構え — `tool_result`のcontent patch(常時、手動)/ TTSRの`globs`+`condition`/`astCondition`/`question`併用(自動発火、ストリーム割り込みまでする) | YES — `repeatMode`(既定`once`)+ルール名dedup+`restoreInjected`によるセッション再開時の復元 | github.com/can1357/oh-my-pi docs/extensions.md, docs/ttsr-injection-lifecycle.md(direct) |
| **pi** | YES — `event.input.path`(`tool_call`) | 口はある(`tool_result`のcontent patch)が`tool_call`自体には無く、公式サンプル・実地2例とも未実装 | 無し(`pi.appendEntry()`で自前実装が前提) | github.com/earendil-works/pi packages/coding-agent/docs/extensions.md(direct)、itayinbarr/little-coder・arcasilesgroup/ai-engineering(direct, gh code search) |
| **DSH(ネイティブ dsh-agent-instructions)** | YES — `tools/result touch tracking`でread/write/editのパスを追跡 | YES、自動発火(ディレクトリ到達ベース。1ファイル内の任意globではなくネストAGENTS.md/CLAUDE.md専用) | YES — SHA-1コンテンツダイジェストキャッシュ、未変更パスは二度と注入しない | ローカルインストール済みREADME(direct, local) |
| **DSH(ブリッジ dsh-hooks-claude-code)** | 未確認(README記述からは断定できず) | 部分的 — PostToolUseは効く、**PreToolUseの`additionalContext`は明示的に無視される** | 無し、かつ同一ハンドラのdedupすらClaude Code本家から後退 | ローカルインストール済みREADME(direct, local) |

---

## 6. 結論(平易な言葉で)

**Codex**: 前回記録は「matcherにパス次元が無いから`paths:`相当は無い」と結論していたが、それは半分だけ正しい。マッチャー(どのツール名で発火するか)にパス次元が無いのは一次資料で再確認できたが、**発火した後のハンドラは`tool_input.file_path`を受け取り、`hookSpecificOutput.additionalContext`という文書化された口で条件付きの文脈を返せる**。つまりCodexは「ハーネスが自動でやってくれる`paths:`」を持たないが、「フックスクリプトの作者が5〜10行のシェル/Pythonでglobマッチを書けば`paths:`相当を再現できる口」は持っている。これは前回記録の結論に対する実質的な訂正であり、config-layout決定が書いた「Codex・pi・DSHはフックで差し込む」という一文のうち、Codexについては理論だけでなく**具体的なJSON出力フィールドまで一次資料にある**という意味で、pi(理論はあるが実装例ゼロ)より一段確度が高い。

**omp**: `globs`だけでは自動発火しない(前回の結論どおり)が、TTSRルールとして`condition`/`astCondition`/`question`のどれか1つと組み合わせれば、`globs`は"a global file-path gate"として機能し、ストリーミング中に自動的にマッチしてモデルの応答そのものを中断してまでコンテキストを差し込む——Claude Codeの`paths:`より能動的な挙動になる。そして`repeatMode`による重複抑止は4ハーネス中もっとも作り込まれている。ompは「`paths:`相当を持たない」のではなく「持っているが素の`globs`だけでは起動しない、追加の一手間(condition)が要る」というのが正確な言い方。

**pi**: 口(`tool_result`のcontent patch)は存在するが、公式サンプルにもgh code search で新たに見つけた実地2例にも、それを使ってファイルパス条件でコンテキストを注入した実装はゼロだった。`tool_call`自体は入力の書き換えかブロックしかできず、文脈追加の権能を持たない——ここがpiとomp/Codexの違いで、piでは「ツールが呼ばれた**その場**」で文脈を足す口が一段間接的(`tool_call`ではなく対応する`tool_result`まで待つ必要がある)。piは3ハーネス中もっとも「作れるが、誰も作っていない」の色が強い。

**DSH**: 未調査だった前回記録の穴が、実は一番具体的な答えを持っていた。DSHネイティブの`dsh-agent-instructions`は、ディレクトリ単位ではあるものの`paths:`とほぼ同じ動作原理(ツール呼び出しがあるパスに触れたら、そのパスに対応する指示ファイルを自動的に文脈へ足す)を持ち、かつSHA-1ダイジェストによる重複抑止まで実装済み——4ハーネス中もっとも「素で使える」に近い。ただし対象はAGENTS.md/CLAUDE.mdのネスト専用で、Claude Codeの`.claude/rules/*.md`が持つ「1ファイルに複数の任意globパターン」という表現力は無い。一方、Claude Code資産の再利用を謳う`dsh-hooks-claude-code`ブリッジは、名前から期待される「hooks.jsonをそのまま持ってくれば動く」を裏切る——PreToolUseの`additionalContext`は明示的に無視される、という個別の欠落がREADME自身に明記されている。

---

## 7. 前例なし・未検証のリスト

1. Codexの`hookSpecificOutput.additionalContext`を条件付きで返すPreToolUse/PostToolUseフックスクリプトの実例 — `gh code search`で「hookSpecificOutput additionalContext PreToolUse file_path glob」7,728件がヒットしたが、時間予算内で個別に開いて実配線(単なる語句一致ではなく実際にfile_pathでglobマッチしてadditionalContextを返しているか)を確認したものはゼロ。前例の有無は未確定。
2. pi拡張で`tool_result`のcontent patchを使い、ファイルパス条件でモデル可視の文脈を注入した実例 — 公式サンプル・的を絞った`gh code search`(28件中2件を精読)のどちらにも見つからなかった。これは探索を行った上での否定的証拠であり、探索不足による「見つからなかった」ではない。
3. `dsh-hooks-claude-code`ブリッジが実際に`tool_input`へ`file_path`を渡すかどうかのソースレベル確認 — READMEの記述のみで、`src/index.ts`・`src/config.ts`の実装は読んでいない。
4. ompのTTSR `globs`+`condition`(または`astCondition`/`question`)併用による実運用リポジトリの実例 — ドキュメントの記述精度は高いが、実際に動いているリポジトリのサンプルは見ていない(前回記録から継承する既知の欠落)。
5. Codexの`additionalContextLimit`(既定2,500トークン)とClaude Codeの`paths:`予算(1,000パターン/4MiB)を同一プロジェクトで比較した実測 — どちらもベンダー文書の設計値であって、実運用コストの統制比較はどこにも無い。
6. DSHの`dsh-agent-instructions`が「ディレクトリ到達」ではなく「1ファイル内の任意glob」に近い挙動をするよう拡張された実例、または議論 — READMEの「既知の限界」が明示的に対象外と書いている(`.claude/rules/`は解釈しない)ので、これは前例なしというより仕様上の非対応。

---

## 出典一覧(直接引用したURL・パス)

- Codex hooks(additionalContext全出現、tool_input.file_path例): https://learn.chatgpt.com/docs/hooks (direct, `curl`取得HTMLから抽出)
- Codex rules(`~/.codex/rules/*.rules`はプレフィックス許可専用): https://learn.chatgpt.com/codex/agent-configuration/rules (direct)
- Codex AGENTS.md(ネスト連結、once per run): https://learn.chatgpt.com/codex/agent-configuration/agents-md (direct)
- omp extensions.md(`tool_call`/`tool_result`の権能、`session_stop`のadditionalContext): https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md (direct)
- omp ttsr-injection-lifecycle.md(globsのfile-path gate、repeatMode、restoreInjected): https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/ttsr-injection-lifecycle.md (direct)
- pi extensions.md(`tool_call`/`tool_result`の権能差、before_agent_startのsystemPrompt/message): https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md (direct)
- pi in-the-wild(2例精読): https://raw.githubusercontent.com/itayinbarr/little-coder/main/.pi/extensions/skill-inject/index.ts , https://raw.githubusercontent.com/arcasilesgroup/ai-engineering/main/.pi/extensions/graft.ts (direct)
- DSH dsh-agent-instructions README(SHA-1ダイジェストdedup、ディレクトリ到達トリガー): `~/.npm/_npx/c40503fdf38a82ea/node_modules/@deepseek-ai/dsh-agent-instructions/README.md` (direct, local — npm経由でインストール済みの公式パッケージ自身のREADME)
- DSH dsh-hooks-claude-code README(PreToolUse additionalContext ignored、マッチャーはツール名のみ): `~/.npm/_npx/c40503fdf38a82ea/node_modules/@deepseek-ai/dsh-hooks-claude-code/README.md` (direct, local)
- jigソース(前置きの現地事実確認): `domains/dev/llm/harness/jig/adapters/omp/src/{index,guard,session}.ts`, `domains/dev/config/pi/extensions/{guard,skill-router}.ts`, `domains/dev/llm/harness/jig/adapters/dsh/src/index.ts`, `domains/dev/llm/harness/jig/src/domain/codex/register.ts` (direct、リポジトリ内)
- 前提として再利用した既存記録: `domains/dev/llm/harness/rules/research/2026-09-23-per-language-hooks-and-rule-delivery.md`
