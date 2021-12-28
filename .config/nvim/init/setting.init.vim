"""""""""""""""""""""""""
"      インデント
""""""""""""""""""""""""
set autoindent          "改行時に前の行のインデントを計測
set smartindent         "改行時に入力された行の末尾に合わせて次の行のインデントを増減する
set cindent             "Cプログラムファイルの自動インデントを始める
set smarttab            "新しい行を作った時に高度な自動インデントを行う
set expandtab           "タブ入力を複数の空白に置き換える

set tabstop=2           "タブを含むファイルを開いた際, タブを何文字の空白に変換するか
set shiftwidth=2        "自動インデントで入る空白数
set softtabstop=0       "キーボードから入るタブの数

if has("autocmd")
  "ファイルタイプの検索を有効にする
  filetype plugin on
  "ファイルタイプに合わせたインデントを利用
  filetype indent on
  "sw=softtabstop, sts=shiftwidth, ts=tabstop, et=expandtabの略
  autocmd FileType c           setlocal sw=4 sts=4 ts=4 et
  autocmd FileType html        setlocal sw=4 sts=4 ts=4 et
  autocmd FileType ruby        setlocal sw=2 sts=2 ts=2 et
  autocmd FileType js          setlocal sw=4 sts=4 ts=4 et
  autocmd FileType zsh         setlocal sw=4 sts=4 ts=4 et
  autocmd FileType python      setlocal sw=4 sts=4 ts=4 et
  autocmd FileType scala       setlocal sw=4 sts=4 ts=4 et
  autocmd FileType json        setlocal sw=4 sts=4 ts=4 et
  autocmd FileType html        setlocal sw=4 sts=4 ts=4 et
  autocmd FileType css         setlocal sw=4 sts=4 ts=4 et
  autocmd FileType scss        setlocal sw=4 sts=4 ts=4 et
  autocmd FileType sass        setlocal sw=4 sts=4 ts=4 et
  autocmd FileType javascript  setlocal sw=4 sts=4 ts=4 et
endif

"""""""""""""""""""""""""
"      見た目
""""""""""""""""""""""""
au ColorScheme * hi Normal ctermbg=none
au ColorScheme * hi MatchParen cterm=bold ctermfg=214 ctermbg=black
au ColorScheme * hi SpellBad ctermfg=23 cterm=none ctermbg=none
au ColorScheme * hi LineNr       ctermbg=none ctermfg=240 cterm=italic " 行番号
au ColorScheme * hi StatusLine   ctermbg=none " アクティブなステータスライン
au ColorScheme * hi StatusLineNC ctermbg=none " 非アクティブなステータスライン
au ColorScheme * hi Comment      ctermfg=243 cterm=italic " コメントアウト
au ColorScheme * hi Statement    ctermfg=45
au ColorScheme * hi DiffAdd      ctermbg=24  " 追加行
au ColorScheme * hi Identifier   ctermfg=45 "cterm=bold

set background=dark     "ダークテーマ ( いるこれ？ )
set t_Co=256            "フルカラーサポート
set termguicolors       "true colorを使用 ( 24bit color )

set splitbelow          "新しいウィンドウを下に開く
set splitright          "新しいウィンドウを右に開く

syntax enable           "シンタックスハイライトをON
set relativenumber      "相対行番号表示 ex. 3j ( numberで絶対行数 )
set cursorline          "カーソルラインを表示
set cursorcolumn        "カーソルカラムを表示

let g:python_host_prog = $HOME . '/.pyenv/versions/py2neovim/bin/python'
let g:python3_host_prog = $HOME . '/.pyenv/versions/py3neovim/bin/python'
let g:ruby_host_prog = $HOME . '/.rbenv/versions/2.6.3/bin/neovim-ruby-host'
let g:node_host_prog = '/opt/homebrew/bin/neovim-node-host'

nmap <C-b> :NERDTreeToggle<CR>
nmap <F8> :TagbarToggle<CR>


let g:UltiSnipsExpandTrigger='<c-j>'
let g:UltiSnipsJumpForwardTrigger="<c-b>"
let g:UltiSnipsJumpBackwardTrigger="<c-z>"

nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
nnoremap <silent> K :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

let g:neoterm_default_mod='belowright'
let g:neoterm_size=10
let g:neoterm_autoscroll=1
tnoremap <silent> <C-w> <C-\><C-n><C-w>
nnoremap <silent> <C-n> :TREPLSendLine<CR>j0
noremap <silent> <C-n> V:TREPLSendSelection<CR>'>j0
nmap <F5> :UndotreeToggle<CR>
nmap s <Plug>(easymotion-overwin-f2)

