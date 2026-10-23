-- Review a branch or range across all changed files in one tab:
--   :DiffviewOpen origin/main...HEAD -- tools/backend_test
-- diffview+ is the maintained fork of sindrets/diffview.nvim.
return {
  {
    "dlyongemallo/diffview-plus.nvim",
    version = "*",
    cmd = { "DiffviewOpen", "DiffviewToggle", "DiffviewFileHistory", "DiffviewDiffFiles", "DiffviewLog" },
  },
}
