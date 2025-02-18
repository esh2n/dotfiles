local keymap = vim.keymap

-- Leader keyの設定
vim.g.mapleader = " "

-- 一般的なキーマップ
keymap.set('n', '<leader>w', ':w<CR>', { desc = 'Save file' })
keymap.set('n', '<leader>q', ':q<CR>', { desc = 'Quit' })
keymap.set('n', '<leader>h', ':nohlsearch<CR>', { desc = 'Clear search highlight' })

-- ウィンドウ操作
keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Move to left window' })
keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Move to bottom window' })
keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Move to top window' })
keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Move to right window' })

-- バッファ操作
keymap.set('n', '<S-h>', ':bprevious<CR>', { desc = 'Previous buffer' })
keymap.set('n', '<S-l>', ':bnext<CR>', { desc = 'Next buffer' })
keymap.set('n', '<leader>c', ':bdelete<CR>', { desc = 'Close buffer' })

-- インデント操作
keymap.set('v', '<', '<gv', { desc = 'Unindent line' })
keymap.set('v', '>', '>gv', { desc = 'Indent line' })

-- 行移動
keymap.set('n', '<A-j>', ':m .+1<CR>==', { desc = 'Move line down' })
keymap.set('n', '<A-k>', ':m .-2<CR>==', { desc = 'Move line up' })
keymap.set('i', '<A-j>', '<Esc>:m .+1<CR>==gi', { desc = 'Move line down' })
keymap.set('i', '<A-k>', '<Esc>:m .-2<CR>==gi', { desc = 'Move line up' })
keymap.set('v', '<A-j>', ":m '>+1<CR>gv=gv", { desc = 'Move line down' })
keymap.set('v', '<A-k>', ":m '<-2<CR>gv=gv", { desc = 'Move line up' })

-- ターミナルモード
keymap.set('t', '<Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' }) 