"""""""""""""""""""""""""
"      オプション
""""""""""""""""""""""""
set ic                  "検索時に大文字小文字の区別しない
set is                  "マッチする部分を表示
set hls                 "マッチする部分を強調表示

set clipboard=unnamed   "クリップボード共有を有効にする( 効かない場合=>'unnamedplus' )

set updatetime=100      "swapfileを作るまでのms

"""""""""""""""""""""""""
"      Linter
""""""""""""""""""""""""
let g:ale_sign_error = '🥺'
let g:ale_sign_warning = '😅'
let g:ale_fix_on_save = 1

highlight ALEErrorSign ctermbg=NONE ctermfg=red
highlight ALEWarningSign ctermbg=NONE ctermfg=yellow

nmap <silent> <C-k> <Plug>(ale_previous_wrap)
nmap <silent> <C-j> <Plug>(ale_next_wrap)

let g:ale_fixers = {
  \   '*': ['remove_trailing_lines', 'trim_whitespace'],
  \   'python': ['black'],
  \   'php': ['php_cs_fixer'],
  \ }
let g:ale_fix_on_save = 1


"""""""""""""""""""""""""
"      🚀 絵文字
""""""""""""""""""""""""
set completefunc=emoji#complete  "<C-x><C-u>

" replace :emoji: to <unicode-emoji>
" try echo unicode
function! s:emoji_unicode_echo ()
	let l:keywords=&iskeyword
	setlocal iskeyword-=:
	let l:word = expand('<cword>')
	let l:gh_word = ':'.l:word.':'
	if '' !=? emoji#for(l:word)
		echo 'emoji :'.expand('<cword>').'-'.emoji#for(l:word)
	else
		echo 'emoji :'.expand('<cword>').'-'.'(no match)'
	endif
	let &iskeyword=l:keywords
endfunction

nnoremap <silent><Leader>e :call <SID>emoji_unicode_echo()<CR>

function! s:emoji_unicode_replace ()
	let l:keywords=&iskeyword
	setlocal iskeyword-=:
	let l:word = expand('<cword>')
	if word == ''
		let &iskeyword=l:keywords
		return
	endif

	let l:gh_word = ':'.l:word.':'
	if '' !=? emoji#for(l:word)
		" カーソル位置をword分前に動かしてから、その位置から後の最初のwordを置換する
		" 完了後、位置を移動
		"   123456789ABCD
		"   smile :smile:
		"   ^____ origin cursor
		"   ^____ replace match start (word match pos - colon_size (min:1))
		"   ^____ if success; search emoji start (same replace match)

		"   smile :smile:
		"   __^__ origin cursor
		"   ^____ replace match start (word match pos - colon_size (min:1))
		"   ^____ if success; search emoji start (same replace match)

		"   smile :smile:
		"   ________^__ origin cursor
		"   ___^_______ word matchs start (origin - word len(min:1))
		"   ______^____ replace match start (word match pos - colon_size (min:1))
		"   ______^____ if success; search emoji start (same replace match)

		let pos = getcurpos()
		let word_col = pos[2]
		let target_col = pos[2]
		if pos[2] != 1
			" 行頭以外は位置補正する
			let word_col = pos[2] - strlen(l:word)
			if word_col < 1 | let word_col = 1 | endif

			let target_col = word_col
			if word_col != 1
				call cursor(pos[1], word_col)
				call search(l:word)

				let target_pos = getcurpos()
				let target_col = target_pos[2] - 1 " : の分
				if target_col < 1 | let target_col = 1 | endif
			endif
		endif

		call cursor(pos[1], target_col)

		let l:success = 0
		try
			execute('substitute' . '/' . '\%#'.l:gh_word . '/' . '\=emoji#for(l:word)' . '/el')
			let l:success = 1
		finally
			call cursor(pos[1], pos[2])
		endtry

		if l:success
			call cursor(pos[1], target_col)
			call search(emoji#for(l:word))
		endif

		" debug
		" echom 'emoji:' . 'pos:'.pos[2] . ',word:'.word_col . ',target:'.target_col . ',success:'.l:success

	endif
	let &iskeyword=l:keywords
endfunction

nnoremap <silent><Leader>E :call <SID>emoji_unicode_replace()<CR>