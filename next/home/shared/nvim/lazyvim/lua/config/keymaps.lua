-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- herdr: send file path / line range to the first coding agent in this tab.
-- Only registered when Neovim runs inside a herdr pane, so it has zero effect
-- (no keymaps, no which-key entries) in a normal terminal or tmux/zellij.
if vim.env.HERDR_ENV == "1" then
  vim.keymap.set("n", "<leader>zf", function()
    require("util.herdr").send_file_to_agent()
  end, { desc = "herdr: send file path to agent" })
  vim.keymap.set("x", "<leader>zl", function()
    require("util.herdr").send_selection_to_agent()
  end, { desc = "herdr: send file path + line range to agent" })
end
