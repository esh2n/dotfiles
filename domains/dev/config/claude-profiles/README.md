# claude-profiles — "yoki" (良き)

Claude Code の設定を3層で合成して `~/.claude` に展開する、自分専用の設定
パック。ハーネス(hooks/permissions) + ループ(/loop, cron, 是正検出) +
グラフ(workflows) をまとめて **yoki** と呼ぶ。`yoki-switch`(旧名 `claude-switch`
はエイリアスとして残る)だけで完結する。

もとは ECC (Everything Claude Code) のベンダリングから出発したが、
2026-08-03 に上流追従を廃止して独立メンテに切り替えた(来歴は
`runtime/yoki/ORIGIN`)。

レイヤは弱→強の順にマージされ、**同名衝突と設定キーは常にpersonalが勝つ**
(由来ではなく「個人性」で層が決まる。deny listのみ両層のunion):

```
claude-profiles/
├── core/           # 汎用デフォルト(常時ON): tdd-workflow 等の skills,
│                   # planner/code-reviewer 等の agents, rules/common,
│                   # workflows/(グラフ層), settings.layer.json, CLAUDE.layer.md
├── packs/          # 言語/ドメイン別のON/OFF単位(中間)。デフォルト全OFF
│   ├── go/ typescript/ react/ design/ db/ ddd/ clean-arch/ gcp/ k8s/
│   └── python/ rust/ kotlin/ java/ cpp/ perl/ php/ django/ flutter/ csharp/ swift/
├── personal/       # 個人資産(常時ON・最優先): 自作 skills/hooks/commands/scripts,
│                   # settings.personal.json, CLAUDE.personal.md
├── runtime/yoki/   # hook 実行系(scripts/hooks, scripts/lib,
│                   # continuous-learning-v2, .cursor/rules)。独立メンテ
└── packs.default   # 新規マシンでの初期有効パック
```

さらに外側の優先順位も同じ勾配に乗る:
core → packs → personal → `~/.claude/settings.local.json`(マシン固有)
→ プロジェクトの `.claude/settings.json` / `.yoki.json`(最優先)。
例外はhookの実行順のみpersonal先行 — ガード(git-guard)が
書き換え系hook(rtk-rewrite)より先に元のコマンドを見る必要があるため。

## 3層アーキテクチャ

| 層 | 実体 | 役割 |
|---|---|---|
| Harness | hooks + permissions (settings.*.json) | 決定論的ガードと観測。git-guard(3段階: deny / warn-once / allow)、quality-gate、audit |
| Loop | /loop, cron routines, correction-detect | 時間軸の自動化。是正シグナル駆動の学習 |
| Graph | core/workflows/ → ~/.claude/workflows/ | 多エージェント制御フローの決定論的スクリプト |

## 使い方(利用者)

```bash
yoki-switch                     # 対話でパックをトグルして適用
yoki-switch pack list           # 有効/利用可能パックの一覧
yoki-switch pack enable kotlin  # パックを有効化して適用
yoki-switch pack disable kotlin # 無効化して適用
yoki-switch apply               # 選択を変えずに再合成
yoki-switch doctor              # claude/codex/omp/artifact をヘルスチェック
```

- 各パックは `skills/ agents/ commands/ rules/ workflows/`(任意で `hooks/` と
  `settings.layer.json`)を持ち、有効化すると `~/.claude` のマージ結果に
  加わる(セッションに載るコンテキストもその分だけ)。hook の登録方法は
  「パックが hook を持つ場合」を参照。
- マシンごとの選択は `~/.claude/.claude-packs`(git 管理外)。初回は
  `packs.default` から複製される。

## Targets

`~/.claude` は core/packs/personal をそのままマージした結果だが、Codex CLI
(`~/.codex`) と omp (`~/.omp/agent`) は設定フォーマットが別物なので、同じ
3層ソースから**変換して生成**する。この変換を担うのが
`runtime/yoki/scripts/lib/targets/{codex,omp}.js`(`gen.js` 経由で実行、
task T9/T10)で、`yoki-switch apply` が内部で呼び出す:

```bash
yoki-switch apply                     # claude + codex + omp をすべて再生成
yoki-switch apply --target omp        # omp だけ再生成(--target は繰り返し指定可)
yoki-switch apply --target codex --target omp
yoki-switch apply --target codex --dry-run   # 書き込まず、計画した操作を表示
```

