---
title: Neovim
description: 4 つの distribution を切り替えて使う Neovim の設定。
---

4 つの Neovim distribution を command 一発で切り替えられる。

```bash
nvim-switch lazyvim
nvim-switch custom
```

| Distribution | 特徴 |
|-------------|------|
| Custom | Kickstart ベースの個人設定 |
| LazyVim | 高速で軽量 |
| NvChad | 見た目に力を入れた構成 |
| AstroVim | 機能豊富な all-in-one |

すべての distribution で leader key は `<Space>`。`<Space>` を押して待つと which-key で keybinding の一覧が表示される。

## LazyVim

| 操作 | Key |
|------|-----|
| hint 表示 | `<Space>` |
| file tree 切替 | `<Space> + e` |
| file tree に focus | `<Space> + o` |
| file 検索 | `<Space> + s + f` |
| 単語検索 | `<Space> + s + w` |
| grep 検索 | `<Space> + s + g` |
| option 切替 | `<Space> + t` |
| Git 操作 | `<Space> + g` |
| buffer 操作 | `<Space> + b` |
| LSP 操作 | `<Space> + l` |
| terminal | `<Space> + f + t` |
| window 移動 | `Ctrl+h/j/k/l` |
| 保存 | `<Space> + w` |
| 終了 | `<Space> + q` |

## NvChad

| 操作 | Key |
|------|-----|
| hint 表示 | `<Space>` |
| file 検索 | `<Space> + ff` |
| 全 file 検索 | `<Space> + fa` |
| Live grep | `<Space> + fw` |
| buffer 検索 | `<Space> + fb` |
| NvimTree 切替 | `Ctrl+n` |
| NvimTree focus | `<Space> + e` |
| format | `<Space> + fm` |
| 新規 buffer | `<Space> + b` |
| 次の buffer | `<Tab>` |
| 前の buffer | `Shift+Tab` |
| buffer を閉じる | `<Space> + x` |
| horizontal terminal | `<Space> + h` |
| vertical terminal | `<Space> + v` |
| terminal 切替 | `Alt+h/v/i` |
| window 移動 | `Ctrl+h/j/k/l` |
| 保存 | `Ctrl+s` |
| 行番号切替 | `<Space> + n` |
| 相対番号切替 | `<Space> + rn` |
| comment | `<Space> + /` |

## AstroVim

| 操作 | Key |
|------|-----|
| hint 表示 | `<Space>` |
| file tree 切替 | `<Space> + e` |
| file tree focus | `<Space> + o` |
| file 検索 | `<Space> + f` |
| 言語 tool | `<Space> + l` |
| buffer | `<Space> + b` |
| terminal | `<Space> + t` |
| Git | `<Space> + g` |
| package | `<Space> + p` |
| UI/UX | `<Space> + u` |
| window 移動 | `Ctrl+h/j/k/l` |
| window resize | `Ctrl+Arrow` |
| 保存 | `<Space> + w` |
| 終了 | `<Space> + q` |
| comment | `<Space> + /` |

## Custom (Kickstart ベース)

| 操作 | Key |
|------|-----|
| hint 表示 | `<Space>` |
| file tree | `\` |
| help 検索 | `<Space> + s + h` |
| file 検索 | `<Space> + s + f` |
| grep 検索 | `<Space> + s + g` |
| 単語検索 | `<Space> + s + w` |
| keymap 検索 | `<Space> + s + k` |
| buffer 検索 | `<Space><Space>` |
| window 移動 | `Ctrl+h/j/k/l` |
| 次の buffer | `Shift+l` |
| 前の buffer | `Shift+h` |
| buffer を閉じる | `<Space> + c` |
| 保存 | `<Space> + w` |
