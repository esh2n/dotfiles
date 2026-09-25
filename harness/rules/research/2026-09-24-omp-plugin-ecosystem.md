# omp (oh-my-pi) のプラグイン生態系調査

日付: 2026-09-24
問い: 「omp にはプラグインが多い、調べたか」という指摘への応答。jig が omp に既に配っているもの（jig.ts 拡張・agents/*.md・mcp.json・skills・models.yml 経由の LiteLLM）と、omp 自身のプラグイン機構・実在プラグインを、四レンズ（ベンダー / 実践者 / 測定 / 実態）で突き合わせる。実装提案はしない。

## 方法と検証範囲の凡例

- 直接取得（一次情報）: `raw.githubusercontent.com/can1357/oh-my-pi/main/...` の docs 各ファイル、`api.github.com` 経由のリポジトリメタデータ・issue 検索・code 検索、ローカルの `omp plugin --help` / `omp plugin marketplace|discover|list|features` 実行結果（`$TMPDIR/omphome` に `HOME` を退避した使い捨て環境、何もインストールしていない）。
- 未到達: `gh` 認証はこのサンドボックス内で機能したため `curl -H "Authorization: token $(gh auth token)"` は不要だった。GitHub Code Search API (`/search/code`) は認証必須のクエリで `total_count: None / "Requires authentication"` となり不可（無認証の `curl` では 401 相当）。marketplace.json の横断コードサーチはこの経路では確認できなかった。
- 要約経由: なし。すべて直接 fetch または直接コマンド実行。
- 推論には `[unverified]` を付す。

---

## 各レンズの所見

### 1. ベンダー（omp 本体のドキュメントと実挙動）

**プラグインとエクステンションは別物、拡張の一種として `-e`/`~/.omp/agent/extensions/*.ts` を包含する上位概念。**

`docs/marketplace.md`（直接取得, https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/marketplace.md ）:
> "A **plugin** is a directory containing Claude/OMP plugin content such as skills, commands, agents, rules, hooks, tools, MCP servers, or LSP servers. ... installation symlinks the cached plugin into the scope's `node_modules` tree and records it in `omp-plugins.lock.json`, the same runtime surfaces used by npm-installed and `omp plugin link`ed plugins."

つまりプラグインは skills・commands・agents・rules・hooks・tools・MCP・LSP を1つのディレクトリにまとめて配布する単位で、jig.ts のような単発の `-e` 拡張ファイルより広い。マニフェスト（`package.json` の `omp.extensions`）経由で拡張モジュールも読み込める。

**サブコマンド一覧はユーザー指示どおりに実在（実行確認済み）**:
```
$ omp plugin --help
ACTION    Plugin action (install|uninstall|list|link|doctor|features|config|enable|disable|marketplace|discover|upgrade)
```
（ローカル実行、omp 18.0.4）

**マーケットプレイス制はデフォルトで空。何も入っていない。**
使い捨て `HOME` で実行した結果:
```
$ HOME=$TMPDIR/omphome omp plugin marketplace --json
No marketplaces configured
Add one with: omp plugin marketplace add <source>
$ HOME=$TMPDIR/omphome omp plugin discover --json
No plugins available
$ HOME=$TMPDIR/omphome omp plugin list --json
{"npm": [], "marketplace": []}
```
omp には Anthropic の Claude Code のような「公式プリセット済みマーケットプレイス」は同梱されていない。`docs/marketplace.md` のクイックスタート例が指すのは Anthropic 自身のリポジトリ:
```
/marketplace add anthropics/claude-plugins-official
/marketplace install wordpress.com@claude-plugins-official
```
`anthropics/claude-plugins-official` は実在し、2026-09-24 時点で ★36,676、"Official, Anthropic-managed directory of high quality Claude Code Plugins"（`api.github.com/repos/anthropics/claude-plugins-official`, 直接取得）。omp 独自の公式マーケットプレイスは can1357 のアカウント配下に存在しない（`api.github.com/users/can1357/repos` を全件確認、marketplace.json を持つ配布用リポジトリはなし）。

**Claude Code のプラグイン形式と互換（意図的な設計）。**
`docs/marketplace.md`:
> "The marketplace system lets you discover, install, and manage plugins from Git, local, or direct-catalog sources. It is compatible with the Claude Code plugin registry format."
> "Git and local sources must contain a catalog at `.omp-plugin/marketplace.json` (preferred) or `.claude-plugin/marketplace.json` (Claude Code-compatible fallback)."

これは jig が Claude Code にも omp にも配る側の設計と直接関係する事実: omp の plugin 経路は Claude Code の `.claude-plugin/marketplace.json` をそのまま読める。ただし完全互換ではない（後述の否定側証拠）。

**scope は user/project の2種類、project がシャドーする。**
> "Enabled project-scoped installs shadow enabled user-scoped installs of the same plugin. A disabled project install does not shadow the user install."

**インストール先**: `~/.omp/plugins/{marketplaces.json, plugins/installed_plugins.json, plugins/omp-plugins.lock.json, plugins/node_modules/<pkg>, plugins/cache/...}`。プロジェクトスコープは `<project>/.omp/plugins/...`。XDG 環境変数がある場合は `$XDG_DATA_HOME/omp` 配下（`omp config init-xdg` 実行時のみ、既存データは移動しない）。

**バージョニング**: セマンティックバージョンがある場合のみ新しいバージョン判定、それ以外は文字列不一致で「変更あり」扱い。`marketplace.autoUpdate` は `off|notify|auto`（デフォルト `notify`）。`docs/marketplace.md`:
> "Despite its name, current `notify` mode writes update availability only to the debug log; it does not show a user-facing notification."
これは「通知モード」という名前と実挙動の乖離で、ドキュメント自身が明記する否定的事実。

**信頼モデル: サンドボックスなし。インストールした時点で信頼済みコードとして実行される。**
`docs/plugin-manager-installer-plumbing.md`（直接取得, https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/plugin-manager-installer-plumbing.md ）:
> "Plugin code executes in-process when custom tool modules are imported; no sandboxing."
> "The plugin package itself is trusted code once installed."
> "No cross-process locking or merge strategy exists; concurrent writers can overwrite each other."

署名や第三者レビューの記述はドキュメント中に一切ない。唯一の入力検証はコマンドインジェクション対策（npm パッケージ名の正規表現とシェルメタ文字の denylist、git spec も同様の denylist）であり、コード内容そのものの審査ではない:
> "This limits command-injection risk when invoking `bun install/uninstall`."

インストールは非トランザクション的: `bun install` 失敗時はロールバックするが、`bun uninstall` 成功後にロックファイル書き込みが失敗すると「パッケージは消えたがランタイム状態が残る」ケースがあると明記されている（同ファイル、Failure table）。

**pi（earendil-works/pi）パッケージとの互換性は fallback で成立。**
`docs/plugin-manager-installer-plumbing.md`:
> "Manifest is resolved as: 1. `package.json.omp` 2. fallback `package.json.pi` 3. fallback `{ version: package.version }`"

`docs/extension-loading.md`（直接取得）も同じ fallback を確認:
> "Legacy `.pi` is still accepted in package manifests (`pi.extensions`) and project override lookup, but `.pi/extensions` is not a native root here."
> "Legacy Pi package-root imports resolve through compat shims: catalog symbols that moved to `@oh-my-pi/pi-catalog/models` ... are re-exported by the legacy pi-ai shim"

つまり pi 用に書かれた拡張パッケージ（`pi.extensions` マニフェスト）は omp でも動く設計だが、これは「omp 独自プラグイン形式」ではなく fork 元 pi との後方互換シムである。pi 本体は `earendil-works/pi`（★109,031、2026-09-24 時点更新継続中、`api.github.com/repos/earendil-works/pi` 直接取得）で、omp の README（直接取得）は "omp is a fork of Pi ... by Mario Zechner" と明記。

**omp 拡張（`-e`）とプラグイン拡張はロード順序が違うだけで、実行時の分離は同じ（サンドボックスなし）。**
`docs/extension-loading.md`:
> "Extensions are **not sandboxed** (same process/runtime)."
> "They share one `EventBus` and one `ExtensionRuntime` instance."

ロード順は「ネイティブ自動探索 → フックファクトリ → インストール済みプラグインの extension entry → 明示的な `-e`/`--extension` パス」。つまり `-e jig.ts` は最後にロードされるが、実行環境としてはプラグイン由来の拡張と完全に同格・同プロセス。

**built-in の機能で jig にない/誤解しがちなもの:**
- サブエージェント/オーケストレーションは **omp コアの組み込み機能**であり、プラグインで埋める余地ではない。README（直接取得, https://raw.githubusercontent.com/can1357/oh-my-pi/main/README.md ）:
  > "`task` — fan out subagents in parallel, optionally workspace-isolated." / "`orchestrate` — run substantial independent work through parallel subagents and verify each phase." / Agent Hub (`docs/agent-hub.md`) でコスト・所要時間付きのサブエージェント監視 UI が既にある。
- **メモリもコア機能**（`docs/memory.md`, 直接取得）: `off | local | hindsight | mnemopi | sharpshooter` の5バックエンドが標準搭載、デフォルト `off`。`hindsight` は can1357 自身の別リポジトリ（`can1357/hindsight`, "Agent Memory That Learns"）をリモートバックエンドとして使う設計。これは dotfiles 側の「外部メモリバックエンド（Mem0/Letta/Zep）を採用しない」という既存裁定と直接ぶつかる範囲の事実であり、判断はしないが記録する。
- **コスト表示もコア機能**: Agent Hub のサブエージェントカードに "cost and duration" が最初から出る（README, 直接取得）。

### 2. 実践者（名前の付いた運用者が何を使っているか）

このレンズは弱い。omp（can1357/oh-my-pi）は2025-12-31 作成の新しいプロジェクトで、"公開ブログでの omp プラグイン運用記" に相当する著名実践者の記事は見つからなかった。見つかったのは代わりに、プラグイン作者自身がリポジトリの README で運用理由を語っている一次情報（実践者と呼べるかはグレー、GitHub 上で名前付き個人・ハンドルが公開されている）:

- **wolfiesch/omp-best-of**（★68, 直接取得 README）— LLM-as-a-Verifier による best-of-N サンプリングを omp に実装。作者は限界を自己申告している:
  > "Published benchmark results belong to the upstream authors; this plugin has not established equivalent reliability."
  これは「試して、限定的な効果しか主張しない」型の誠実な実践者証言として扱える。
- **DarkPhilosophy/omp-headroom**（★12, 直接取得 README）— [Headroom](https://github.com/chopratejas/headroom) というコンテキスト圧縮プロキシを omp に統合。"Strict reduction gate" で圧縮後トークンが確実に減る場合のみ採用、という自己申告の安全装置がある。ただしこれも第三者検証ではなく作者の主張。
- **tchivs/gsd-omp**（★17, 直接取得 README）— サードパーティである旨を明記:
  > "This project is third-party software. It is not endorsed, reviewed, or maintained by OpenGSD."
- **mcbarlowe/omp-deck**（★22, 直接取得 README）— omp の GUI/cockpit を作った動機を明記:
  > "terminals weren't built for everything that comes with running an agent for hours a day: keeping track of what it's working on, glancing at it from another room..."
  この README はまた、omp-deck 自体のマーケットプレイス初期状態が `anthropics/claude-plugins-official` であることを screenshot キャプションで示している（"Marketplace browser populated with `anthropics/claude-plugins-official`"）— vendor レンズの裏取りにもなる。

owner が運用している Orca（`orca-*.ts`）についての公開実践記は見つからなかった。

### 3. 測定・証拠（数値のある評価）

ベンチマークやリーダーボードは**存在しない**。omp プラグイン単体を測定した独立ベンチマーク・論文・issue 由来の定量比較は見つからなかった。見つかった唯一の定量情報は GitHub のメタデータ（スター数・issue 数・更新日）で、ベンチマークではない。

**issue トラッカーが示す不具合・未達機能（実測ログ、否定側証拠として重要）**:
`api.github.com/search/issues?q=repo:can1357/oh-my-pi+plugin` の直接検索結果（`total_count: 229`）から抜粋:
- **#12999 (open)**: "Plugin settings marked secret are persisted unencrypted and lockfile may be world-readable" — セキュリティ issue、未解決。
- **#9521 (open, PR)**: "feat: hard per-subagent tool allowlist for MCP, extension, and custom tools" — 現状「サブエージェント単位でプラグイン由来ツールを強制的に絞る仕組みがない」ことの裏返し。
- **#7061 (open)**: "Agent `tools:` allowlist: unknown names silently dropped, and `write`/`hub` granted despite..." — 許可リストの黙示的な穴。
- **#12485 (open)**: "Marketplace plugin `.mcp.json` `timeout` is seconds per Claude Code, OMP reads it as millise[conds]" — Claude Code 互換性を謳いながら実装に単位バグがある実例。
- **#11362 (open)**: "Plugin agents/ not discovered for marketplace installs without `enabledProviders: [\"claude-...\"]`" — マーケットプレイスプラグインの `agents/` がデフォルトで拾われない相互運用バグ。
- **#12776 (closed)**: "`/extensions`: omp marketplace plugins render 'Disabled (~/config not enabled)' while load[ed]" — UI 表示と実挙動の不一致（修正済みだが発生していた）。
- **#12792 / #12801 (closed)**: `${CLAUDE_PLUGIN_ROOT}` がプラグイン MCP サーバーの stdio 起動で置換されていなかったバグ（修正済み）。
- **#12296 (closed)**: プラグインインストールが `~/.omp/plugins/package.json` に重複した dependency キーを追加し `bun` が壊れるバグ（修正済み）。

これらはすべて「issue トラッカーは負の情報に偏る」というバイアスを前提に読む必要があるが、件数（"plugin" を含む issue/PR だけで229件）自体が、この機能領域がまだ頻繁に壊れて頻繁に直されている、若い・流動的なサブシステムであることを示す数値。

### 4. 実態（公開リポジトリの採用状況）

GitHub topic 検索 `topic:omp-plugin`（直接取得, `total_count: 60`）の全件と、`"oh-my-pi" plugin` 検索（`total_count: 145`）の上位30件を確認。数値の要旨:

- 最大スター数は **czottmann/pi-automode（★174）**、次いで **hashgraph-online/awesome-ai-plugins（★336、ただし omp 専用ではなく Claude Code/Codex/Gemini/Antigravity/Grok/OpenCode 横断のキュレーションリスト）**。
- 純粋な omp 専用プラグインの中央値はごく低い。`topic:omp-plugin` の60件中、★10以上は10件未満、大半が★0〜4。
- 更新頻度は高い: 多くが2026-09の直近1ヶ月以内に push されている ＝ エコシステムは活発だが、どのプラグインも支配的なデファクトになっていない（1つが★数百〜千を突き放して独占、という状態ではない）。
- **公式/準公式マーケットプレイスカタログを名乗るリポジトリは複数の個人が別々に作っている**（`polin-x/omp-plugins`「Oh My Pi marketplace catalog」★0、`boazy/omp-plugins`★1、`xaviergmail/omp-plugins`★0）。`polin-x/omp-plugins` の中身を直接取得すると、実際に掲載されているプラグインは1つだけ（`bilingual@polin-plugins`）:
  > "Oh My Pi marketplace. Currently lists one plugin."
  「マーケットプレイスを名乗るリポジトリがある」ことと「そこに中身がある」ことは別、という実態。
- **見せかけの一致に注意**: `"oh-my-pi" plugin` 検索でヒットした `pulseaiclub/phi`（★514）は omp のプラグインではなく、`omp`/`oh-my-pi` を topics に含む**別のコーディングエージェント本体**（Go 実装、"a coding agent, rpc plugin, sub-agents..."）。検索結果の星数だけを見て omp プラグインの人気と誤読しないよう検証した。

**カテゴリ別の実在プラグイン（★と最終更新は `api.github.com` 直接取得、2026-09-24 時点）**:

| プラグイン | 分野 | ★ | 最終 push | ライセンス |
|---|---|---|---|---|
| DarkPhilosophy/omp-headroom | コンテキスト圧縮プロキシ統合 | 12 | 2026-07-27 | GPL-3.0 |
| AshishKumar4/better-compact | コンテキストプルーニング（OpenCode/omp/pi/Claude Code 横断） | 15 | 2026-09-24 | AGPL-3.0 |
| tchivs/gsd-omp | サブエージェント/ゴール状態オーケストレーション連携 | 17 | 2026-09-17 | MIT |
| wolfiesch/omp-best-of | Best-of-N サンプリング＋検証者選択 | 68 | 2026-09-02 | MIT |
| mcbarlowe/omp-deck | Web cockpit（kanban/inbox/Telegram/マーケットプレイスUI） | 22 | 2026-05-29 | MIT |
| bjb2/omp-deck (fork) | 同上のフォーク | 16 | 2026-07-22 | — |
| unkeyn/oh-my-pi-gui | Windows ネイティブ GUI | 20 | 2026-08-16 | — |
| Po1nt9/omp-web | ローカル Web UI | 11 | 2026-07-27 | — |
| 3xian/omp-quick-commit | git コミット/push ショートカット | 2 | 2026-09-16 | MIT |
| korri123/omp-plugin-duplicate-detector | jscpd ベースの重複コード検出 | 3 | 2026-09-06 | — |
| metaphorics/omp-plugin-dynamic-system-prompt | モデル別にシステムプロンプトを動的調整 | 9 | 2026-08-25 | — |
| polin-x/omp-plugins | コミュニティ製マーケットプレイスカタログ（中身1件） | 0 | 2026-09-14 | — |

---

## 否定側の証拠

- **公式マーケットプレイスが存在しない。** 素の `HOME` では `omp plugin marketplace/discover/list` すべて空。ユーザーが自分でマーケットプレイスを `add` するまで何も見えない（ローカル実行で確認、上記）。
- **サンドボックスなし・署名なしが公式ドキュメントに明記。** "no sandboxing", "trusted code once installed"（`docs/plugin-manager-installer-plumbing.md`）。これは jig の guard 思想（PreToolUse でガードする、権限は最小許可）と直接対立する信頼モデル。プラグインを入れた時点でガードの外側で任意コードが実行される。
- **セキュリティ issue が未解決（#12999、シークレットが平文でロックファイルに残り world-readable の可能性）。**
- **Claude Code 互換を謳いながら実装に相互運用バグが複数ある**（`.mcp.json` の timeout 単位不一致 #12485、`agents/` が `enabledProviders` 未設定だと拾われない #11362、`${CLAUDE_PLUGIN_ROOT}` 未展開だった #12792/#12801）。「互換」は設計意図であって、無条件の実証済み事実ではない。
- **`notify` という名前のアップデート通知モードが実際には通知しない**（debug log にのみ記録、"does not show a user-facing notification" と原文明記）。
- **非トランザクション的な失敗モード**: `bun uninstall` は成功したがロックファイル書き込みが失敗すると、パッケージは消えているのにランタイム状態が残留する。同時書き込みに対するロックもない（"No cross-process locking or merge strategy exists"）。
- **プラグイン作者自身が効果を限定的にしか主張していない例がある**（wolfiesch/omp-best-of: "this plugin has not established equivalent reliability"）— 独立検証なしに効果を鵜呑みにしないことの裏付け。
- **マーケットプレイスを名乗るリポジトリの中身が薄い**（polin-x/omp-plugins は1プラグインのみ）。「マーケットプレイスがある」＝「選択肢が豊富」ではない。
- **どのコミュニティプラグインも支配的な採用規模に達していない。** 最大でも★68（omp-best-of）、大半は★20未満。「多くの人が使っている」と言える定量的な支配的プラグインは確認できなかった。

---

## 確認できなかったこと

- GitHub Code Search（`/search/code`）はこのセッションの認証状況では利用不可（"Requires authentication" で `total_count: None`）だったため、`.omp-plugin/marketplace.json` を持つリポジトリの網羅的な横断検索はできていない。topic 検索とキーワード検索でカバーした範囲に限られる。
- npm レジストリでの `omp plugin install <pkg>`（npm 経由インストール）のダウンロード数統計は取得していない（npm search/API を叩いていない）。プラグインの実利用規模は GitHub スター数のみに基づく近似値。
- 名前の付いた著名プラクティショナー（技術系インフルエンサー、企業のエンジニアリングブログ等）による「omp プラグインを使ってみて、やめた/続けている」という体験記は見つからなかった。プロジェクト自体が2025-12-31作成と新しく、母数が少ない可能性が高い [unverified]。
- omp 本体の plugin システムに対する独立監査（セキュリティレビュー等）の報告は見つからなかった。
- Orca（owner が別途運用している `orca-*.ts` 拡張）が omp のプラグイン機構経由で配布されているか、独自の `-e` 拡張ファイルのままかは、今回の調査範囲（omp/community plugin エコシステム）では確認していない。

---

## 結論

**プラグイン機構自体は実在し、jig が配っているものより広い範囲（skills・commands・agents・rules・hooks・tools・MCP・LSP を1パッケージにまとめて配布できる点）をカバーする。** ただし:

1. **「業界標準」と呼べる採用実績のあるプラグインは、現時点のエコシステムには存在しない。** 60件以上のプラグインが `topic:omp-plugin` で見つかるが、最大でも★68。deファクトの定番は形成されていない（omp 自体が2025-12-31生まれで若いため [unverified] だが、issue 件数・push 頻度から見て活発に変化し続けている段階と判断できる）。

2. **jig が既にコアでやっていること（guard・formatting・gate・skill routing・tier routing・session record・MCP delivery）と、プラグインで置き換えるべき機能は重ならない。** guard は「omp の外側からプロセスを縛る」設計だが、プラグインは「omp プロセスの内側でサンドボックスなしに動く信頼済みコード」（`docs/plugin-manager-installer-plumbing.md` 原文明記）なので、プラグインで guard 相当を実装しても保証のレイヤーが違う。skill routing・MCP delivery は jig が生成する `agents/*.md`・`mcp.json`・`~/.agents/skills` で既に配っており、プラグインのマニフェスト機構（`omp.extensions`／`skills/`／`.mcp.json` 自動発見）は「配る手段」が別にもう1つ増えるだけで、jig の一次配布経路を置き換える理由にはならない。

3. **サブエージェント・メモリ・コスト表示は omp のコア機能であり、プラグインで埋めるべき「欠けている能力」ではない。** README・`docs/memory.md`・`docs/agent-hub.md` が直接示している。これらを「プラグインで足りないものを埋める」候補として調べるのは前提が誤り。

4. **プラグインで実際に埋まりうる隙間（jig にない機能）は、web UI（omp-deck/oh-my-pi-gui/omp-web の3系統が並立し統一候補なし）、コンテキスト圧縮プロキシ統合（omp-headroom/better-compact、いずれも★20未満で作者自身も効果を限定的にしか主張していない）、git ショートカット（omp-quick-commit、★2）、重複コード検出（★3）程度。いずれも採用の裏付けとなる測定・実践者評価が薄く、「試して定着した」という肯定的な実例も「試してやめた」という否定的な実例も、今回の調査では見つからなかった（母数が少なすぎて実例自体が乏しい）。**

5. **信頼モデルの違いは無視できない。** プラグインはインストール即座に「サンドボックスなしの信頼済みコード」として同一プロセスで実行される（ドキュメント原文）。jig の一次防御線（PreToolUse guard）の外側にコードを持ち込むことになる。セキュリティ issue（#12999、シークレット平文保存）も未解決のまま残っている。

**まとめ**: 「多いから調べていないのはまずい」という指摘は妥当で、プラグイン機構自体の仕様は明確に文書化されている一次資料があった。しかし調べた結果、**「採用すべき業界標準」と呼べるプラグインは今のところ存在しない**。jig が既に配っているものと重複する領域（guard・skill/MCP配布・サブエージェント・メモリ・コスト表示）にプラグインを追加導入する根拠はなく、むしろ信頼モデルの後退（サンドボックスなし）になる。jig が持たない領域（web UI・コンテキスト圧縮・git ショートカット）を埋める候補は複数あるが、いずれも小規模・若い・独立検証なしであり、「採用する」ではなく「観察を続ける」段階にあるというのが今回の証拠が支持する結論。
