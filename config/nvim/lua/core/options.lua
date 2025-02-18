local opt = vim.opt

-- エンコーディング
vim.scriptencoding = 'utf-8'
opt.encoding = 'utf-8'
opt.fileencoding = 'utf-8'

-- 表示設定
opt.number = true
opt.relativenumber = true
opt.title = true
opt.autoindent = true
opt.smartindent = true
opt.hlsearch = true
opt.backup = false
opt.showcmd = true
opt.cmdheight = 1
opt.laststatus = 2
opt.expandtab = true
opt.scrolloff = 10
opt.shell = 'zsh'
opt.inccommand = 'split'
opt.ignorecase = true
opt.smarttab = true
opt.breakindent = true
opt.shiftwidth = 2
opt.tabstop = 2
opt.wrap = false
opt.helplang = 'ja'
opt.updatetime = 300
opt.signcolumn = 'yes'

-- クリップボード
opt.clipboard:append('unnamedplus')

-- スプリット
opt.splitright = true
opt.splitbelow = true

-- 不可視文字の表示
opt.list = true
opt.listchars = { tab = '▸ ', trail = '·' }

-- マウス
opt.mouse = 'a'

-- ターミナルの色設定
opt.termguicolors = true

-- その他
opt.iskeyword:append('-')
opt.formatoptions:remove('cro') 