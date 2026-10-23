-- Registered from a spec's init so the ColorScheme autocmd exists before
-- AstroNvim applies the colorscheme at startup.
return {
  {
    "AstroNvim/AstroNvim",
    init = function()
      require("dotfiles.diff_colors").setup()
    end,
  },
}
