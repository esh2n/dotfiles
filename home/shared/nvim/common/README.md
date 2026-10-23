Lua shared by every distribution. Each distribution links `lua/dotfiles` here,
so `require("dotfiles.diff_colors")` and `{ import = "dotfiles.plugins" }`
work the same in all of them.
