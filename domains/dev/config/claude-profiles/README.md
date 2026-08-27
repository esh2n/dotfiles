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
```

- 各パックは `skills/ agents/ commands/ rules/ workflows/`(任意で `hooks/` と
  `settings.layer.json`)を持ち、有効化すると `~/.claude` のマージ結果に
  加わる(セッションに載るコンテキストもその分だけ)。hook の登録方法は
  「パックが hook を持つ場合」を参照。
- マシンごとの選択は `~/.claude/.claude-packs`(git 管理外)。初回は
  `packs.default` から複製される。

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
  "workflowDailyCap": 5
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