- 各ターゲットの `--out` はその CLI のホームディレクトリ
  (`~/.codex`、`~/.omp/agent`)。ホームディレクトリが**存在しない**マシンでは
  そのターゲットを1行のinfoログでスキップする(そのCLIを一度も使っていない
  = インストールされていない、とみなす。`~/.codex`や`~/.omp/agent`をゼロから
  作ったりはしない)。
- `--dry-run` は codex/omp のジェネレータにそのまま渡り、書き込みをせず
  計画した操作(`write`/`symlink`/`merge-json`/`remove` 等)を標準出力に
  列挙する。`claude` ターゲットにはdry-runモードが無いため、`--dry-run` と
  同時に指定されると1行の注記を出してそのターゲットだけスキップする。

### managed-block / marker 規約

Codex/ompのホームディレクトリには hook 状態やユーザー自身の追記
(`~/.codex/config.toml` の `[projects.*]` など)が同居している。生成物は
それらを壊さないよう、**マーカーで区切った自分のブロックだけ**を
置き換える(`runtime/yoki/scripts/lib/targets/managed-block.js` の
`extractBlock`/`wrapBlock` が共通実装):

- `config.toml`: `# yoki:begin` 〜 `# yoki:end`
- `AGENTS.md` / `RULES.md`: `<!-- yoki:begin -->` 〜 `<!-- yoki:end -->`
- `hooks.json`: マーカーではなくグループ単位でマージ
  (`codex-hooks-merge.js`)。yoki以外が追加したフックグループは
  そのまま先頭に残し、yoki自身の旧グループだけを差し替える
- スキル/コマンドの symlink (`~/.codex/skills/<name>` など)は
  `.yoki/codex-manifest.json` で自分が置いたものだけを記録し、
  `--prune` 実行時に元ソースが消えたものだけ削除する

マーカーブロックの外、`[projects.*]`のような**マシンローカルな追記は
決して上書きされない** — 2回目以降の `apply` も、その部分は
バイト単位で不変(冪等性のテストは
`core/validation/test-yoki-switch-targets.sh` 参照)。

### doctor

`yoki-switch doctor [--json]`(実体は `runtime/yoki/scripts/lib/doctor.js`、
task T14)は4ターゲットの実際の状態を読むだけの診断コマンドで、何も書き込まない。
1チェック1行、`[ok|warn|fail] <target> <check> — <hint>` を出力し、
**`fail` が1件でもあれば終了コード1**(`warn` は0のまま)。

- **claude**: `~/.claude` のマージdirシンボリックリンクが解決するか、
  `settings.json` がパースできるか、そこから参照される hook スクリプトが
  存在し実行可能か、`.yoki/permissions.json` が存在するか
- **codex**: `codex --version`(最低 `0.147.0`、推奨 `0.150.0`
  以上 — `0.147.0` 未満は fail、`0.147.0`〜`0.150.0`未満は warn = Interrupt
  hook 未対応。どちらのメッセージにも更新コマンドそのもの
  `brew upgrade --cask codex` を出す。`gen.js`側(`lib/targets/codex.js`の
  `plan()`、task T32)も同じ`codex --version`を apply 時に一度読んで
  plan結果に`codexVersion`としてキャッシュし、設定レイヤーに
  `Interrupt`フックが宣言されていてもインストール済みバージョンが
  `0.150.0`未満(またはバージョン不明)なら warning 付きでスキップする —
  `hooks.json`に未対応イベントを書いて `codex exec` に無言で無視させない
  ため)、`~/.codex` の有無、`[features] hooks = true`、
  自分が生成した `hooks.json` グループの有無、**その全ハンドラの
  `[hooks.state]` 信頼ハッシュを再計算して一致するか**(ズレていたら
  「codex exec で無言スキップされる、yoki-switch apply を実行」と案内)、
  yoki以外のフォアングループの一覧、`codex execpolicy check` による
  `rules/yoki.rules` の構文チェック(バイナリが無ければ warn でスキップ)、
  `default_permissions` と `sandbox_mode` のトップレベル衝突、
  `core/harness-models.json` の codex tier が `~/.codex/models_cache.json`
  に実在するか(warn)、skills symlink の解決、`~/.agents/skills` のリンク数
