---
question: "Does pi support MCP, do omp and DSH have native MCP clients (and how do they handle context cost), and what techniques actually get an agent to use configured MCP tools instead of ignoring them?"
date: 2026-09-22
verdict: "pi's maintainer refuses MCP at the harness level and leaves it to unofficial community adapters (pi-mcp-adapter is the de facto standard by download count but has no maintainer backing); omp and DSH both ship native MCP clients with opposite context-cost defaults (omp lazy/on-demand, DSH eager on every request); soft prompt-based steering to use MCP tools is reported by serena's own maintainer to have stopped working and to have worsened with recent Claude Code updates, leaving a hard PreToolUse-deny hook as the only 'somewhat feasible' fallback — and that hook itself misfires on non-symbolic files."
unverified:
  - "The exact date pi's or omp's MCP support was introduced (predates both projects' retrievable changelog history)"
  - "DSH's own history — design-note dates and repo created_at/release-tag order are internally inconsistent"
  - "A pi-maintainer-endorsed single MCP client extension (issue #8703 went unanswered and was auto-closed)"
  - "serena's official 'how to get Claude Code to use it' guide (likely lives on a separate site, oraios.github.io/serena, not fetched)"
  - "Any quantitative Anthropic figure linking tool-description quality to tool-selection rate"
  - "Any issue report of playwright-mcp being ignored by a model (none found — unclear if under-reported or genuinely rare)"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# pi/omp/DSH の MCP 対応、および MCP を「実際に使わせる」ための誘導手法 — 業界調査

調査日: 2026-09-22。既決事項（再検討しない）: MCP ソース一覧は serena / codebase-memory-mcp /
context7 / playwright-mcp（ネイティブブラウザツールが無いハーネス向け）/ figma-remote /
notion-mcp を残し、figma-desktop・claude-mem は落とす。GitHub MCP / Linear・Jira / DB サーバは
追加しない。本調査はこれを覆すものではなく、三つの未決問題（pi の MCP 対応、omp/DSH の MCP
対応、MCP を実際に呼ばせる誘導手法）にのみ答える。

## Method / 検証の凡例

- `[raw fetch]` — `gh api` / `curl` / raw.githubusercontent.com など、要約なしの原文取得。
- `[summarized]` — WebFetch の要約モデルを経由した取得。数字・引用は一段低い確信度として扱う。
- `[local config, read-only]` — このマシン上の設定ファイルを読み取り専用で確認した事実。
- `[unverified]` — 推論・未確認の帰属や因果関係。
- 三つの並列サブエージェント（Q1: pi、Q2: omp/DSH、Q3: 誘導手法）が収集した生データを
  `.tmp-research`（セッション scratchpad）に書き出し、本ファイルはそれを統合・要約したもの。
  個別の生データはサブエージェントの手元にのみ残り、本ファイルが正の記録。
- WebSearch はセッション予算（200 コール、3 トラック共有）を Q3 実行中に使い切り、Q3 の
  「実践者」レンズは targeted WebFetch のみに制約された。既知の欠落として明記する。

---

## Q1. pi と MCP

**結論となる事実（引用は下記）**: pi 本体（現在は `earendil-works/pi`、旧 `badlogic/pi-mono`、
108,429 stars、2026-09-22 push）は MCP クライアントを持たず、今後も持たない方針を作者
Mario Zechner が明言している。一方で pi は汎用の「遅延ツール（deferred-tools /
setActiveTools）」プリミティブを核に持っており、サードパーティがこれを使って MCP
クライアント拡張を複数実装している。単一の「これが pi の MCP 拡張」という決定版は無く、
少なくとも 6 つの独立実装が並立する断片的なエコシステム。

### ベンダー（pi 作者本人の立場）

- pi README: **「No MCP. Build CLI tools with READMEs ..., or build an extension that adds
  MCP support.」** — `docs/README.md`（ローカルキャッシュ、原文）
- Mario Zechner「pi coding agent」記事（mz_2025-11-30、ローカルキャッシュ、原文）:
  > 「pi does not and will not support MCP. ... MCP servers are overkill for most use cases,
  > and they come with significant context overhead. Popular MCP servers like Playwright MCP
  > (21 tools, 13.7k tokens) or Chrome DevTools MCP (26 tools, 18k tokens) dump their entire
  > tool descriptions into your context on every session. That's 7-9% of your context window
  > gone before you even start working... If you absolutely must use MCP servers, look into
  > Peter Steinberger's mcporter tool that wraps MCP servers as CLI tools.」
