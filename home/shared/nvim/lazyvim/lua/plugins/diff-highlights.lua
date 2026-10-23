-- Registered from a spec's init so the ColorScheme autocmd exists before
-- LazyVim applies the colorscheme at startup.
return {
  {
    "LazyVim/LazyVim",
    init = function()
      require("config.diff_colors").setup()
    end,
  },
}