- **omp**: `omp --version`(`< 18.0.4` で warn)、拡張シンボリックリンクの
  解決、`config.yml` が(symlinkでなく)生成済みの実ファイルか、
  `yoki-hooks.json` のパース、`omp-doctor.json` に列挙されたプローブ対象
  パスの可読性、`functions.zsh` の `omp()` ラッパーに
  `--no-extensions -e` があるか
- **artifact**: `yoki-artifact` が入っていれば `yoki-artifact doctor` に
  委譲、無ければ1行 `ok` でスキップ

`hooks.json` は Codex 実機では `{"hooks": {<Event>: [...]}}` の
ラップ形式で書かれる(spike S1+S2 Appendix C の実測ハッシュで確認済み)。
`codex-hooks-merge.js` 自身の生成物・テストは今のところラップ無しの
フラット形式を前提にしているため、`doctor.js` はどちらの形も読めるように
`unwrapHooksJson()` で吸収している — 生成側とdoctor側で前提が食い違って
いること自体は既知の不一致として残っており、直すなら生成側(T9)の仕事。

`lib/test/doctor.test.js` は純粋な部分(バージョン比較、
`[hooks.state]` の信頼ドリフト検出、`default_permissions`/`sandbox_mode`
衝突検出)をテキスト/一時ホームだけでテストし、実際の `codex`/`omp`
バイナリや `yoki-artifact` には依存しない。

### どのファイルがマシンローカルか

`apply` は基本的に「毎回丸ごと再生成」だが、マーカーブロックの外や
ジェネレータが関知しない部分にはこのマシンだけの状態が残り続ける。
2回目以降の `apply` でこれらが失われないことは
`core/validation/test-yoki-switch-targets.sh` の冪等性テストで担保している:

- `~/.claude/.claude-packs` — このマシンで有効なパックの選択(git管理外。
  初回は `packs.default` から複製)
- `~/.claude/settings.local.json` — マシン固有設定(レイヤ優先順位の
  `personal` の次、プロジェクト設定の手前)
- `~/.codex/config.toml` のマーカーブロック外(`[projects.*]` などCodex
  自身が書く設定、および手で追記した内容)
- `~/.codex/models_cache.json` / ログイン状態 — `doctor` は読んで
  診断に使うだけで、生成器はどちらも一切書かない
- `~/.omp/agent/config.yml` の `symbolPreset`/`composer`/`theme`/
  `setupVersion` の4キー — omp自身が実行時に書き換える値なので、
  それ以外を毎回丸ごと再生成する `omp-config-yml.js` もこの4つだけは
  既存ファイルから引き継ぐ
- `<out>/.yoki/codex-manifest.json` / `<out>/.yoki/omp-manifest.json` —
  このマシンで最後に `apply` が置いた生成物の記録(`--prune` 専用、
  コミット対象外)
- `~/.config/yoki-artifact/config.json` — `baseUrl`/`clientId` のみ。
  client secret はここには書かず `secretCommand` 経由で毎回引く

### yoki-graph

`core/workflows/*.js`(Claude Code の Workflow tool が実行するのと同じ
スクリプト)を Codex/omp からも起動するための CLI
(`domains/dev/bin/yoki-graph`、実体は `runtime/yoki/scripts/lib/graph/`)。
Claude Code の中ではネイティブの Workflow tool がそのまま本来の経路で、
yoki-graph に切り替える必要はない — Workflow tool を持たない harness から
同じグラフを動かしたいとき、または `--resume`/`status` でランを直接
触りたいときに使う。詳細なコマンド一覧・ワークフロー別の引数は
`core/skills/yoki-graph/SKILL.md` を参照:

```bash
yoki-graph run review --backend codex --args '{"range":"origin/main...HEAD"}'
yoki-graph list
yoki-graph status <runId>
```

### yoki-loop

Codex/omp には Claude Code の `/loop` に相当するセッション内蔵の定期実行が
無いため、その代わりに launchd/cron から呼ばれる外側のheadlessランナーを
`domains/dev/bin/yoki-loop` として用意している。詳細は後述の
「Loop レイヤー(task T19)」を参照。

### yoki-artifact

`writeup`/`eli5`/`show-me` などが作った HTML 1枚を、Claude/Codex/ompの
どこから呼んでも同じ private URL に発行・更新できる CLI
(`domains/dev/bin/yoki-artifact`、実体は
`core/skills/yoki-artifact/bin/yoki-artifact.mjs`)。Claude Code内で完結する
1回きりのページはネイティブの Artifact tool の方が手数が少ない —
yoki-artifact を選ぶのは Artifact tool を持たない harness から公開したい、
同じページを複数harnessから更新し続けたい、コメントをCLIから読み書き
したいときだけ。使い方の全体は `core/skills/yoki-artifact/SKILL.md`。

