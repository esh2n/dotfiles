-- solarized, dracula and nord set Diff* as foreground colours, which paint
-- over syntax highlighting in diff mode; use background tints instead.
-- lazy.nvim merges these specs with the ones in the generated colorscheme.lua.

-- Each tint is the theme's own diff colour blended into its background
-- (20%, DiffText 35%). nord has no highlight override option, so dracula and
-- nord are both patched on ColorScheme.
local tints = {
  dracula = { add = "#305444", change = "#534641", delete = "#53333c", text = "#5c4f7a", delete_fg = "#ff5555" },
  nord = { add = "#45504f", change = "#54524f", delete = "#4b3d48", text = "#5d5366", delete_fg = "#bf616a" },
}

local function apply(t)
  vim.api.nvim_set_hl(0, "DiffAdd", { bg = t.add })
  vim.api.nvim_set_hl(0, "DiffChange", { bg = t.change })
  vim.api.nvim_set_hl(0, "DiffDelete", { fg = t.delete_fg, bg = t.delete })
  vim.api.nvim_set_hl(0, "DiffText", { bg = t.text })
end

return {
  {
    "maxmx03/solarized.nvim",
    opts = {
      on_highlights = function(colors)
        return {
          DiffAdd = { fg = "NONE", bg = colors.mix_green, reverse = false },
          DiffChange = { fg = "NONE", bg = colors.mix_yellow, reverse = false },
          DiffDelete = { fg = colors.red, bg = colors.mix_red, reverse = false },
          DiffText = { fg = "NONE", bg = colors.mix_blue, reverse = false },
        }
      end,
    },
  },
  {
    "LazyVim/LazyVim",
    init = function()
      vim.api.nvim_create_autocmd("ColorScheme", {
        group = vim.api.nvim_create_augroup("diff_highlight_tints", { clear = true }),
        pattern = { "dracula*", "nord" },
        callback = function(ev)
          apply(tints[ev.match:match("^dracula") and "dracula" or "nord"])
        end,
      })
    end,
  },
}