- "What if you don't need MCP at all?" (2025-11-02) https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/
  `[summarized]` — 同じ数字（Playwright MCP 21 tools/13.7k tokens/6.8%、Chrome DevTools MCP
  26 tools/18.0k tokens/9.0%、CLI 版は 225 tokens）を再確認。原文の逐語取得はできず、要約経由。
- "MCP vs CLI: Benchmarking Tools for Coding Agents" (2025-08-15)
  https://mariozechner.at/posts/2025-08-15-mcp-vs-cli/ `[summarized]` — terminalcp を MCP版・
  CLI版で作り比べた限定ベンチマーク（3タスク×4ツール×10反復）。MCP版は「23% faster (51m vs
  66m)」「2.5% cheaper」、CLI版は誤検知（悪意コマンド検知）で Haiku 使用時「35k vs 1.3-2M
  tokens」の差。結論は「protocol is just plumbing」— MCP か CLI かより設計品質が支配的。
  **注意**: この記事は 1 ツール（ターミナル制御）の作り比べであり、context7/serena/
  playwright-mcp のような重量級サーバへの一般化ではない、と 11 月の記事自身が区別している。

### 実践者・エコシステム（pi 拡張としての MCP クライアント）

- **`nicobailon/pi-mcp-adapter`**（npm: `pi-mcp-adapter`、月間 **1,013,749 ダウンロード**、
  49 依存パッケージ、MIT、GitHub 1,526 stars だが watcher 6・open issue 2 という星数との
  不整合あり `[unverified: 星の真正性は未確認、npm DL数の方が偽装しづらい実利用シグナル]`）
  が実質デファクト標準。README（`[raw fetch]`）冒頭で Zechner の記事を直接引用し対抗設計を
  説明:
  > 「Mario wrote about why you might not need MCP... His take: skip MCP entirely... This
  > adapter gives you access without the bloat.」
  > 「One proxy tool (~200 tokens) instead of hundreds. The agent discovers what it needs
  > on-demand. Servers only start when you actually use them.」
  > 「Servers are lazy by default — they won't connect until you actually call one of their
  > tools. The adapter caches tool metadata so search and describe work without live
  > connections.」
  設定形式は標準 `.mcp.json` / `~/.config/mcp/mcp.json` の `mcpServers` マップ（Claude Code
  と同形）。Cursor/Claude Code/Codex の既存設定を `/mcp setup` で自動インポート。
- **`dmmulroy/pi-mcp`**（26 stars、MIT記載なし、2026-08-16 push）— OpenCode 互換設定
  （`.pi/mcp.json` の `type: "local"`/`type: "remote"` で **stdio と HTTP 両対応**を明示）。
  `startup: "lazy"|"eager"` と `toolMode: "proxy"`（progressive-disclosure gateway、
  `mcp({search: ...})` → `mcp({tool:..., args:...})`）を明示的に切り替え可能——pi-mcp-adapter
  と同じ遅延パターンを別実装で提供。
- **`nicbet/pi-mcp-extension`**（2 stars、MIT）— 「dependency-free」を謳う軽量版。stdio と
  Streamable HTTP 対応だが、遅延ロード（tool-search/proxy）の記述は見つからず、ツールを
  `mcp__SERVER__TOOL` として即時登録する **eager** な実装と読める。
- pi コア repo の issue tracker（channel bias: issue は苦情寄り）:
  - issue #8703「Extension example - MCP with dynamic tool loading」（bot による自動クローズ、
    メンテナ未回答）で、サードパーティが pi の `setActiveTools`/deferred-tools プリミティブを
    使い **「~100 MCP tool schema cost from ~30k tokens per turn to around ~2k」** に削減した
    と報告 — pi コアのプリミティブが MCP 文脈コスト対策に転用されている独立証拠。
    https://github.com/earendil-works/pi/issues/8703
  - issue #9480 は `pi-mcp-adapter` 名指しのバグ報告（Linear MCP を OAuth 経由で接続）——
    実運用での使用を裏付ける。

### 測定・数字

