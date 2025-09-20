return {
  -- カラーテーマ
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
      require("catppuccin").setup({
        flavour = "mocha",
        integrations = {
          cmp = true,
          gitsigns = true,
          nvimtree = true,
          treesitter = true,
          notify = true,
          mini = false,
          indent_blankline = {
            enabled = true,
            scope_color = "lavender",
            colored_indent_levels = false,
          },
        },
      })
      vim.cmd.colorscheme "catppuccin"
    end,
  },

  -- ファイルツリー
  {
    "nvim-tree/nvim-tree.lua",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = true,
  },

  -- LSP
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
    },
  },

  -- 補完
  {
    "hrsh7th/nvim-cmp",
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
      "L3MON4D3/LuaSnip",
    },
  },

  -- Treesitter
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter.configs").setup({
        ensure_installed = {
          -- Web
          "typescript",
          "javascript",
          "tsx",
          "html",
          "css",
          "json",
          -- Go
          "go",
          "gomod",
          "gowork",
          "gosum",
          -- Rust
          "rust",
          "toml",
          -- Dart
          "dart",
          -- C#
          "c_sharp",
          -- C++
          "cpp",
          "cmake",
          -- Kotlin
          "kotlin",
          -- Swift
          "swift",
          -- Lua
          "lua",
          "vim",
          "vimdoc",
          -- Python
          "python",
          -- その他
          "markdown",
          "yaml",
          "regex",
          "bash",
          "dockerfile",
        },
        sync_install = false,
        auto_install = true,
        highlight = {
          enable = true,
          additional_vim_regex_highlighting = false,
        },
        indent = { enable = true },
        incremental_selection = {
          enable = true,
          keymaps = {
            init_selection = "<C-space>",
            node_incremental = "<C-space>",
            scope_incremental = "<C-s>",
            node_decremental = "<C-backspace>",
          },
        },
        textobjects = {
          select = {
            enable = true,
            lookahead = true,
            keymaps = {
              ["af"] = "@function.outer",
              ["if"] = "@function.inner",
              ["ac"] = "@class.outer",
              ["ic"] = "@class.inner",
            },
          },
        },
      })
    end,
    dependencies = {
      "nvim-treesitter/nvim-treesitter-textobjects",
    },
  },

  -- Telescope
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
  },

  -- ステータスライン
  {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    config = function()
      require('lualine').setup({
        options = {
          theme = 'catppuccin',
        },
      })
    end,
  },

  -- Git
  {
    'lewis6991/gitsigns.nvim',
    config = function()
      require('gitsigns').setup()
    end,
  },

  -- Auto pairs
  {
    'windwp/nvim-autopairs',
    event = "InsertEnter",
    config = function()
      require('nvim-autopairs').setup()
    end,
  },

  -- インデントガイド
  {
    "lukas-reineke/indent-blankline.nvim",
    main = "ibl",
    config = function()
      require("ibl").setup({
        indent = { char = "│" },
        scope = { enabled = true },
      })
    end,
  },

  -- コメントアウト
  {
    'numToStr/Comment.nvim',
    config = function()
      require('Comment').setup()
    end,
  },

  -- Fuzzy Finder
  {
    'nvim-telescope/telescope.nvim',
    dependencies = {
      'nvim-lua/plenary.nvim',
      { 'nvim-telescope/telescope-fzf-native.nvim', build = 'MACOSX_DEPLOYMENT_TARGET=11.0 ARCHFLAGS="-arch arm64" make clean && MACOSX_DEPLOYMENT_TARGET=11.0 ARCHFLAGS="-arch arm64" make' },
    },
    config = function()
      require('telescope').setup({
        extensions = {
          fzf = {
            fuzzy = true,
            override_generic_sorter = true,
            override_file_sorter = true,
            case_mode = "smart_case",
          },
        },
      })
      -- Safely load fzf extension
      local status_ok, _ = pcall(require('telescope').load_extension, 'fzf')
      if not status_ok then
        vim.notify("FZF extension not loaded - will be available after rebuild", vim.log.levels.WARN)
      end
    end,
  },

  -- ミニマップ
  {
    'gorbit99/codewindow.nvim',
    config = function()
      local codewindow = require('codewindow')
      codewindow.setup()
      codewindow.apply_default_keybinds()
    end,
  },

  -- Todo コメント
  {
    "folke/todo-comments.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      require("todo-comments").setup()
    end,
  },

  -- バッファライン
  {
    'akinsho/bufferline.nvim',
    version = "*",
    dependencies = 'nvim-tree/nvim-web-devicons',
    config = function()
      require("bufferline").setup({
        options = {
          mode = "buffers",
          separator_style = "slant",
        },
      })
    end,
  },

  -- ターミナル
  {
    "akinsho/toggleterm.nvim",
    version = '*',
    config = function()
      require("toggleterm").setup({
        open_mapping = [[<c-\>]],
        direction = 'float',
      })
    end,
  },

  -- サーチ
  {
    'nvim-pack/nvim-spectre',
    dependencies = {
      'nvim-lua/plenary.nvim',
    },
  },

  -- モーション
  {
    'phaazon/hop.nvim',
    config = function()
      require('hop').setup()
    end,
  },

  -- DevPod対応のリモート開発プラグイン
  {
    "amitds1997/remote-nvim.nvim",
    version = "*",
    lazy = false,  -- 起動時に必ずロード
    dependencies = {
      "nvim-lua/plenary.nvim",
      "MunifTanjim/nui.nvim",
      "nvim-telescope/telescope.nvim",
    },
    config = function()
      require("remote-nvim").setup({
        devpod = {
          binary = "devpod",
          docker_binary = "docker",
        },
        ssh_config = {
          ssh_binary = "ssh", 
          scp_binary = "scp",
        },
        remote = {
          app_name = "nvim",
          config_dir = vim.fn.stdpath("config"),
        },
      })
    end,
    keys = {
      { "<leader>rc", "<cmd>RemoteStart<cr>", desc = "リモート接続開始" },
      { "<leader>rs", "<cmd>RemoteStop<cr>", desc = "リモート接続終了" },
      { "<leader>ri", "<cmd>RemoteInfo<cr>", desc = "リモート接続情報" },
      { "<leader>rd", "<cmd>RemoteConfigDel<cr>", desc = "リモート設定削除" },
    },
  },
} 