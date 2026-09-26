-- Development and productivity tools
return {
  -- Advanced search and replace across project
  {
    'nvim-pack/nvim-spectre',
    dependencies = {'nvim-lua/plenary.nvim'},
    keys = {
      { "<leader>sr", '<cmd>lua require("spectre").toggle()<CR>', desc = "Toggle Spectre" },
      { "<leader>sw", '<cmd>lua require("spectre").open_visual({select_word=true})<CR>', desc = "Search current word" },
      { "<leader>sp", '<cmd>lua require("spectre").open_file_search({select_word=true})<CR>', desc = "Search in current file" },
    },
    config = function()
      require('spectre').setup({
        highlight = {
          ui = "String",
          search = "DiffChange",
          replace = "DiffAdd"
        },
      })
    end,
  },

  -- Diagnostics panel with better UI
  {
    "folke/trouble.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    keys = {
      { "<leader>xx", "<cmd>Trouble diagnostics toggle<cr>", desc = "Diagnostics (Trouble)" },
      { "<leader>xX", "<cmd>Trouble diagnostics toggle filter.buf=0<cr>", desc = "Buffer Diagnostics (Trouble)" },
      { "<leader>cs", "<cmd>Trouble symbols toggle focus=false<cr>", desc = "Symbols (Trouble)" },
      { "<leader>cl", "<cmd>Trouble lsp toggle focus=false win.position=right<cr>", desc = "LSP Definitions / references / ... (Trouble)" },
      { "<leader>xL", "<cmd>Trouble loclist toggle<cr>", desc = "Location List (Trouble)" },
      { "<leader>xQ", "<cmd>Trouble qflist toggle<cr>", desc = "Quickfix List (Trouble)" },
    },
    opts = {},  -- Trouble.nvim v3はデフォルト設定で動作
  },

  -- Advanced terminal management
  {
    "akinsho/toggleterm.nvim",
    version = '*',
    config = function()
      require("toggleterm").setup({
        open_mapping = [[<c-\>]],
        hide_numbers = true,
        shade_filetypes = {},
        shade_terminals = true,
        shading_factor = 2,
        start_in_insert = true,
        insert_mappings = true,
        persist_size = true,
        direction = 'float',
        close_on_exit = true,
        shell = vim.o.shell,
        float_opts = {
          border = 'curved',
          winblend = 3,
          highlights = {
            border = "Normal",
            background = "Normal",
          },
          width = function()
            return math.floor(vim.o.columns * 0.8)
          end,
          height = function()
            return math.floor(vim.o.lines * 0.8)
          end,
        },
      })
      
      -- Terminal keymaps
      function _G.set_terminal_keymaps()
        local opts = {buffer = 0}
        vim.keymap.set('t', '<esc>', [[<C-\><C-n>]], opts)
        vim.keymap.set('t', 'jk', [[<C-\><C-n>]], opts)
        vim.keymap.set('t', '<C-h>', [[<Cmd>wincmd h<CR>]], opts)
        vim.keymap.set('t', '<C-j>', [[<Cmd>wincmd j<CR>]], opts)
        vim.keymap.set('t', '<C-k>', [[<Cmd>wincmd k<CR>]], opts)
        vim.keymap.set('t', '<C-l>', [[<Cmd>wincmd l<CR>]], opts)
      end
      
      vim.cmd('autocmd! TermOpen term://* lua set_terminal_keymaps()')
      
      -- Custom terminals
      local Terminal = require('toggleterm.terminal').Terminal
      local lazygit = Terminal:new({ cmd = "lazygit", hidden = true, direction = "float" })
      
      function _LAZYGIT_TOGGLE()
        lazygit:toggle()
      end
      
      vim.api.nvim_set_keymap("n", "<leader>gg", "<cmd>lua _LAZYGIT_TOGGLE()<CR>", {noremap = true, silent = true, desc = "Toggle LazyGit"})
    end,
  },

  -- Auto close HTML/JSX tags
  {
    'windwp/nvim-ts-autotag',
    ft = { "html", "javascript", "typescript", "javascriptreact", "typescriptreact", "svelte", "vue", "xml", "markdown" },
    config = function()
      require('nvim-ts-autotag').setup({
        opts = {
          enable_close = true,
          enable_rename = true,
          enable_close_on_slash = false
        },
      })
    end,
  },

  -- Remote development support
  {
    'amitds1997/remote-nvim.nvim',
    version = "*",
    dependencies = {
      'nvim-lua/plenary.nvim',
      'MunifTanjim/nui.nvim',
      'nvim-telescope/telescope.nvim',
    },
    cmd = { "RemoteStart", "RemoteStop", "RemoteInfo", "RemoteCleanup", "RemoteConfigDel", "RemoteLog" },
    keys = {
      { "<leader>rs", "<cmd>RemoteStart<cr>", desc = "Remote Start" },
      { "<leader>ri", "<cmd>RemoteInfo<cr>", desc = "Remote Info" },
      { "<leader>rc", "<cmd>RemoteCleanup<cr>", desc = "Remote Cleanup" },
    },
    config = function()
      require('remote-nvim').setup({
        client_callback = function(port, workspace_config)
          local cmd = ("nvim --server localhost:%s --remote-ui"):format(port)
          vim.fn.jobstart(cmd, {
            detach = true,
            on_exit = function(job_id, exit_code, event_type)
              print("Client", job_id, "exited with code", exit_code, "Event type:", event_type)
            end,
          })
        end,
        ssh = {
          config_file = "~/.ssh/config",
          wrapper = "ssh",
        },
        devpod = {
          binary = "devpod",
          docker_binary = "docker",
          kubernetes_binary = "kubectl",
          ssh_config_path = vim.fn.expand("$HOME/.ssh/config"),
        },
      })
    end,
  },
}