- Zechner のベンチマーク数字（上記）は `[summarized]` のみで、原文の逐語取得は未達成。
- issue #8703 の「~30k→~2k tokens/turn」は `gh api` 経由の生データ（本文引用）で
  `[raw fetch]` 相当——ただしメンテナの検証・追試は無い一次報告のみ。

### 実態（in the wild）

- `pi-mcp-adapter` npm 週間/月間ダウンロード数（1M+/月）と 49 の依存パッケージ
  （`@geohar/pi-mcp-combiner` 等が明示的に「pair with pi-mcp-adapter」と自称）が
  エコシステム標準化の実態的な証拠。
- 一方 GitHub 側の star/watcher/issue 数の不整合（1,526 stars だが watcher 6・open issue 2）
  は未解決の異常値として明記——星数だけを鵜呑みにしない。

### pi ネイティブの serena / context7 / playwright-mcp 代替

- **context7 代替**: `mario-gc/pi-context7`、`flosrn/pi-context7`、`aaronmaturen/pi-context7`
  ほか複数、いずれも ≤1 star。単体では採用実態が薄い。
- **serena+context7 統合代替**: **`mrclrchtr/supi`**（92 stars、MIT、2026-09-22 push）——
  LSP/Tree-sitter によるコード知能（serena 相当）と Context7 連携（`supi-web`）を単一の pi
  拡張スタックとして提供。README（`[raw fetch]`）:
  > 「It adds LSP and Tree-sitter code intelligence, semantic refactoring, parallel code
  > review, web and Context7 documentation access...」
  見つかった中で最も直接的な自前代替。ただし LSP フル機能には言語サーバのバイナリが別途必要。
- **playwright-mcp 代替**: `"playwright pi extension"` / `"serena pi extension"` /
  `"lsp pi extension"` はいずれも **0 件**（ハードな否定結果）。`fitchmultz/pi-agent-browser-native`
  （225 stars、2026-09-22 push、「pi extension that exposes agent-browser as a native tool」）
  が候補だが機能同等性は未検証 `[unverified]`。

### 見つからなかったもの（no precedent）

- pi 作者・保守チーム公認の「唯一の」MCP クライアント拡張は存在しない。
- Zechner 記事 2 本の逐語（非要約）原文取得。
- mcporter が「エージェントの文脈内でツールスキーマを遅延ロードするか」——mcporter は
  人間/スクリプト向け CLI・SDK として文書化されており、エージェント文脈への組み込み契約は
  README に記載が無い。

---

## Q2. omp と DSH の MCP 対応

### omp（`can1357/oh-my-pi`、32,600 stars、ローカル導入版 18.0.4／最新 18.2.8）

1. **ネイティブ MCP クライアント: あり。** `packages/coding-agent/src/mcp/{client,manager,
   config,loader,tool-bridge,transports/*}.ts`、docs 4本、テスト約70本という本格実装。
2. **設定形式**: `.omp/mcp.json` / `~/.omp/agent/mcp.json`（プロファイル別は
   `~/.omp/profiles/<name>/agent/mcp.json`）。このマシンの実物 `[local config, read-only]`:
   ```json
   { "mcpServers": {
       "codebase-memory-mcp": {"type": "stdio", "command": "/Users/esh2n/bin/codebase-memory-mcp-managed"},
       "serena": {"type": "stdio", "command": "uvx", "args": ["-p","3.13","serena-agent==1.5.3","start-mcp-server","--project-from-cwd","--context","codex"]}
   } }
   ```
   これは `docs/mcp-config.md`（`[raw fetch]`）が定義する形式と完全一致。Claude Code /
   Codex / Cursor / Windsurf 等の既存設定を自動インポートもする。
3. **トランスポート**: `stdio`（既定）、`http`（Streamable HTTP、現行推奨）、`sse`（2024-11-05
   仕様のレガシー互換）。セッションは MCP プロトコル `2025-11-25` を使用。