**初期設定はマシンごとに一度だけ必要**: Cloudflare Workers + R2 + D1 +
Access を立てる手作業(Zero Trust オンボーディング、IdP登録など)と、
そこから先の自動セットアップ(`worker/scripts/setup.mjs`)に分かれる。
手順は `core/skills/yoki-artifact/worker/SETUP.md` を参照— この手作業を
飛ばすと自動セットアップは必ず失敗するので、必ず上から順に読むこと。

### 4つ目のターゲットを足す場合

1. `runtime/yoki/scripts/lib/targets/<name>.js` を作り、`codex.js`/`omp.js`
   と同じ形の `plan({sources, out, home, env, prune, dotfilesRoot})` を
   export する(戻り値は `{target, out, home, sources, operations,
   warnings}`、`operations` の各要素は `{kind, destinationPath,
   sourcePath?, content?, layer}`)
2. `gen.js` の `TARGETS` マップに登録し、必要なら `defaultOutFor()` に
   デフォルトの `--out` を追加
3. `yoki-switch` の `apply()` に `--target <name>` の分岐と、そのCLIの
   ホームディレクトリ変数(`<NAME>_DIR` のように環境変数で上書き可能に)
   を追加。既存の `apply_target_generator()` はターゲット名と `--out` を
   渡すだけで動くので、専用ロジックを書く必要はない
4. マシンローカルな追記を壊さないターゲットなら、上記の managed-block
   規約に沿ってマーカーで自分のブロックを区切る

## Loop レイヤー(task T19)

Claude Code は `/loop`(このリポジトリの core skill)でセッション内蔵の
定期実行ができるが、Codex CLI と omp にはそれに相当するものがない —
どちらもワンショットの headless 実行(`codex exec` / `omp -p`)しか持たず、
「30分ごとに動かし続ける」仕組みはハーネスの外に自分で用意する必要がある。
`domains/dev/bin/yoki-loop` がその外側の仕組み。node launcher(ゼロ依存、
実体は `runtime/yoki/scripts/lib/loop/*.js`)で、launchd(macOS)や cron
から呼ばれる前提の headless ランナー:

```bash
yoki-loop run demo --harness codex --cwd . --prompt "check CI" --dry-run
#   claude|codex|omp ごとに、そのCLIのheadlessコマンドを組み立てて実行
#   (claude: -p --output-format json、codex: exec --json、stdinでprompt、
#   omp: -p --mode json --no-extensions -e <yoki-bridge.ts> でguardを維持)
#   --model はcore/harness-models.jsonで tier -> harness別モデルIDに変換
#   --resume はそのloop名の最後のsessionId(runs.jsonlから)を渡す
#   --prompt-from-artifact-inbox は yoki-artifact の未読コメントを
#   "Address these artifact comments: …" に整形して渡し、既読化する

yoki-loop install demo --harness codex --cwd . --prompt "check CI" --every 30m
#   ~/Library/LaunchAgents/dev.yoki.loop.demo.plist を書くだけ
#   (launchctl bootstrap は実行せず、コマンドを表示するだけ)
yoki-loop uninstall demo   # plistを消してbootoutコマンドを表示
yoki-loop status [demo]    # 直近の実行(runs.jsonl)と次回実行の推定時刻
yoki-loop list             # インストール済みloop一覧
```

- 実行ごとに `~/.local/state/yoki/loop/<name>/runs.jsonl` に1行追記
  (`{ts, harness, cmd, exit, durationMs, sessionId}`)。`.yoki.json` の
  `loopDailyCap`(既定24、`workflowDailyCap` と同じ思想)を超えると
  `run` はエラーで止まる — `--dry-run` はこのcapの対象外
- `install` は plist を書いて `launchctl bootstrap gui/$UID <plist>` を
  **表示するだけ**(実行しない)。実際に有効化するかはユーザーの判断

## プロジェクト単位の設定 (.yoki.json)

プロジェクトのルート(または祖先ディレクトリ)に `.yoki.json` を置くと、
そのプロジェクトでのhook挙動を絞り込める(envより優先、壊れたJSONは無視):

