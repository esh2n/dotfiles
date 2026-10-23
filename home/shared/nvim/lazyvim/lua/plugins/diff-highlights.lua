-- solarized sets Diff* as foreground colours, which paint over syntax
-- highlighting in diff mode; use background tints instead. lazy.nvim merges
-- these opts with the ones in the generated colorscheme.lua.
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
}
