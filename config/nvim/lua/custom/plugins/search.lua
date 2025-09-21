-- Search enhancement plugins
return {
  -- Japanese search support with vim-kensaku-search
  {
    'lambdalisue/vim-kensaku-search',
    dependencies = { 
      'vim-denops/denops.vim',
      'lambdalisue/vim-kensaku',
    },
    config = function()
      -- vim-kensaku-searchが自動的にキーマップを設定するので、手動設定は不要
      -- <CR>キーは自動的に設定される
    end,
    keys = {
      { '<leader>sk', '<cmd>call kensaku#query()<CR>', desc = 'Kensaku search' },
    },
  },
  
  -- Enhanced star search
  {
    'haya14busa/vim-asterisk',
    keys = {
      { '*', '<Plug>(asterisk-*)', mode = { 'n', 'x' } },
      { '#', '<Plug>(asterisk-#)', mode = { 'n', 'x' } },
      { 'g*', '<Plug>(asterisk-g*)', mode = { 'n', 'x' } },
      { 'g#', '<Plug>(asterisk-g#)', mode = { 'n', 'x' } },
      { 'z*', '<Plug>(asterisk-z*)', mode = { 'n', 'x' } },
      { 'gz*', '<Plug>(asterisk-gz*)', mode = { 'n', 'x' } },
      { 'z#', '<Plug>(asterisk-z#)', mode = { 'n', 'x' } },
      { 'gz#', '<Plug>(asterisk-gz#)', mode = { 'n', 'x' } },
    },
    config = function()
      vim.g['asterisk#keeppos'] = 1
    end,
  },
}