```json
{
  "hookProfile": "minimal",
  "disabledHooks": ["post:quality-gate", "post:bash:pr-created"],
  "langs": ["go", "typescript"],
  "allowMainBranchWork": true,
  "unattended": false,
  "workflowDailyCap": 5,
  "loopDailyCap": 24
}
```

- `hookProfile`: minimal | standard | strict — このプロジェクトでのhook強度
- `disabledHooks`: hook ID の配列 — 個別に無効化
- `allowMainBranchWork`: 個人リポジトリ向け。main が作業ブランチで PR を
  作らない運用のとき、git-guard の **main/master への push 拒否2件と
  main 上コミットの警告だけ**を解除する。force push・`reset --hard`・
  `clean -f`・`--no-verify`・identity チェック・PR ゲートは**解除されない** —
  これらはブランチ方針ではなく破壊と衛生の話なので、プロジェクトファイルから
  外せてしまうとそれは設定ではなく迂回路になる
- `unattended`: 無人実行中とみなし、ガードレール自身の書き換えを禁止する
  (unattended-guard.sh)。`YOKI_UNATTENDED=1` と同じ意味
- `workflowDailyCap`: Workflow の1日あたり起動上限(既定5)
- `loopDailyCap`: `yoki-loop`(Loop レイヤー)の1日あたり実行上限(既定24)
- `langs`: このプロジェクトが使う言語pack名。packはマシン単位でしか
  有効化できない(ハーネス制約)ため自動切替はできないが、宣言したpackが
  無効ならセッション開始時に有効化コマンドが提示される
  (yoki-project-hint.sh)。packs.defaultは空=全OFFが既定

rules は `paths:` frontmatter による条件ロードなので、プロジェクトに
該当ファイルが無ければ元々ロードされない(例: Goを触らないプロジェクトで
go規約は載らない)。skillの説明文はグローバルに載る仕様のため、
プロジェクト単位の絞り込みは現状パック単位(`yoki-switch pack`)のみ。

## メンテナンス

上流追従(旧 `ecc-sync`)は廃止済み。runtime/yoki 配下は通常のコードとして
直接編集・刈り込みしてよい。外部の良い実装を見つけたら個別に移植し、
出典をコメントか ORIGIN 追記で残す。

## パックの追加

1. `packs/<name>/{skills,agents,commands,rules,workflows}` を作って中身を置く
2. 必要なら `packs.default` に追記
3. `yoki-switch pack enable <name>`

### パックが hook を持つ場合

`hooks/` も `MERGE_DIRS` の対象で、有効化すると `packs/<name>/hooks/*` が
`~/.claude/hooks/` へシンボリックリンクされる(`yoki-switch:109` `MERGE_DIRS`)。
ただしそれだけでは **実行されない** — hookのファイル配置と、settings.json の
`hooks.<Event>` への登録は別物。登録側は
`packs/<name>/settings.layer.json` を置くと、有効化中だけ
`core/settings.layer.json` と `personal/settings.personal.json` の間に
マージされる(`merge_settings()`、`yoki-switch` 内。core < packs < personal
の優先順で、hooks配列は personal → packs → core の順に並ぶ。0パックなら
今まで通り core+personal の2層のまま)。

```json
// packs/<name>/settings.layer.json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit", "hooks": [
        { "type": "command", "command": "\"${YOKI_NODE:-node}\" ~/.claude/hooks/<name>-guard.js" }
      ]}
    ]
  }
}
```

**注意**: `runtime/yoki/scripts/hooks/run-with-flags.js`(プロファイル
gatingの標準ランナー)は `CLAUDE_PLUGIN_ROOT`(= 常に `runtime/yoki`。
`core/settings.layer.json` の `env` でグローバルに固定)配下のスクリプトしか
`require()` できない — path traversal ガードが `packs/<name>/hooks/` は
もちろん、シンボリックリンク先の `~/.claude/hooks/` すら拒否する(実測
済み)。そのため pack 製 hook は `run-with-flags.js` を経由できず、上の例の
ように直接 `node ...` で起動し、プロファイル gating を自前で行う必要がある
(`runtime/yoki/scripts/lib/hook-flags.js` を `$YOKI_ROOT` 経由で直接
`require` する — `run-with-flags.js` 自身が使っているのと同じモジュール)。
実装例: `packs/go/hooks/go-guard-post-edit.js`、詳細は
`packs/go/rules/golang/hooks.md`。
