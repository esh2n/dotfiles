require "nvchad.mappings"

-- add yours here

local map = vim.keymap.set

map("n", ";", ":", { desc = "CMD enter command mode" })
map("i", "jk", "<ESC>")

-- map({ "n", "i", "v" }, "<C-s>", "<cmd> w <cr>")

-- herdr: send file path / line range to the first coding agent in this tab.
-- Only registered inside a herdr pane, so it is inert in a normal terminal/tmux/zellij.
if vim.env.HERDR_ENV == "1" then
  map("n", "<leader>zf", function()
    require("utils.herdr").send_file_to_agent()
  end, { desc = "herdr: send file path to agent" })
  map("x", "<leader>zl", function()
    require("utils.herdr").send_selection_to_agent()
  end, { desc = "herdr: send file path + line range to agent" })
end
