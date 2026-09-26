-- Theme plugins for nvim-custom.
-- Covers every theme that `theme-switch` can select (13 themes via 10 plugins).
-- Each plugin is lazy-loaded; lazy.nvim auto-loads the right one when
-- `vim.cmd.colorscheme(...)` is called from custom/colorscheme.lua.

return {
  -- catppuccin (mocha + latte)
  {
    'catppuccin/nvim',
    name = 'catppuccin',
    lazy = false,
    priority = 1000,
    opts = {
      flavour = 'mocha',
      integrations = {
        cmp = true,
        gitsigns = true,
        treesitter = true,
        notify = true,
        telescope = true,
        mini = { enabled = true, indentscope_color = '' },
      },
    },
  },

  -- tokyonight (night + day)
  {
    'folke/tokyonight.nvim',
    lazy = true,
    opts = {
      styles = { comments = { italic = false } },
    },
  },

  { 'Mofiqul/dracula.nvim',     lazy = true },
  { 'sainnhe/everforest',       lazy = true }, -- dark + light variants
  { 'ellisonleao/gruvbox.nvim', lazy = true },
  { 'rebelot/kanagawa.nvim',    lazy = true },
  { 'shaunsingh/nord.nvim',     lazy = true },
  { 'navarasu/onedark.nvim',    lazy = true },
  { 'rose-pine/neovim',         name = 'rose-pine', lazy = true },
  { 'maxmx03/solarized.nvim',   lazy = true },
}
