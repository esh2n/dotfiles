-- GitHub integration plugins
return {
  -- GitHub issues, PRs, and more in Neovim
  {
    'pwntester/octo.nvim',
    dependencies = {
      'nvim-lua/plenary.nvim',
      'nvim-telescope/telescope.nvim',
      'nvim-tree/nvim-web-devicons',
    },
    cmd = 'Octo',
    config = function()
      require('octo').setup({
        use_local_fs = false,
        enable_builtin = true,
        
        default_remote = { "upstream", "origin" },
        
        ssh_aliases = {}, -- SSH aliases. e.g. `ssh_aliases = {["github.com-work"] = "github.com"}`
        
        picker = "telescope",
        picker_config = {
          use_emojis = false,
          mappings = {
            open_in_browser = { lhs = "<C-b>", desc = "open issue in browser" },
            copy_url = { lhs = "<C-y>", desc = "copy url to clipboard" },
            checkout_pr = { lhs = "<C-o>", desc = "checkout pull request" },
            merge_pr = { lhs = "<C-r>", desc = "merge pull request" },
          },
        },
        
        comment_icon = "▎",
        outdated_icon = "󰅒 ",
        resolved_icon = " ",
        reaction_viewer_hint_icon = " ",
        user_icon = " ",
        timeline_marker = " ",
        timeline_indent = "2",
        
        right_bubble_delimiter = "",
        left_bubble_delimiter = "",
        
        github_hostname = "",
        
        snippet_context_lines = 4,
        
        gh_cmd = "gh",
        gh_env = {},
        
        timeout = 5000,
        default_to_projects_v2 = false,
        
        ui = {
          use_signcolumn = true,
        },
        
        issues = {
          order_by = {
            field = "CREATED_AT",
            direction = "DESC",
          },
        },
        
        pull_requests = {
          order_by = {
            field = "CREATED_AT", 
            direction = "DESC",
          },
          always_select_remote_on_create = false,
        },
        
        file_panel = {
          size = 10,
          use_icons = true,
        },
        
        colors = {
          white = "#ffffff",
          grey = "#8b949e",
          black = "#000000",
          red = "#ff6b6b",
          dark_red = "#da3633",
          green = "#5cff5c",
          dark_green = "#238636",
          yellow = "#f9e64f",
          dark_yellow = "#d29922",
          blue = "#79c0ff",
          dark_blue = "#1158c7",
          purple = "#d2a8ff",
        },
      })
      
      -- Keymaps
      vim.keymap.set('n', '<leader>gi', '<cmd>Octo issue list<CR>', { desc = 'List GitHub issues' })
      vim.keymap.set('n', '<leader>gp', '<cmd>Octo pr list<CR>', { desc = 'List GitHub PRs' })
      vim.keymap.set('n', '<leader>gr', '<cmd>Octo review start<CR>', { desc = 'Start PR review' })
    end,
  },
}