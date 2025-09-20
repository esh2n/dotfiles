-- UI enhancement plugins
return {
  -- Buffer tabs at the top
  {
    'akinsho/bufferline.nvim',
    version = "*",
    dependencies = 'nvim-tree/nvim-web-devicons',
    config = function()
      require("bufferline").setup({
        options = {
          mode = "buffers",
          separator_style = "slant",
          show_buffer_close_icons = true,
          show_close_icon = false,
          diagnostics = "nvim_lsp",
          always_show_bufferline = true,
          diagnostics_indicator = function(count, level)
            local icon = level:match("error") and " " or " "
            return " " .. icon .. count
          end,
          offsets = {
            {
              filetype = "neo-tree",
              text = "File Explorer",
              text_align = "center",
              separator = true,
            }
          },
          hover = {
            enabled = true,
            delay = 200,
            reveal = {'close'}
          },
        },
      })
      -- Keymaps for buffer navigation
      vim.keymap.set('n', '<Tab>', ':BufferLineCycleNext<CR>', { desc = "Next buffer", silent = true })
      vim.keymap.set('n', '<S-Tab>', ':BufferLineCyclePrev<CR>', { desc = "Previous buffer", silent = true })
      vim.keymap.set('n', '<leader>bp', ':BufferLinePick<CR>', { desc = "Pick buffer" })
      vim.keymap.set('n', '<leader>bc', ':BufferLinePickClose<CR>', { desc = "Pick buffer to close" })
    end,
  },

  -- Minimap with decorations
  {
    'lewis6991/satellite.nvim',
    config = function()
      require('satellite').setup({
        current_only = false,
        winblend = 50,
        zindex = 40,
        excluded_filetypes = { 'neo-tree', 'prompt', 'TelescopePrompt' },
        width = 2,
        handlers = {
          cursor = { enable = true },
          search = { enable = true },
          diagnostic = { enable = true },
          gitsigns = { enable = true },
          marks = { enable = true },
        },
      })
    end,
  },

  -- Beautiful notifications
  {
    "rcarriga/nvim-notify",
    config = function()
      local notify = require("notify")
      notify.setup({
        background_colour = "#000000",
        fps = 60,
        render = "compact",
        stages = "fade_in_slide_out",
        timeout = 3000,
        max_height = function()
          return math.floor(vim.o.lines * 0.75)
        end,
        max_width = function()
          return math.floor(vim.o.columns * 0.75)
        end,
      })
      vim.notify = notify
      
      -- Set up telescope integration
      require("telescope").load_extension("notify")
      vim.keymap.set("n", "<leader>fn", "<cmd>Telescope notify<cr>", { desc = "Find notifications" })
    end,
  },
}