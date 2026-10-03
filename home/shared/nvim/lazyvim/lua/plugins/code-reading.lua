-- code-reading: per-line explanations of how code behaves, from the crt
-- language server built in its own repository. The model, endpoint and API
-- key live in crt's configuration (:CrConfig), not here.
local repo = vim.fn.expand("~/go/github.com/esh2n/code-reading-tool")

return {
  {
    dir = repo .. "/editors/nvim",
    name = "code-reading",
    -- Only on machines that have the repository checked out.
    cond = vim.uv.fs_stat(repo .. "/editors/nvim") ~= nil,
    event = { "BufReadPre", "BufNewFile" },
    cmd = { "CrRead", "CrScenario", "CrToggle", "CrConfig" },
    opts = {
      cmd = { repo .. "/target/release/crt", "lsp" },
      -- The local model answers one request at a time.
      max_parallel = 1,
    },
    config = function(_, opts)
      require("code-reading").setup(opts)
    end,
    -- Keys LazyVim leaves free (cR is rename, cS is Trouble's references).
    keys = {
      { "<leader>ce", "<cmd>CrRead<cr>", desc = "Explain function (crt)" },
      { "<leader>cE", "<cmd>CrScenario<cr>", desc = "Scenarios of function (crt)" },
      { "<leader>uE", "<cmd>CrToggle<cr>", desc = "Toggle explanations (crt)" },
    },
  },
  {
    -- Statusline: "crt on" / "crt off" / "crt …" (writing); click to switch.
    "nvim-lualine/lualine.nvim",
    optional = true,
    opts = function(_, opts)
      table.insert(opts.sections.lualine_x, 1, {
        function()
          return require("code-reading").status()
        end,
        cond = function()
          return package.loaded["code-reading"] ~= nil
        end,
        on_click = function()
          require("code-reading").toggle()
        end,
      })
    end,
  },
}