4. **遅延ロード: 既定で有効**（Q1 の pi-mcp-adapter と同じ思想を、pi ではなく omp 本体が実装）。
   二層構造:
   - 接続時の 250ms 猶予レース（`STARTUP_TIMEOUT_MS = 250`）——間に合わなければキャッシュ済み
     ツール定義で `DeferredMCPTool` を作り、バックグラウンドで解決。
   - `tools.xdev`（既定 `true`）+ `tools.xdevDocs`（既定 `"builtins"`）——
     > 「Mount rarely-used (discoverable) tools under xd:// device URLs driven via read/write
     > instead of shipping their schemas on every request.」
     > `"builtins"`: 「**Inline built-in docs; fetch MCP and extension docs on demand.**」
     既定では **組み込みツールのみシステムプロンプトにインライン、MCP/拡張ツールのスキーマは
     オンデマンド**（`read xd://<tool>`）——pi-mcp-adapter の「1 proxy tool」設計と同じ結論に、
     harness 本体側の一般化された仕組みで到達している。
5. **サーバ単位の有効/無効**: 設定の `enabled?: boolean`、ユーザースコープの `disabledServers`
   （常に勝つ denylist）/`enabledServers`（allowlist）、対話コマンド `/mcp enable|disable|
   reauth|reconnect|reload|test|remove`。
6. **出力上限**: MCP 専用の上限は無く、全ツール共通の `DEFAULT_MAX_BYTES = 50 * 1024`（50KiB）
   を経由（`packages/tui/src/tools/streaming-output.ts`）。超過分は先頭60%/末尾25%を残して
   間引き。MCP ツール名は 64 文字上限（超過分は 8 文字ハッシュ付与）。
7. **文脈コストへの明言**: 上記 `xdev`/`xdevDocs` の設定説明文と `xdev.ts` のコード内コメント
   がそのまま文脈コスト言及——ただし can1357 個人のブログ/issue コメントでの言及は見つからず、
   帰属は製品ソース止まり `[unverified attribution: 個人 vs 他コントリビュータ]`。

### DSH（`deepseek-ai/deepseek-harness`、233,158 stars、ローカル未導入）

**訂正**: タスクで示唆された npm パッケージ名 `dsh-tool-mcp` は**存在しない**
（`curl https://registry.npmjs.org/dsh-tool-mcp` → `{"error":"Not found"}`）。実在するのは
`@deepseek-ai/dsh-mcp-client`（週間 302,521 DL、BSD-3-Clause）。

1. **ネイティブ MCP クライアント: あり。** Cordis プラグイン方式（DSH は「Everything is a
   Plugin」設計）。`@deepseek-ai/dsh-mcp-client`（サーバ接続+ツールブリッジ）と
   `@deepseek-ai/dsh-mcp-resources`（共有リソース探索、プロファイル単位）の2パッケージ。
2. **設定形式**: omp/Claude Code の `mcpServers` JSON マップとは**異なる**。Cordis の YAML
   プラグインエントリ1件=1サーバ:
   ```yaml
   - id: mcp-github
     name: '@deepseek-ai/dsh-mcp-client'
     config:
       serverName: github
       transport: stdio
       command: npx
       args: ['-y', '@modelcontextprotocol/server-github']
   ```
   単一の `mcp.json` は存在しない。「No server is enabled by default.」
3. **トランスポート**: `stdio` と `streamable-http`（後者は SSE ストリーミングを内包し、omp
   のような別建て `sse` オプションは無い）。プロトコルは `2026-07-28`（フォールバック対応）。
4. **遅延ロード: 既定で eager——omp と正反対の設計判断。**
   > 「The server's tools appear before the harness starts its first turn.」
   > 「The tool descriptions and input schemas enter every request while the tools are
   > registered; re-syncs replace rather than accumulate schemas...」
   オンデマンドなのはツールスキーマではなく**リソース読み取り**のみ（「Resources are read on
   demand」）。MCP tool-search/proxy 相当の遅延ロード機構は見つからず。
5. **サーバ単位の有効/無効**: 専用の `enabled` bool フィールドは無く、Cordis プラグイン
   エントリの追加/削除そのものが有効/無効。`reconnect.maxAttempts`（既定10）失敗後は
   自動的にツールが除去される。
6. **出力上限**: MCP ツール**結果**の専用上限は発見できず（`packages/mcp/mcp-client/`
   内を `truncat|maxBytes|MAX_|cap|limit|bytes` で検索し、ヒットは `MAX_PUBLIC_NAME_LENGTH
   = 64`（ツール名上限、omp と同じ64文字）のみ）。唯一の明示上限は**サーバ instructions**
   向け `maxInstructionBytes`（既定 32KiB）で、超過時は**接続自体を拒否**（omp の「間引いて
   継続」とは対照的な fail-closed 設計）。
