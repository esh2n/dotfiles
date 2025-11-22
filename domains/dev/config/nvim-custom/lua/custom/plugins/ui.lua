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

  -- Smooth cursor animation
  {
    'sphamba/smear-cursor.nvim',
    event = 'VeryLazy',
    opts = {
      -- カーソル設定
      cursor_color = "#d4d4d8",
      
      -- ノーマルモードの設定
      normal_mode_cursor_color = "#d4d4d8",
      
      -- ビジュアルモードの設定
      visual_mode_cursor_color = "#a78bfa",
      
      -- インサートモードの設定
      insert_mode_cursor_color = "#4ade80",
      
      -- リプレイスモードの設定
      replace_mode_cursor_color = "#f87171",
      
      -- スミア効果の設定
      smear_between_buffers = true,
      smear_between_neighbor_lines = true,
      
      -- アニメーション設定
      scroll_buffer_space = true,
      legacy_computing_symbols_support = false,
      
      -- 透明度
      transparent_bg_fallback_color = "#303030",
      
      -- カーソル移動時の効果
      stiffness = 0.8,               -- 0.6 - 1.0 / デフォルト: 0.8 / 硬さ（高いほど追従が速い）
      trailing_stiffness = 0.5,       -- 0.3 - 1.0 / デフォルト: 0.5 / 尾の硬さ
      trailing_exponent = 0.3,        -- -10 - 10 / デフォルト: 0.3 / 尾の長さ
      distance_stop_animating = 0.5,  -- 0.1 - ... / デフォルト: 0.5 / アニメーション停止距離
      hide_target_hack = false,       -- デフォルト: true / ターゲットカーソルを隠すハック
      
      -- ファイルタイプごとの無効化設定
      filetypes_disabled = {
        "TelescopePrompt",
        "neo-tree",
        "oil",
        "lazy",
        "mason",
      },
      
      -- モードごとの無効化設定
      modes_disabled = {},
    },
  },

  -- Enhanced indent lines and chunk visualization
  {
    "shellRaining/hlchunk.nvim",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
      require("hlchunk").setup({
        chunk = {
          enable = true,
          -- ファイルタイプで指定する（拡張子ではなく）
          support_filetypes = {
            "lua",
            "javascript",
            "javascriptreact",
            "typescript", 
            "typescriptreact",
            "go",
            "rust",
            "python",
            "cs",
            "java",
            "cpp",
            "c",
          },
          -- エラーが出るファイルタイプを除外
          exclude_filetypes = {
            "markdown",
            "yaml", 
            "json",
            "toml",
          },
          chars = {
            horizontal_line = "─",
            vertical_line = "│",
            left_top = "╭",
            left_bottom = "╰",
            right_arrow = ">",
          },
          style = "#806d9c",
          duration = 200,
          delay = 300,
          error_sign = false, -- エラー時のサインを無効化
        },
        
        indent = {
          enable = true,
          use_treesitter = false, -- TreeSitterとの競合を避けるため無効化
          chars = {
            "│",
          },
          style = {
            { fg = "#4a4a5e" },
            { fg = "#5a5a6e" },
            { fg = "#6a6a7e" },
            { fg = "#7a7a8e" },
          },
        },
        
        line_num = {
          enable = false, -- statuscol.nvimと競合するため無効化
        },
        
        blank = {
          enable = false,
        },
      })
    end,
  },

  -- Floating statuslines for windows
  {
    'b0o/incline.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    event = 'BufReadPre',
    config = function()
      local helpers = require 'incline.helpers'
      local devicons = require 'nvim-web-devicons'
      require('incline').setup {
        window = {
          padding = 0,
          margin = { horizontal = 0, vertical = 0 },
        },
        render = function(props)
          local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
          if filename == '' then
            filename = '[No Name]'
          end
          local ft_icon, ft_color = devicons.get_icon_color(filename)
          local modified = vim.bo[props.buf].modified
          
          -- LSP診断情報を取得
          local diagnostics = vim.diagnostic.get(props.buf)
          local errors = #vim.tbl_filter(function(d) return d.severity == vim.diagnostic.severity.ERROR end, diagnostics)
          local warnings = #vim.tbl_filter(function(d) return d.severity == vim.diagnostic.severity.WARN end, diagnostics)
          
          local components = {
            ft_icon and { ' ', ft_icon, ' ', guibg = ft_color, guifg = helpers.contrast_color(ft_color) } or '',
            ' ',
            { filename, gui = modified and 'bold,italic' or 'bold' },
            modified and { ' ●', guifg = '#f9e2af' } or '',
          }
          
          -- エラーと警告の表示
          if errors > 0 then
            table.insert(components, { ' ', ' ', errors, guifg = '#f38ba8' })
          end
          if warnings > 0 then
            table.insert(components, { ' ', ' ', warnings, guifg = '#f9e2af' })
          end
          
          table.insert(components, ' ')
          
          return components
        end,
      }
    end,
  },

  -- ステータスカラムに絶対行番号を表示（相対行番号と併用）
  {
    'luukvbaal/statuscol.nvim',
    event = 'BufReadPre',
    config = function()
      local builtin = require('statuscol.builtin')
      require('statuscol').setup({
        relculright = true, -- 相対行番号を右側に表示
        
        segments = {
          -- Git signs, marks等
          { text = { "%s" }, click = "v:lua.ScSa" },
          -- 絶対行番号と相対行番号を組み合わせて表示
          {
            text = { function(args)
              local abs_num = string.format("%3d", args.lnum)
              local rel_num = ""
              
              -- 相対行番号を括弧で囲む（固定幅）
              if vim.wo.relativenumber then
                local current_line = vim.fn.line('.')
                local rel = math.abs(args.lnum - current_line)
                -- 2桁の固定幅で相対行番号を表示
                if args.lnum == current_line then
                  rel_num = "( 0)"
                else
                  rel_num = string.format("(%2d)", rel)
                end
              else
                -- 相対行番号が無効の場合も幅を確保
                rel_num = "    "
              end
              
              -- 絶対行番号 + 相対行番号（固定幅）+ 縦線 + 余白
              return abs_num .. rel_num .. " │ "
            end },
            click = "v:lua.ScLa",
          },
          -- 折りたたみ表示
          { text = { builtin.foldfunc }, click = "v:lua.ScFa" },
        },
      })
    end,
  },
}
