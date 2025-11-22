-- Code enhancement and visualization plugins
return {
  -- Function argument highlighting
  {
    'm-demare/hlargs.nvim',
    event = 'BufReadPre',
    config = function()
      require('hlargs').setup({
        color = '#ef9062',
        highlight = {},
        excluded_filetypes = {},
        paint_arg_declarations = true,
        paint_arg_usages = true,
        paint_catch_blocks = {
          declarations = false,
          usages = false
        },
        extras = {
          named_parameters = true,
        },
        hl_priority = 10000,
        excluded_argnames = {
          declarations = {},
          usages = {
            python = { 'self', 'cls' },
            lua = { 'self' }
          }
        },
        performance = {
          parse_delay = 1,
          slow_parse_delay = 50,
          max_filesize = 2048 * 1024,
          max_iterations = 400,
        },
      })
    end,
  },
  
  -- Better marks visualization
  {
    'chentoast/marks.nvim',
    event = 'BufReadPre',
    opts = {
      default_mappings = true,
      builtin_marks = { ".", "<", ">", "^" },
      cyclic = true,
      force_write_shada = false,
      refresh_interval = 250,
      sign_priority = { lower=10, upper=15, builtin=8, bookmark=20 },
      excluded_filetypes = {
        'prompt',
        'TelescopePrompt',
        'neo-tree',
        'neo-tree-popup',
      },
      bookmark_0 = {
        sign = "⚑",
        virt_text = "hello world",
        annotate = false,
      },
      mappings = {}
    }
  },
  
  -- Context virtual text
  {
    'andersevenrud/nvim_context_vt',
    event = 'BufReadPre',
    opts = {
      enabled = true,
      prefix = '→',
      highlight = 'Comment',
      min_rows = 1,
      min_rows_ft = {},
      disable_ft = { 'markdown' },
      disable_virtual_lines = false,
      disable_virtual_lines_ft = { 'yaml' },
      custom_parser = function(node, ft, opts)
        local utils = require('nvim_context_vt.utils')
        if ft == 'python' and node:type() == 'function_definition' then
          return nil
        end
        return utils.get_node_text(node)
      end,
      custom_resolver = function(nodes, ft, opts)
        if ft == 'yaml' then
          return nodes[#nodes]
        end
        return nil
      end,
    }
  },
  
  -- Jump cursor restoration
  {
    'skanehira/jumpcursor.vim',
    event = 'BufReadPre',
    config = function()
      vim.g.jumpcursor_enable = 1
    end,
  },
  
  -- Context-aware commenting
  {
    'JoosepAlviste/nvim-ts-context-commentstring',
    lazy = true,
    opts = {
      enable_autocmd = false,
    },
    config = function(_, opts)
      require('ts_context_commentstring').setup(opts)
      
      -- Integration with mini.comment
      local get_option = vim.filetype.get_option
      vim.filetype.get_option = function(filetype, option)
        return option == 'commentstring'
          and require('ts_context_commentstring.internal').calculate_commentstring()
          or get_option(filetype, option)
      end
    end,
  },
}