---
title: Neovim
description: 4 つの distribution を切り替えて使う Neovim の設定。
---

4つのNeovim distributionをcommand一発で切り替えられる。

```bash
nvim-switch lazyvim
nvim-switch custom
```

| Distribution | 特徴 |
|-------------|------|
| Custom | Kickstartベースの個人設定 |
| LazyVim | 高速で軽量 |
| NvChad | 見た目に力を入れた構成 |
| AstroVim | 機能豊富なall-in-one |

すべてのdistributionでleader keyは`<Space>`。`<Space>`を押して待つとwhich-keyでkeybindingの一覧が表示される。

## LazyVim

| 操作 | Key |
|------|-----|
| hint表示 | `<Space>` |
| file tree切替 | `<Space> + e` |
| file treeにfocus | `<Space> + o` |
| file検索 | `<Space> + s + f` |
| 単語検索 | `<Space> + s + w` |
| grep検索 | `<Space> + s + g` |
| option切替 | `<Space> + t` |
| Git操作 | `<Space> + g` |
| buffer操作 | `<Space> + b` |
| LSP操作 | `<Space> + l` |
| terminal | `<Space> + f + t` |
| window移動 | `Ctrl+h/j/k/l` |
| 保存 | `<Space> + w` |
| 終了 | `<Space> + q` |

## NvChad

| 操作 | Key |
|------|-----|
| hint表示 | `<Space>` |
| file検索 | `<Space> + ff` |
| 全file検索 | `<Space> + fa` |
| Live grep | `<Space> + fw` |
| buffer検索 | `<Space> + fb` |
| NvimTree切替 | `Ctrl+n` |
| NvimTree focus | `<Space> + e` |
| format | `<Space> + fm` |
| 新規buffer | `<Space> + b` |
| 次のbuffer | `<Tab>` |
| 前のbuffer | `Shift+Tab` |
| bufferを閉じる | `<Space> + x` |
| horizontal terminal | `<Space> + h` |
| vertical terminal | `<Space> + v` |
| terminal切替 | `Alt+h/v/i` |
| window移動 | `Ctrl+h/j/k/l` |
| 保存 | `Ctrl+s` |
| 行番号切替 | `<Space> + n` |
| 相対番号切替 | `<Space> + rn` |
| comment | `<Space> + /` |

## AstroVim

| 操作 | Key |
|------|-----|
| hint表示 | `<Space>` |
| file tree切替 | `<Space> + e` |
| file tree focus | `<Space> + o` |
| file検索 | `<Space> + f` |
| 言語tool | `<Space> + l` |
| buffer | `<Space> + b` |
| terminal | `<Space> + t` |
| Git | `<Space> + g` |
| package | `<Space> + p` |
| UI/UX | `<Space> + u` |
| window移動 | `Ctrl+h/j/k/l` |
| window resize | `Ctrl+Arrow` |
| 保存 | `<Space> + w` |
| 終了 | `<Space> + q` |
| comment | `<Space> + /` |

## Custom (Kickstartベース)

| 操作 | Key |
|------|-----|
| hint表示 | `<Space>` |
| file tree | `\` |
| help検索 | `<Space> + s + h` |
| file検索 | `<Space> + s + f` |
| grep検索 | `<Space> + s + g` |
| 単語検索 | `<Space> + s + w` |
| keymap検索 | `<Space> + s + k` |
| buffer検索 | `<Space><Space>` |
| window移動 | `Ctrl+h/j/k/l` |
| 次のbuffer | `Shift+l` |
| 前のbuffer | `Shift+h` |
| bufferを閉じる | `<Space> + c` |
| 保存 | `<Space> + w` |
