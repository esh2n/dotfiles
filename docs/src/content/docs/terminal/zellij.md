---
title: Zellij
description: Theme sync と plugin を組み込んだ Zellij の設定。
---

Theme sync、status bar、fuzzy finder、pane bookmarkを組み込んだZellijの設定。

## Theme Sync

`dotctl theme set`（別名`theme-switch`）でテーマを切り替えると、`config.kdl`の`default_layout`が書き換わり、Zellijのlayoutとstatus barの色も変わる。

## Plugin

| Plugin | 説明 |
|--------|------|
| Zjstatus | Git branch、時刻、mode表示のあるstatus bar |
| Monocle | pane / tabのfuzzy finder (`Ctrl+q` → `f`) |
| zellij-pane-picker | 星を付けたpaneへの切替 (`Ctrl+q` → `b`) |

## Keybindings

prefix keyは`Ctrl+q`。

### Prefixなし

| Key | 操作 |
|-----|------|
| `Ctrl+1-5` | tab 1-5に切替 |

### Prefix mode (`Ctrl+q` →)

| Key | 操作 |
|-----|------|
| `h`/`j`/`k`/`l` | pane間のfocus移動 |
| `H`/`J`/`K`/`L` | paneのresize |
| `Tab` / `Shift+Tab` | 次 / 前のtab |
| `t` | 新規tab |
| `\` | 右に分割 |
| `-` | 下に分割 |
| `x` | paneを閉じる |
| `z` | 全画面切替 |
| `w` | floating切替 |
| `e` | 埋込/float切替 |
| `[` | scroll/copy mode |
| `d` | detach |

### Plugin shortcut

| Key | Plugin | 説明 |
|-----|--------|------|
| `f` | Monocle | pane/tabを検索してjump |
| `b` | zellij-pane-picker | paneの一覧、星を付けたpaneに切替 |

### zellij-pane-pickerの操作

| Key | 操作 |
|-----|------|
| 文字入力 | paneを絞り込む |
| `↑`/`↓` | list内を移動 |
| `Space` | 選択したpaneに星を付ける/外す |
| `Enter` | 選択したpaneにjump |
| `Esc` | 閉じる |

plugin自身のAltキーはAeroSpaceの`alt-hjkl`とぶつかるため切ってある。

:::tip
paneが2-3個なら`Ctrl+q` → `h/j/k/l`で十分。5個以上のpaneを使うようになると便利。
:::

## Setup

zjstatusとmonocleは`make up`（setupの`zellij-plugins`）がdownloadする。zellij-pane-pickerはNixが版を固定して`~/.local/share/zellij/plugins/`に置く（`home/shared/zellij`）。

## File構成

```
~/.config/zellij/
├── config.kdl           # main の設定
├── layouts/
│   ├── <theme>.kdl      # テーマごとの layout（catppuccin、nord、tokyonight など 11 個）
│   └── default.kdl
└── plugins/
    ├── zjstatus.wasm    # status bar
    └── monocle.wasm     # fuzzy finder
```

## Status barの表示内容

- Mode indicator (色付き背景)
- Session名
- Git branch (10秒間隔で自動更新)
- 日時 (Asia/Tokyo timezone)
- 通知alert
- Tab表示 (番号とicon付き)

## Troubleshooting

### Pluginが読み込めない

1. Zellijのversionを確認: `zellij --version`
2. pluginをsourceからrebuild
3. cacheを削除: `rm -rf ~/.cache/zellij/`

### テーマが反映されない

1. file permissionを確認: `ls -la ~/.config/zellij/layouts/`
2. sessionを再起動: `zellij kill-all-sessions`
3. `config.kdl`の`default_layout`を確認: `grep default_layout ~/.config/zellij/config.kdl`

## Customize

### テーマの追加

1. `layouts/theme-name.kdl`を作成
2. `home/shared/theme/themes/`と各applicationのテーマfileにも同名のテーマを足す（`dotctl theme set`はその名前のlayoutを探す）
3. 既存テーマのcolor patternに合わせて設定

### Keybindingの変更

`config.kdl`を編集する。

```kdl
bind "Your Key" {
    LaunchOrFocusPlugin "file:~/.config/zellij/plugins/plugin.wasm" {
        floating true
    }
    SwitchToMode "normal"
}
```
