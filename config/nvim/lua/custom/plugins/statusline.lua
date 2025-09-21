-- Statusline configuration
return {
  -- Lualine - A blazing fast and easy to configure Neovim statusline
  {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    config = function()
      require('lualine').setup {
        options = {
          theme = 'catppuccin',
          component_separators = { left = '', right = ''},
          section_separators = { left = '', right = ''},
          disabled_filetypes = {
            statusline = { 'neo-tree' },
            winbar = {},
          },
          ignore_focus = {},
          always_divide_middle = true,
          globalstatus = true,
          refresh = {
            statusline = 1000,
            tabline = 1000,
            winbar = 1000,
          }
        },
        sections = {
          lualine_a = { 
            { 'mode', icon = '' }
          },
          lualine_b = {
            { 'branch', icon = '' },
            { 'diff', 
              colored = true,
              diff_color = {
                added    = { fg = '#a6e3a1' },
                modified = { fg = '#f9e2af' },
                removed  = { fg = '#f38ba8' },
              },
              symbols = { added = ' ', modified = ' ', removed = ' ' },
            },
            { 'diagnostics',
              sources = { 'nvim_diagnostic', 'nvim_lsp' },
              sections = { 'error', 'warn', 'info', 'hint' },
              diagnostics_color = {
                error = { fg = '#f38ba8' },
                warn  = { fg = '#f9e2af' },
                info  = { fg = '#89b4fa' },
                hint  = { fg = '#94e2d5' },
              },
              symbols = { error = ' ', warn = ' ', info = ' ', hint = ' ' },
              colored = true,
              update_in_insert = false,
              always_visible = false,
            }
          },
          lualine_c = {
            { 'filename',
              file_status = true,
              newfile_status = false,
              path = 1,  -- 0: Just filename, 1: Relative path, 2: Absolute path
              shorting_target = 40,
              symbols = {
                modified = '[+]',
                readonly = '[-]',
                unnamed = '[No Name]',
                newfile = '[New]',
              }
            }
          },
          lualine_x = {
            {
              function()
                local msg = 'No Active Lsp'
                local buf_ft = vim.api.nvim_buf_get_option(0, 'filetype')
                local clients = vim.lsp.get_active_clients()
                if next(clients) == nil then
                  return msg
                end
                for _, client in ipairs(clients) do
                  local filetypes = client.config.filetypes
                  if filetypes and vim.fn.index(filetypes, buf_ft) ~= -1 then
                    return client.name
                  end
                end
                return msg
              end,
              icon = ' LSP:',
              color = { fg = '#ffffff', gui = 'bold' },
            },
            { 'encoding', fmt = string.upper },
            { 'fileformat', icons_enabled = true, symbols = { unix = 'LF', dos = 'CRLF', mac = 'CR' } },
            { 'filetype', colored = true, icon_only = false },
          },
          lualine_y = {
            { 'progress' }
          },
          lualine_z = { 
            { 'location', icon = '' }
          }
        },
        inactive_sections = {
          lualine_a = {},
          lualine_b = {},
          lualine_c = { 'filename' },
          lualine_x = { 'location' },
          lualine_y = {},
          lualine_z = {}
        },
        tabline = {},
        winbar = {},
        inactive_winbar = {},
        extensions = { 'neo-tree', 'lazy', 'trouble', 'mason' }
      }
    end,
  },
}