7. **文脈コストへの明言**: README に専用の **「Model Experience」**節があり、挙動ごとに
   「Token effect」「KV Cache effect」を明記する一次資料としての体裁——omp より構造化されている:
   > 「Token effect: The tool descriptions and input schemas enter every request while the
   > tools are registered; re-syncs replace rather than accumulate schemas, and the
   > server-qualified name adds tokens to every tool definition and call.」
   > 「KV Cache effect: The tool-definition prefix stays stable while the discovered set and
   > schemas are unchanged. A re-sync ... may invalidate reuse from the first changed schema
   > token onward.」

### 見つからなかったもの（no precedent）

- omp の MCP 対応が正確にいつ追加されたか（CHANGELOG.md は 17.4.1/2026-08-21 までしか遡れず、
  その時点で既に MCP 機能が存在）。
- DSH の MCP 対応の正確な追加日（リリースタグは 2026-08-17 までしか遡れず、設計ノートは
  それより前の日付でありリポジトリの公開履歴が移行/欠落している可能性）。
- DSH のツール**結果**専用の出力上限（`packages/mcp/` 範囲内では不在、範囲外は未調査）。

---

## Q3. MCP を実際に「使わせる」誘導手法

**要点**: ソフトな誘導（CLAUDE.md/プロンプト指示）は serena メンテナ自身が「効かなくなった、
Claude Code の更新で悪化した」と issue で認めている。唯一メンテナが「somewhat feasible」と
呼んだのはハードな PreToolUse 拒否フック（強制）だが、それにも誤爆による副作用がある。
ベンダー側もツール説明文の書き方そのもの（プロンプトエンジニアリング）を主要な改善レバーと
位置付けている。

### ベンダー

- **Anthropic「Writing tools for agents」** https://www.anthropic.com/engineering/writing-tools-for-agents
  `[summarized]`:
  > 「We now come to one of the most effective methods for improving tools: prompt-engineering
  > your tool descriptions and specs.」「Even small refinements to tool descriptions can yield
  > dramatic improvements.」Claude Sonnet 3.5 は説明文の精緻化後に SWE-bench Verified で
  > SOTA を達成、とするが**定量的な数字は本文に見つからず**（"no numbers"、グラフのみで
  > テキスト化されていない可能性）。namespacing（`asana_search` のようなサービス別接頭辞）も
  > 「non-trivial effects on our tool-use evaluations」と効果を主張するが数値は示さない。
- **Claude Code docs（CLAUDE.md/メモリ）** https://code.claude.com/docs/en/memory `[summarized]`:
  > 「Claude treats them as context, not enforced configuration. To block an action regardless
  > of what Claude decides, use a PreToolUse hook instead.」——ベンダー自身が CLAUDE.md は
  > 強制ではないと明言。強制できるのは hooks のみ。
- **Claude Code docs（Skills の `allowed-tools`）** https://code.claude.com/docs/en/skills
  `[summarized]`: 「grants permission ... does not restrict which tools are available」——
  使用を強制するものではなく、承認プロンプトの事前許可に過ぎない。
- **serena README** https://raw.githubusercontent.com/oraios/serena/main/README.md
  `[summarized]` — `initial_instructions`/`--context` の明示的な「使わせ方」節は README 本体
  には無く、別サイト `oraios.github.io/serena/02-usage/030_clients.html#claude-code`
  （issue から特定、未取得）にあると見られる `[could not verify]`。
- **context7**: README の合言葉「use context7」に加え、実際のサーバ instructions 文字列が
  弱い版から強い版へ変化した形跡:
  > （現行、pinned commit `12db78ea04`）「Use this server to fetch current documentation
  > whenever the user asks about a library... **even well-known ones**... **MUST** call this
  > function... **Use even when you think you know the answer**.」
  > （issue #2287 が引用する旧版）「Use this server to retrieve up-to-date documentation and
  > code examples for any library」——弱い/最小限の表現。
  ベンダーが利用者フィードバックを受けて指示文そのものを強化した可能性が高いが、日付付きの
  差分確認はできていない `[unverified: 因果関係]`。
