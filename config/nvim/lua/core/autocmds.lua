local augroup = vim.api.nvim_create_augroup
local autocmd = vim.api.nvim_create_autocmd

-- 全般的な自動コマンド
local general = augroup('General', { clear = true })

-- ヤンク時のハイライト
autocmd('TextYankPost', {
  group = general,
  callback = function()
    vim.highlight.on_yank({ timeout = 200 })
  end,
})

-- ファイルタイプごとのインデント設定
local indent = augroup('Indent', { clear = true })

autocmd('FileType', {
  group = indent,
  pattern = { 'lua', 'javascript', 'typescript', 'json' },
  command = 'setlocal shiftwidth=2 tabstop=2'
})

autocmd('FileType', {
  group = indent,
  pattern = { 'python', 'rust', 'go' },
  command = 'setlocal shiftwidth=4 tabstop=4'
})

-- 最後にいた位置を復元
autocmd('BufReadPost', {
  group = general,
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    local lcount = vim.api.nvim_buf_line_count(0)
    if mark[1] > 0 and mark[1] <= lcount then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
})

-- 未使用のバッファを自動で閉じる
autocmd('BufHidden', {
  group = general,
  callback = function(event)
    if event.file == '' then
      vim.schedule(function()
        pcall(vim.cmd, 'bwipeout ' .. event.buf)
      end)
    end
  end,
}) 