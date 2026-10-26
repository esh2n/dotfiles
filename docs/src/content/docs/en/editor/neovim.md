---
title: Neovim
description: Four Neovim distributions, switchable with a single command.
---

Switch between four Neovim distributions instantly.

```bash
nvim-switch lazyvim
nvim-switch custom
```

| Distribution | Character |
|--------------|-----------|
| Custom | Kickstart-based personal config |
| LazyVim | Fast and lean |
| NvChad | Polished UI |
| AstroVim | Feature-rich all-in-one |

Leader key is `<Space>` in all distributions. Press `<Space>` and wait to see available bindings via which-key.

## Shared by every distribution

Lua shared by all four distributions lives in `home/shared/nvim/common/lua/dotfiles/`. Each distribution's `lua/dotfiles` is a symlink to it, so a change there reaches every distribution.

### Reviewing a branch's changes

[diffview+](https://github.com/dlyongemallo/diffview-plus.nvim) is installed. It is the maintained fork of [diffview.nvim](https://github.com/sindrets/diffview.nvim), whose updates have stopped. Changed files are listed on the left; selecting one shows its side-by-side diff.

```vim
" Compare HEAD with the point where it branched from origin/main; paths after -- narrow it
:DiffviewOpen origin/main...HEAD -- tools/backend_test
" History of a file
:DiffviewFileHistory %
:DiffviewClose
```

From the shell, run `nvim +"DiffviewOpen origin/main...HEAD"`. Press `g?` inside diffview for its keymaps.

### Diff colours

Some themes (solarized, dracula, nord, ...) set the diff groups (`DiffAdd`, `DiffChange`, `DiffText`) as foreground colours, which paint over syntax highlighting, so every added line turns one colour. `dotfiles/diff_colors.lua` checks these groups after every theme load. A group with a foreground colour or `reverse` is replaced by a background-only tint: its own colour blended into the editor background. Themes that already use backgrounds only are left alone.

When a transparent setting leaves the theme's background in neither `Normal` nor `NormalFloat`, the tint is blended into black (white for a light theme), so it can differ slightly from the terminal's background.

## LazyVim

| Action | Key |
|--------|-----|
| Show hints | `<Space>` |
| File tree toggle | `<Space> + e` |
| File tree focus | `<Space> + o` |
| Find files | `<Space> + s + f` |
| Find word | `<Space> + s + w` |
| Grep | `<Space> + s + g` |
| Toggle options | `<Space> + t` |
| Git | `<Space> + g` |
| Buffers | `<Space> + b` |
| LSP | `<Space> + l` |
| Terminal | `<Space> + f + t` |
| Window nav | `Ctrl+h/j/k/l` |
| Save | `<Space> + w` |
| Quit | `<Space> + q` |

LazyVim also has [tobira.nvim](https://github.com/kamegoro/tobira.nvim), which suggests more efficient commands from how you edit. Its suggestions for hammering j/k (`{n}j`, `{n}k`, `}`, `{`) are turned off: setup has no option for it, so `lua/plugins/tobira.lua` drops those detections before they reach the suggestion queue.

## NvChad

| Action | Key |
|--------|-----|
| Show hints | `<Space>` |
| Find files | `<Space> + ff` |
| Find all | `<Space> + fa` |
| Live grep | `<Space> + fw` |
| Find buffers | `<Space> + fb` |
| NvimTree toggle | `Ctrl+n` |
| NvimTree focus | `<Space> + e` |
| Format | `<Space> + fm` |
| New buffer | `<Space> + b` |
| Next buffer | `<Tab>` |
| Prev buffer | `Shift+Tab` |
| Close buffer | `<Space> + x` |
| Horizontal term | `<Space> + h` |
| Vertical term | `<Space> + v` |
| Toggle terminal | `Alt+h/v/i` |
| Window nav | `Ctrl+h/j/k/l` |
| Save | `Ctrl+s` |
| Line numbers | `<Space> + n` |
| Relative numbers | `<Space> + rn` |
| Comment | `<Space> + /` |

## AstroVim

| Action | Key |
|--------|-----|
| Show hints | `<Space>` |
| File tree toggle | `<Space> + e` |
| File tree focus | `<Space> + o` |
| Find files | `<Space> + f` |
| Language tools | `<Space> + l` |
| Buffers | `<Space> + b` |
| Terminal | `<Space> + t` |
| Git | `<Space> + g` |
| Packages | `<Space> + p` |
| UI/UX | `<Space> + u` |
| Window nav | `Ctrl+h/j/k/l` |
| Resize window | `Ctrl+Arrow` |
| Save | `<Space> + w` |
| Quit | `<Space> + q` |
| Comment | `<Space> + /` |

## Custom (Kickstart-based)

| Action | Key |
|--------|-----|
| Show hints | `<Space>` |
| File tree | `\` |
| Search help | `<Space> + s + h` |
| Find files | `<Space> + s + f` |
| Grep | `<Space> + s + g` |
| Find word | `<Space> + s + w` |
| Search keymaps | `<Space> + s + k` |
| Find buffers | `<Space><Space>` |
| Window nav | `Ctrl+h/j/k/l` |
| Next buffer | `Shift+l` |
| Prev buffer | `Shift+h` |
| Close buffer | `<Space> + c` |
| Save | `<Space> + w` |
