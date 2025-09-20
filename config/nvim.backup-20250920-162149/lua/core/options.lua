local opt = vim.opt

-- 基本設定
opt.compatible = false
opt.encoding = 'utf-8'
opt.fileencoding = 'utf-8'
opt.fileencodings = 'utf-8,ucs-boms,euc-jp,cp932'
opt.fileformats = 'unix,dos,mac'
opt.backup = false
opt.swapfile = false
opt.autoread = true
opt.hidden = true
opt.showcmd = true
opt.number = true
opt.relativenumber = true
opt.cursorline = true
opt.expandtab = true
opt.tabstop = 2
opt.shiftwidth = 2
opt.smartindent = true
opt.ignorecase = true
opt.smartcase = true
opt.incsearch = true
opt.hlsearch = true
opt.termguicolors = true

-- クリップボード連携
opt.clipboard:append('unnamedplus')

-- 表示設定
opt.title = true
opt.autoindent = true
opt.cmdheight = 1
opt.laststatus = 2
opt.scrolloff = 10
opt.shell = 'zsh'
opt.inccommand = 'split'
opt.list = true
opt.listchars = { tab = '▸ ', trail = '·' }
opt.mouse = 'a'
opt.updatetime = 300
opt.signcolumn = 'yes'

-- その他
opt.iskeyword:append('-')
opt.formatoptions:remove('cro') 