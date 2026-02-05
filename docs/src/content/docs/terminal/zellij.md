---
title: Zellij
description: Theme sync と plugin を組み込んだ Zellij の設定。
---

Theme sync、status bar、fuzzy finder、pane bookmark を組み込んだ Zellij の設定。

## Theme Sync

`theme-switch` command で Catppuccin / Tokyo Night / Nord を切り替えると、Zellij の layout と status bar の色も自動的に変わる。

## Plugin

| Plugin | 説明 |
|--------|------|
| Zjstatus | Git branch、時刻、mode 表示のある status bar |
| Monocle | pane / tab の fuzzy finder (`Ctrl+q` → `f`) |
| Harpoon | pane の bookmark 管理 (`Ctrl+q` → `b`) |

## Keybindings

prefix key は `Ctrl+q`。

### Prefix なし

| Key | 操作 |
|-----|------|
| `Ctrl+1-5` | tab 1-5 に切替 |

### Prefix mode (`Ctrl+q` →)

| Key | 操作 |
|-----|------|
| `h`/`j`/`k`/`l` | pane 間の focus 移動 |
| `H`/`J`/`K`/`L` | pane の resize |
| `Tab` / `Shift+Tab` | 次 / 前の tab |
| `t` | 新規 tab |
| `\` | 右に分割 |
| `-` | 下に分割 |
| `x` | pane を閉じる |
| `z` | 全画面切替 |
| `w` | floating 切替 |
| `e` | 埋込/float 切替 |
| `[` | scroll/copy mode |
| `d` | detach |

### Plugin shortcut

| Key | Plugin | 説明 |
|-----|--------|------|
| `f` | Monocle | pane/tab を検索して jump |
| `b` | Harpoon | bookmark した pane に切替 |

### Harpoon の操作

| Key | 操作 |
|-----|------|
| `a` | 現在の pane を bookmark に追加 |
| `j`/`k` or `↑`/`↓` | list 内を移動 |
| `Enter` | 選択した pane に jump |
| `d` | bookmark から削除 |
| `Esc` | 閉じる |

:::tip
pane が 2-3 個なら `Ctrl+q` → `h/j/k/l` で十分。5 個以上の pane を使うようになると Harpoon が便利。
:::

## Setup

Zellij 0.38.0 以上と、Rust の `wasm32-wasip1` target が必要。

```bash
rustup target add wasm32-wasip1
```

plugin は自動で download される。Harpoon を手動 build する場合:

```bash
git clone https://github.com/Nacho114/harpoon.git /tmp/harpoon
cd /tmp/harpoon
cargo build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/harpoon.wasm ~/.config/zellij/plugins/
```

## File 構成

```
~/.config/zellij/
├── config.kdl           # main の設定
├── layouts/
│   ├── catppuccin.kdl   # Catppuccin theme
│   ├── tokyonight.kdl   # Tokyo Night theme
│   ├── nord.kdl         # Nord theme
│   └── default.kdl      # active theme への symlink
└── plugins/
    ├── zjstatus.wasm    # status bar
    ├── monocle.wasm     # fuzzy finder
    └── harpoon.wasm     # pane 管理
```

## Status bar の表示内容

- Mode indicator (色付き背景)
- Session 名
- Git branch (10 秒間隔で自動更新)
- 日時 (Asia/Tokyo timezone)
- 通知 alert
- Tab 表示 (番号と icon 付き)

## Troubleshooting

### Plugin が読み込めない

1. Zellij の version を確認: `zellij --version`
2. plugin を source から rebuild
3. cache を削除: `rm -rf ~/.cache/zellij/`

### テーマが反映されない

1. file permission を確認: `ls -la ~/.config/zellij/layouts/`
2. session を再起動: `zellij kill-all-sessions`
3. theme-switch script を確認: `which theme-switch`

### Harpoon が crash する

1. `wasm32-wasip1` target が install 済みか確認
2. source から rebuild
3. config に `move_to_focused_tab true` があるか確認

## Customize

### テーマの追加

1. `layouts/theme-name.kdl` を作成
2. `theme-switch` script に新テーマを追加
3. 既存テーマの color pattern に合わせて設定

### Keybinding の変更

`config.kdl` を編集する。

```kdl
bind "Your Key" {
    LaunchOrFocusPlugin "file:~/.config/zellij/plugins/plugin.wasm" {
        floating true
    }
    SwitchToMode "normal"
}
```
