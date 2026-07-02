# claude-profiles

Claude Code の設定を3層で合成して `~/.claude` に展開する。利用者は ECC
(Everything Claude Code) の存在を意識する必要はない — 中身はすべてこの
リポジトリに取り込み済みで、`claude-switch` だけで完結する。

```
claude-profiles/
├── base/           # 個人資産(常時ON): 自作 skills/hooks/commands/scripts,
│                   # settings.base.json, CLAUDE.base.md
├── core/           # 汎用コンテンツ(常時ON): tdd-workflow 等の skills,
│                   # planner/code-reviewer 等の agents, rules/common,
│                   # settings.layer.json, CLAUDE.layer.md
├── packs/          # 言語/ドメイン別のON/OFF単位
│   ├── go/  typescript/  python/  rust/  frontend/   # デフォルトON
│   ├── kotlin/  java/  cpp/  perl/  php/  django/  flutter/  csharp/  swift/
│   └── experimental/   # 未使用・上流廃止のコマンド群(既定OFF)
├── runtime/ecc/    # ECC hook 実行系のベンダリング(scripts/hooks, scripts/lib,
│                   # continuous-learning-v2, .cursor/rules)。ECC_VERSION に固定SHA
├── packs.default   # 新規マシンでの初期有効パック
└── ECC_VERSION     # runtime の同期元コミット
```

## 使い方(利用者)

```bash
claude-switch                     # 対話でパックをトグルして適用
claude-switch pack list           # 有効/利用可能パックの一覧
claude-switch pack enable kotlin  # パックを有効化して適用
claude-switch pack disable kotlin # 無効化して適用
claude-switch apply               # 選択を変えずに再合成
```

- 各パックは `skills/ agents/ commands/ rules/` を持ち、有効化すると
  `~/.claude` のマージ結果に加わる(セッションに載るコンテキストもその分だけ)。
- マシンごとの選択は `~/.claude/.claude-packs`(git 管理外)。初回は
  `packs.default` から複製される。

## メンテナンス(メンテナのみ)

runtime を上流 ECC に追従させる:

```bash
claude-switch ecc-sync            # origin/main に同期(要: ECC リポの clone)
claude-switch ecc-sync <ref>      # 任意の ref に固定
```

`ecc-sync` は `$ECC_ROOT`(なければ dotfiles の隣の everything-claude-code)を
fetch し、`git archive` で runtime/ecc を差し替えて `ECC_VERSION` を更新する。
skills/agents/commands 側の上流差分はコマンド末尾に出るヒントで確認し、
必要なものだけ手動で core/ や packs/ に取り込む。

## パックの追加

1. `packs/<name>/{skills,agents,commands,rules}` を作って中身を置く
2. 必要なら `packs.default` に追記
3. `claude-switch pack enable <name>`
