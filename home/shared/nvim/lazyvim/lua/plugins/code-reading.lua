-- code-reading: per-line explanations of how code behaves, from crt (Nix,
-- home/shared/code-reading). The plugin lives in editors/nvim of its
-- repository. The model, endpoint and API key live in crt's configuration
-- (:CrConfig), not here.
return {
  {
    "esh2n/code-reading-tool",
    name = "code-reading",
    -- Only where crt is installed (the machines with the dev packages).
    cond = vim.fn.executable("crt") == 1,
    event = { "BufReadPre", "BufNewFile" },
    cmd = { "CrRead", "CrScenario", "CrToggle", "CrConfig" },
    opts = {
      -- The local model answers one request at a time.
      max_parallel = 1,
    },
    config = function(plugin, opts)
      local dir = plugin.dir .. "/editors/nvim"
      vim.opt.rtp:append(dir)
      vim.cmd.source(dir .. "/plugin/code-reading.lua")
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
