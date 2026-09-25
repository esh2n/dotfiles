return {
  "lewis6991/satellite.nvim",
  event = "VeryLazy",
  opts = {
    current_only = false,
    winblend = 50,
    handlers = {
      cursor = { enable = true },
      search = { enable = true }, -- 検索ヒット位置を表示
      diagnostic = { enable = true }, -- エラー/警告位置を表示
      gitsigns = { enable = true }, -- Git変更位置を表示
      marks = { enable = true }, -- マーク位置を表示
    },
  },
}