- **playwright-mcp（Microsoft）README**: 自社製品でありながら一般的なコーディングエージェント
  用途には **MCP ではなく CLI+Skills を推奨**:
  > 「CLI invocations are more token-efficient: they avoid loading large tool schemas and
  > verbose accessibility trees into the model context...」
  > MCP は「persistent state, rich introspection, and iterative reasoning over page structure」
  > が要る特定用途（自己修復テスト等）にのみ「remains relevant」。

### 実践者

- **Armin Ronacher「Better Models, Worse Tools」**（2026-07-04）
  https://lucumr.pocoo.org/2026/7/4/better-models-worse-tools/ `[summarized]`:
  > 「My strongest hypothesis is that this is not random deterioration but a training
  > artifact.」新しいモデル（Opus 4.8、Sonnet 5）は Claude Code 自身の寛容なツールハーネス
  > 内で強化学習されるため、「The better-trained model might actually fight you harder because
  > its prior is stronger. Alternative tool schemas might not just be unfamiliar. They might
  > be implicitly punished by post-training.」——serena メンテナの報告（下記）と独立に同じ
  > 現象（モデル世代が進むほど非ネイティブ/MCP ツールを選ばなくなる）を指摘。
- WebSearch 予算切れのため、実践者レンズはこの1件と context7 issue の当事者証言に限定
  `[coverage gap, explicit]`。

### 測定された証拠

- **serena issue #1398**（https://github.com/oraios/serena/issues/1398）—— 本調査で最も
  重い一次資料。報告者 `jqnatividad`:
  > 「Even after installing the hooks as per docs, despite repeated reminders to Claude Code,
  > it keeps ignoring the guidance to use Serena's symbolic tools. ... It keeps acknowledging
  > it, but goes back to using grep.」
  メンテナ `MischaPanch`（MEMBER）:
  > 「Unfortunately, recent updates to claude code made it dramatically worse in using
  > Serena's tools. We are investigating what we can do on our side to counteract this.」
  > 「I experimented a bit and #1413 is the only somewhat feasible workaround I can think of
  > right now. Ultimately, we're at the mercy of Anthropic here, who have seriously
  > diminished the possibilities for tool developers to influence Claude code behavior.」
  モデル依存性についても言及: 「It is partially model specific, 4.6 is better at instruction
  following and uses Serena without the hard override of system prompt (though still less
  reliably than a few weeks ago).」
- **serena issue #1429**（https://github.com/oraios/serena/issues/1429）—— ハード強制
  （3回連続 non-symbolic read 後に Read を deny するフック）自体の失敗モード。Markdown/JSON/
  YAML など LSP シンボルが存在しないファイルに誤爆し、ログ上は deny 3秒後に同じ Read を
  リトライするだけで行動が変わらない:
  ```
  20:01:17  DENY   "Too many consecutive read calls without using symbolic tools."
  20:01:20  Read   docs/plans/<redacted>.md      ← retry, 3 seconds later
  ```
  さらに誤爆のたびにフック自体が120秒間「盲目」になる副作用も報告。
- **context7 issue #2287**（https://github.com/upstash/context7/issues/2287）—— 逆に
  「効いた」という当事者証言。「Do NOT wait for the user to say 'use context7' — recognize
  when current docs would prevent mistakes and fetch them proactively.」という CLAUDE.md
  ルールを自作して改善したとし、ベンダーへのデフォルト化を要望。
- **context7 issue #3219**（https://github.com/upstash/context7/issues/3219）—— 逆方向の
  失敗モード。指示を強めすぎると「不要な時にも発火し、文脈/トークンを消費する」という懸念
  （報告者自身「a controlled before/after invocation trace」は取っていないと明言、未測定）。
- Anthropic の「説明文品質→選択率」を結ぶ定量数値は**発見できず**（"no numbers"、明記）。
- issue tracker の検索方法論としての発見: 「ignores」「not using」等の一般語では serena の
  該当スレッドはほぼヒットせず（0/20 件）、実際の議論は "symbolic tools" "the nudge" という
  serena 固有語彙に集中していた。playwright-mcp では同様の一般語検索で「モデルが無視した」
  報告が**一件も見つからなかった**（用途上 grep のような強力な競合ビルトインが少ないためか、
  単なる過少報告か不明 `[unverified]`）。

