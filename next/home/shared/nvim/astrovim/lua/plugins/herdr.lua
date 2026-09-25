-- herdr integration for AstroNvim. Only active inside a herdr pane
-- (HERDR_ENV=1); returns an empty spec otherwise, so it is inert in a normal
-- terminal or tmux/zellij. See lua/utils/herdr.lua for the implementation.
if vim.env.HERDR_ENV ~= "1" then
  return {}
end

---@type LazySpec
return {
  "AstroNvim/astrocore",
  ---@type AstroCoreOpts
  opts = {
    mappings = {
      n = {
        ["<leader>z"] = { desc = "herdr" },
        ["<leader>zf"] = {
          function() require("utils.herdr").send_file_to_agent() end,
          desc = "Send file path to herdr agent",
        },
      },
      x = {
        ["<leader>z"] = { desc = "herdr" },
        ["<leader>zl"] = {
          function() require("utils.herdr").send_selection_to_agent() end,
          desc = "Send file path + line range to herdr agent",
        },
      },
    },
  },
}
