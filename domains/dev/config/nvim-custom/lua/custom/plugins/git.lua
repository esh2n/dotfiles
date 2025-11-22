-- Git integration plugins
return {
  -- Classic Git wrapper
  {
    'tpope/vim-fugitive',
    cmd = { 'Git', 'G', 'Gdiffsplit', 'Gread', 'Gwrite', 'Ggrep', 'GMove', 'GDelete', 'GBrowse', 'GRemove', 'GRename', 'Glgrep', 'Gedit' },
    keys = {
      { '<leader>gs', '<cmd>Git<CR>', desc = 'Git status' },
      { '<leader>gb', '<cmd>Git blame<CR>', desc = 'Git blame' },
      { '<leader>gd', '<cmd>Gdiffsplit<CR>', desc = 'Git diff split' },
      { '<leader>ge', '<cmd>Gedit<CR>', desc = 'Git edit' },
      { '<leader>gr', '<cmd>Gread<CR>', desc = 'Git read' },
      { '<leader>gw', '<cmd>Gwrite<CR>', desc = 'Git write' },
      { '<leader>gl', '<cmd>Git log<CR>', desc = 'Git log' },
      { '<leader>gp', '<cmd>Git push<CR>', desc = 'Git push' },
      { '<leader>gP', '<cmd>Git pull<CR>', desc = 'Git pull' },
      { '<leader>gc', ':Git commit<CR>', desc = 'Git commit' },
    },
  },
}