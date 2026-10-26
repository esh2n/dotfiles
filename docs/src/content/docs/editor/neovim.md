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

## 全distribution共通

`home/shared/nvim/common/lua/dotfiles/`に、4つのdistributionで共有するLuaを置いている。各distributionの`lua/dotfiles`はこのdirectoryへのsymlinkなので、ここを直すと全distributionに反映される。

### Branchの差分をまとめて見る

[diffview+](https://github.com/dlyongemallo/diffview-plus.nvim)を入れている。更新が止まった[diffview.nvim](https://github.com/sindrets/diffview.nvim)の、今もメンテナンスされているforkである。変更されたfileの一覧が左に出て、fileを選ぶと左右に並んだ差分に切り替わる。

```vim
" origin/mainから分岐した点とHEADを比べる。-- の後ろでpathを絞り込める
:DiffviewOpen origin/main...HEAD -- tools/backend_test
" fileの変更履歴
:DiffviewFileHistory %
:DiffviewClose
```

shellから開く場合は`nvim +"DiffviewOpen origin/main...HEAD"`と打つ。diffview内で`g?`を押すとkey操作の一覧が出る。

### 差分表示の色

solarized、dracula、nordなどのthemeは、差分の色(`DiffAdd`、`DiffChange`、`DiffText`)を文字色で指定している。そのため差分表示ではsyntax highlightの色が上書きされ、追加行が全部同じ色になる。`dotfiles/diff_colors.lua`は、themeを読み込むたびにこれらを調べる。文字色か反転が指定されていれば、その色をeditorの背景色に混ぜた薄い背景色だけに置き換える。背景色だけで指定しているthemeは変えない。

背景を透明にする設定で、themeの背景色が`Normal`にも`NormalFloat`にも無い場合は、黒(light themeでは白)に混ぜる。そのため端末の背景色とは少しずれることがある。

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

LazyVimには[tobira.nvim](https://github.com/kamegoro/tobira.nvim)を入れている。tobira.nvimは、操作の癖から効率のよいコマンドを提案するpluginである。ただしj/kを連打したときの提案(`{n}j`、`{n}k`、`}`、`{`)は出さないようにしている。setupに該当optionが無いので、`lua/plugins/tobira.lua`で連打の検出結果を提案の手前で捨てている。

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