### 実態（in the wild）

- `gh search code "use context7" filename:CLAUDE.md` → **1,900 件**（AGENTS.md: 1,564件）。
  例: actionbook/actionbook（push 2026-09-08）「Always use context7 when I need code
  generation, setup or configuration steps, or library/API documentation.」
- `gh search code "serena" filename:CLAUDE.md` → **1,828 件**（AGENTS.md: 1,310件）。
  例: LegacyLands/legacy-lands-library「多使用 `serena` MCP 完成可能的操作。」;
  SuperClaude-Org/SuperClaude_Framework（push 2026-09-15）。
- `gh search code "prefer serena over grep"`（完全一致）→ **13件**、
  `"serena instead of grep"` → **3件** —— 「Xより Yを優先」という明示比較形は「use X」型
  （1,300〜1,900件）より**2桁少ない**。実践者の大半はビルトイン代替を名指しせず対象ツールを
  指定するだけ、という傾向。
- チャンネルバイアス注記: `gh search code` は GitHub の関連度ランキングによるサンプルであり
  全数調査ではない。

### 否定側の証拠（steering が効かない／害になる報告）

1. serena #1398 — ソフト誘導（CLAUDE.md + memory + セッション内リマインド + 専用リマインド
   フック）が不十分で、Claude Code のアップデート後に**悪化した**とメンテナ自身が確認。
2. serena #1429 — ハード強制（deny フック）自体も誤爆し、エージェントは deny 後 3 秒で
   同じ行動をリトライ、フックは 120 秒盲目化。「強ければ勝つ」わけでもない。
3. Armin Ronacher — モデル世代が進むほど非ネイティブツールへの選好が**構造的に悪化**しうる
   という独立した仮説（RL 訓練がハーネス固有のツール形式に過学習）。
4. context7 #3219 — 誘導を強めすぎると不要時にも発火し文脈コストが増える（n=1、未測定と
   報告者自身が明言）。
5. **一件が一件を反証する**という原則に従い明記: serena の過少利用報告は 2 名の独立報告者+
   メンテナ確認（n=2+メンテナ）で単なる逸話より強いが、対照実験ではない。context7 の
   過剰発火報告は n=1 かつ未測定。

---

## ハーネス別 MCP 能力比較表

| harness | native MCP | extension | config format | deferred loading | output cap | source |
|---|---|---|---|---|---|---|
| pi (earendil-works/pi) | なし（意図的、恒久方針） | `pi-mcp-adapter`（デファクト標準、npm DL 1M+/月）、`dmmulroy/pi-mcp`、`nicbet/pi-mcp-extension` 等6実装 | `.mcp.json`/`~/.config/mcp/mcp.json` の `mcpServers`（拡張依存） | 拡張側で設計次第——pi-mcp-adapter は proxy tool (~200 token) + on-demand search、dmmulroy/pi-mcp も `toolMode:"proxy"` 選択可、nicbet 版は eager | 拡張ごとに異なる、pi コア共通の上限機構なし | README各 `[raw fetch]`、earendil-works/pi issues #8703 #9480 |
| omp (can1357/oh-my-pi) | あり（一次実装） | 不要（ネイティブ） | `.omp/mcp.json`/`~/.omp/agent/mcp.json` の `mcpServers`（stdio/http/sse） | **既定で遅延**（`xdev`+`xdevDocs="builtins"`——MCPスキーマはオンデマンド、組み込みのみインライン） | 全ツール共通 50KiB（`DEFAULT_MAX_BYTES`）、ツール名64文字 | `docs/mcp-config.md`, `docs/mcp-runtime-lifecycle.md`, `settings-schema.ts` 全て `[raw fetch]` |
| DSH (deepseek-ai/deepseek-harness) | あり（一次実装、Cordisプラグイン） | 不要（ネイティブ） | Cordis YAML プラグインエントリ（`mcpServers` JSON マップとは非互換）、stdio/streamable-http | **既定で eager**（omp と正反対）——スキーマは登録時に全リクエストへ乗る。オンデマンドなのはリソース読み取りのみ | ツール結果専用の上限なし（instructions のみ 32KiB、超過で接続拒否） | `packages/mcp/mcp-client/README.md`, `docs/config-catalog.md` 全て `[raw fetch]` |

