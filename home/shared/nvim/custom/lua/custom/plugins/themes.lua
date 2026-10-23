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
  {
    'shaunsingh/nord.nvim',
    lazy = true,
    -- dracula and nord set Diff* as foreground colours, which paint over
    -- syntax highlighting in diff mode; swap in background tints (each theme's
    -- diff colour blended into its background, 20%, DiffText 35%). nord has no
    -- highlight override option, so both are patched on ColorScheme.
    init = function()
      local tints = {
        dracula = { add = '#305444', change = '#534641', delete = '#53333c', text = '#5c4f7a', delete_fg = '#ff5555' },
        nord = { add = '#45504f', change = '#54524f', delete = '#4b3d48', text = '#5d5366', delete_fg = '#bf616a' },
      }
      vim.api.nvim_create_autocmd('ColorScheme', {
        group = vim.api.nvim_create_augroup('diff_highlight_tints', { clear = true }),
        pattern = { 'dracula*', 'nord' },
        callback = function(ev)
          local t = tints[ev.match:match('^dracula') and 'dracula' or 'nord']
          vim.api.nvim_set_hl(0, 'DiffAdd', { bg = t.add })
          vim.api.nvim_set_hl(0, 'DiffChange', { bg = t.change })
          vim.api.nvim_set_hl(0, 'DiffDelete', { fg = t.delete_fg, bg = t.delete })
          vim.api.nvim_set_hl(0, 'DiffText', { bg = t.text })
        end,
      })
    end,
  },
  { 'navarasu/onedark.nvim',    lazy = true },
  { 'rose-pine/neovim',         name = 'rose-pine', lazy = true },
  {
    'maxmx03/solarized.nvim',
    lazy = true,
    opts = {
      -- solarized sets Diff* as foreground colours, which paint over syntax
      -- highlighting in diff mode; use background tints instead.
      on_highlights = function(colors)
        return {
          DiffAdd = { fg = 'NONE', bg = colors.mix_green, reverse = false },
          DiffChange = { fg = 'NONE', bg = colors.mix_yellow, reverse = false },
          DiffDelete = { fg = colors.red, bg = colors.mix_red, reverse = false },
          DiffText = { fg = 'NONE', bg = colors.mix_blue, reverse = false },
        }
      end,
    },
  },
}
