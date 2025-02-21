-- キーマップのエイリアス設定
local keymap = vim.keymap.set
local opts = { noremap = true, silent = true }

-- Leader keyの設定
vim.g.mapleader = " "

-- 一般的なキーマップ
keymap("n", "<leader>w", ":w<CR>", opts)
keymap("n", "<leader>q", ":q<CR>", opts)
keymap("n", "<leader>h", ":nohlsearch<CR>", opts)

-- ウィンドウ操作
keymap("n", "<C-h>", "<C-w>h", opts)
keymap("n", "<C-j>", "<C-w>j", opts)
keymap("n", "<C-k>", "<C-w>k", opts)
keymap("n", "<C-l>", "<C-w>l", opts)

-- バッファ操作
keymap("n", "<S-h>", ":bprevious<CR>", opts)
keymap("n", "<S-l>", ":bnext<CR>", opts)
keymap("n", "<leader>c", ":bdelete<CR>", opts)

-- インデント操作
keymap("v", "<", "<gv", opts)
keymap("v", ">", ">gv", opts)

-- 行移動
keymap("n", "<A-j>", ":m .+1<CR>==", opts)
keymap("n", "<A-k>", ":m .-2<CR>==", opts)
keymap("i", "<A-j>", "<Esc>:m .+1<CR>==gi", opts)
keymap("i", "<A-k>", "<Esc>:m .-2<CR>==gi", opts)
keymap("v", "<A-j>", ":m '>+1<CR>gv=gv", opts)
keymap("v", "<A-k>", ":m '<-2<CR>gv=gv", opts)

-- ターミナルモード
keymap("t", "<Esc>", "<C-\\><C-n>", opts)

-- Telescope
keymap("n", "<leader>ff", "<cmd>Telescope find_files<CR>", opts)
keymap("n", "<leader>fg", "<cmd>Telescope live_grep<CR>", opts)
keymap("n", "<leader>fb", "<cmd>Telescope buffers<CR>", opts)
keymap("n", "<leader>fh", "<cmd>Telescope help_tags<CR>", opts)

-- NvimTree
keymap("n", "<leader>e", ":NvimTreeToggle<CR>", opts)

-- LSP
keymap("n", "gd", vim.lsp.buf.definition, opts)
keymap("n", "K", vim.lsp.buf.hover, opts)
keymap("n", "<leader>rn", vim.lsp.buf.rename, opts)
keymap("n", "<leader>ca", vim.lsp.buf.code_action, opts)
keymap("n", "gr", vim.lsp.buf.references, opts)
keymap("n", "[d", vim.diagnostic.goto_prev, opts)
keymap("n", "]d", vim.diagnostic.goto_next, opts)

-- Todo Comments
keymap("n", "<leader>td", ":TodoTelescope<CR>", opts)

-- Spectre (検索・置換)
keymap("n", "<leader>S", "<cmd>lua require('spectre').open()<CR>", opts)

-- Hop (モーション)
keymap("n", "<leader>hw", "<cmd>HopWord<CR>", opts)
keymap("n", "<leader>hl", "<cmd>HopLine<CR>", opts)

-- CodeWindow (ミニマップ)
keymap("n", "<leader>mm", ":lua require('codewindow').toggle_minimap()<CR>", opts)

-- BufferLine
keymap("n", "<leader>bp", ":BufferLinePick<CR>", opts)
keymap("n", "<leader>bc", ":BufferLinePickClose<CR>", opts) 