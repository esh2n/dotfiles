return {
  "m4xshen/hardtime.nvim",
  dependencies = { "MunifTanjim/nui.nvim" },
  event = "VeryLazy",
  opts = {
    max_count = 3, -- hjkl 3回までは許容、4回目からブロック
    disable_mouse = false,
    hint = true, -- より良い操作をヒントで教えてくれる
    restricted_keys = {
      ["h"] = { "n", "x" },
      ["j"] = { "n", "x" },
      ["k"] = { "n", "x" },
      ["l"] = { "n", "x" },
    },
  },
}
