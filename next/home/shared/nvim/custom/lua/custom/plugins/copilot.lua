-- GitHub Copilot integration
return {
  {
    'zbirenbaum/copilot.lua',
    cmd = 'Copilot',
    event = 'InsertEnter',
    config = function()
      require('copilot').setup({
        panel = {
          enabled = true,
          auto_refresh = false,
          keymap = {
            jump_prev = '[[',
            jump_next = ']]',
            accept = '<CR>',
            refresh = 'gr',
            open = '<M-CR>'
          },
          layout = {
            position = 'bottom',
            ratio = 0.4
          },
        },
        
        suggestion = {
          enabled = true,
          auto_trigger = true,
          debounce = 75,
          keymap = {
            accept = '<M-l>',
            accept_word = false,
            accept_line = false,
            next = '<M-]>',
            prev = '<M-[>',
            dismiss = '<C-]>',
          },
        },
        
        filetypes = {
          yaml = false,
          markdown = false,
          help = false,
          gitcommit = false,
          gitrebase = false,
          hgcommit = false,
          svn = false,
          cvs = false,
          ["."] = false,
        },
        
        copilot_node_command = 'node',
        server_opts_overrides = {},
      })
      
      -- Custom keymaps
      vim.keymap.set('i', '<C-J>', 'copilot#Accept("\\<CR>")', {
        expr = true,
        replace_keycodes = false,
        desc = 'Accept Copilot suggestion'
      })
      
      -- Set up Copilot status for lualine
      vim.api.nvim_create_autocmd('User', {
        pattern = 'CopilotSuggestionAccepted',
        callback = function()
          vim.g.copilot_suggestion_accepted = vim.g.copilot_suggestion_accepted or 0
          vim.g.copilot_suggestion_accepted = vim.g.copilot_suggestion_accepted + 1
        end,
      })
    end,
  },
  
  -- Optional: Copilot Chat integration
  {
    'zbirenbaum/copilot-cmp',
    dependencies = 'zbirenbaum/copilot.lua',
    enabled = false, -- blink.cmpとの互換性のため無効化
    config = function()
      require('copilot_cmp').setup()
    end,
  },
}