---

## Q3 誘導手法テーブル

| technique | who recommends | evidence | failure modes |
|---|---|---|---|
| CLAUDE.md/AGENTS.md の "Always use X when..." 指示 | context7 README、実践者リポジトリ多数（"use context7" 1,900件） | context7 #2287: n=1 自己申告で改善 | serena #1398: 同種の指示がセッション中に無視される、CC更新で悪化とメンテナ確認 |
| ベンダー側ツール説明文自体の強化（"MUST"化） | context7（instructions 文言が弱→強へ変化） | 直接の対照実験は無し、強化後の状況改善は未測定 | context7 #3219: 強すぎる指示は不要時にも発火、文脈コスト増（未測定・自己申告） |
| ツール説明文のプロンプトエンジニアリング一般 | Anthropic engineering blog | "dramatic improvements"、SWE-bench Verified で SOTA、ただし数値非公開 | このソースでは報告なし（ベンダー発信でポジティブ偏重） |
| ツールの namespacing（service/resource接頭辞） | Anthropic engineering blog | "non-trivial effects"、数値非公開 | 報告なし |
| `allowed-tools`（Skills）/ `tools` allowlist（subagent） | Claude Code docs | 可用性の許可/制限であり使用強制ではないとベンダーが明言 | 「誘導」の枠組みでは評価不能（そもそも強制する設計ではない） |
| PreToolUse hook によるハード拒否 | serena 自身（`serena-hooks remind`、プローズ誘導が効かなかった末の対策） | メンテナ「the only somewhat feasible workaround」 | serena #1429: 非対象ファイルへの誤爆、3秒後リトライで無効化、120秒の盲目窓 |
| MCP ではなくCLI/ビルトインを一般用途に推奨 | playwright-mcp（Microsoft）自身 | ベンダーが自社 MCP の一般利用を積極的に非推奨——トークン/スキーマコストを理由に明言 | 該当なし |

---

## 見つからなかったこと（no precedent found）— 総括

- pi・omp のどちらの MCP 対応も、正確な導入日をリリース履歴だけからは特定できない
  （両者とも CHANGELOG の遡及可能範囲より前に機能が存在）。
- DSH の公開履歴自体が、設計ノートの日付とリポジトリ `created_at`/最古リリースタグの順序が
  矛盾しており、内部履歴の移行/欠落が疑われる（正確な起源日は非公開）。
- pi 保守チーム公認の単一 MCP クライアント拡張は存在しない（ユーザーが issue #8703 で
  「作例が欲しい」と要望したが未回答のまま自動クローズ）。
- serena の `initial_instructions`/`--context` の公式な「使わせ方」ガイドは README 本体には
  無く、別サイト（`oraios.github.io/serena`）にあると推定されるが本調査では未取得。
- Anthropic からの「説明文品質→選択率」を結ぶ定量数値（ベンチマークの絶対/相対差分）は
  一次資料に見当たらなかった。
- playwright-mcp について「モデルが無視した」という issue 報告は一件も見つからなかった
  （過少報告か、実際に問題が少ないかは判別不能）。

## 一段落サマリ（判断のために）

pi は MCP をハーネス本体で拒否する立場を明言しており、代替はコミュニティ拡張（特に
`pi-mcp-adapter`）頼み——採用実態（npm DL 1M+/月）はあるが保守チームの公認・一貫した
遅延ロード保証は無い。omp と DSH はどちらもネイティブ MCP 実装を持つが、文脈コストへの
態度が正反対（omp は既定で遅延・on-demand、DSH は既定で eager・全リクエストにスキーマが
乗る）——「MCP を持っている」だけでは同じ物を指さない。誘導手法については、CLAUDE.md 的な
プローズ指示は serena のメンテナ自身が「効かなくなった、Anthropic 側の変化で悪化した」と
認めており、唯一「somewhat feasible」と呼ばれたのはハードな PreToolUse 拒否フックだが、
それにも誤爆という固有の失敗モードがある。「弱い誘導を強くする」（CLAUDE.md ルールの明文化、
ツール説明文の強化）には context7 の一件のポジティブな自己申告があるが、強すぎれば逆に
過剰発火という副作用が別の一件で報告されている——どちらも n=1〜2 の当事者証言であり、
対照実験ではない。
