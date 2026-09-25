-- Statusline configuration
return {
  -- Lualine - A blazing fast and easy to configure Neovim statusline
  {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    config = function()
      -- カスタムコンポーネント
      local colors = {
        bg       = '#202328',
        fg       = '#bbc2cf',
        yellow   = '#ECBE7B',
        cyan     = '#008080',
        darkblue = '#081633',
        green    = '#98be65',
        orange   = '#FF8800',
        violet   = '#a9a1e1',
        magenta  = '#c678dd',
        blue     = '#51afef',
        red      = '#ec5f67',
      }

      local conditions = {
        buffer_not_empty = function()
          return vim.fn.empty(vim.fn.expand('%:t')) ~= 1
        end,
        hide_in_width = function()
          return vim.fn.winwidth(0) > 80
        end,
        check_git_workspace = function()
          local filepath = vim.fn.expand('%:p:h')
          local gitdir = vim.fn.finddir('.git', filepath .. ';')
          return gitdir and #gitdir > 0 and #gitdir < #filepath
        end,
      }

      -- カスタムモードアイコン
      local mode_icon = {
        n = ' ',
        i = ' ',
        v = ' ',
        [''] = ' ',
        V = ' ',
        c = ' ',
        no = ' ',
        s = ' ',
        S = ' ',
        [''] = ' ',
        ic = ' ',
        R = ' ',
        Rv = ' ',
        cv = ' ',
        ce = ' ',
        r = ' ',
        rm = ' ',
        ['r?'] = ' ',
        ['!'] = ' ',
        t = ' '
      }

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
            { 
              function()
                return mode_icon[vim.fn.mode()]
              end,
              color = function()
                -- モードごとに色を変更
                local mode_color = {
                  n = colors.blue,
                  i = colors.green,
                  v = colors.magenta,
                  [''] = colors.magenta,
                  V = colors.magenta,
                  c = colors.yellow,
                  no = colors.red,
                  s = colors.orange,
                  S = colors.orange,
                  [''] = colors.orange,
                  ic = colors.yellow,
                  R = colors.violet,
                  Rv = colors.violet,
                  cv = colors.red,
                  ce = colors.red,
                  r = colors.cyan,
                  rm = colors.cyan,
                  ['r?'] = colors.cyan,
                  ['!'] = colors.red,
                  t = colors.red,
                }
                return { fg = mode_color[vim.fn.mode()], gui = 'bold' }
              end,
              padding = { right = 1 },
            },
            { 'mode', fmt = string.upper }
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
            {
              -- ファイルアイコン
              function()
                local icon, color = require'nvim-web-devicons'.get_icon_color(
                  vim.fn.expand('%:t'),
                  vim.fn.expand('%:e'),
                  { default = true }
                )
                return icon
              end,
              color = function()
                local _, color = require'nvim-web-devicons'.get_icon_color(
                  vim.fn.expand('%:t'),
                  vim.fn.expand('%:e'),
                  { default = true }
                )
                return { fg = color }
              end,
              cond = conditions.buffer_not_empty,
            },
            { 'filename',
              file_status = true,
              newfile_status = true,
              path = 1,
              shorting_target = 40,
              symbols = {
                modified = ' ●',
                readonly = ' ',
                unnamed = '[No Name]',
                newfile = ' ',
              }
            },
            { 
              -- ファイルサイズ
              function()
                local suffix = { 'b', 'k', 'M', 'G', 'T', 'P', 'E' }
                local fsize = vim.fn.getfsize(vim.fn.expand('%:p'))
                fsize = (fsize < 0 and 0) or fsize
                if fsize < 1024 then
                  return fsize .. suffix[1]
                end
                local i = math.floor((math.log(fsize) / math.log(1024)))
                return string.format('%.1f%s', fsize / math.pow(1024, i), suffix[i + 1])
              end,
              cond = conditions.buffer_not_empty,
              color = { fg = colors.green },
              icon = ' ',
            },
          },
          lualine_x = {
            {
              -- Copilot状態（後で追加時に有効化）
              function()
                local ok, copilot = pcall(require, "copilot.api")
                if not ok then return "" end
                
                local status = copilot.status.data
                if status.status == "InProgress" then
                  return " "
                elseif status.status == "Warning" then
                  return " "
                else
                  return " "
                end
              end,
              color = function()
                local ok, copilot = pcall(require, "copilot.api")
                if not ok then return { fg = colors.fg } end
                
                local status = copilot.status.data.status
                if status == "InProgress" then
                  return { fg = colors.yellow }
                elseif status == "Warning" then
                  return { fg = colors.orange }
                else
                  return { fg = colors.green }
                end
              end,
              cond = function()
                local ok, _ = pcall(require, "copilot.api")
                return ok
              end,
            },
            {
              -- LSP進行状況（Fidget連携）
              function()
                local lsp = vim.lsp.util.get_progress_messages()[1]
                if not lsp then return "" end
                
                local msg = lsp.message or ""
                local percentage = lsp.percentage or 0
                local title = lsp.title or ""
                local spinners = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
                local success_icon = { "", "" }
                
                local ms = (vim.loop.hrtime() / 1000000) % #spinners
                local frame = math.floor(ms / 120) + 1
                
                if percentage >= 70 then
                  return string.format(" %%<%s %s %s (%s%%%%) ", success_icon[frame], title, msg, percentage)
                else
                  return string.format(" %%<%s %s %s (%s%%%%) ", spinners[frame], title, msg, percentage)
                end
              end,
              color = { fg = colors.blue, gui = 'bold' },
            },
            {
              -- アクティブなLSP一覧
              function()
                local clients = vim.lsp.get_active_clients({ bufnr = 0 })
                if next(clients) == nil then
                  return '󰒲 No LSP'
                end
                
                local client_names = {}
                for _, client in ipairs(clients) do
                  if client.name ~= "null-ls" and client.name ~= "copilot" then
                    table.insert(client_names, client.name)
                  end
                end
                
                return ' ' .. table.concat(client_names, ', ')
              end,
              color = { fg = colors.violet, gui = 'bold' },
              cond = conditions.hide_in_width,
            },
            { 
              -- フォーマッター状態（Conform連携）
              function()
                local formatters = require("conform").list_formatters(0)
                if #formatters == 0 then
                  return ""
                end
                local formatter_names = {}
                for _, formatter in ipairs(formatters) do
                  table.insert(formatter_names, formatter.name)
                end
                return " " .. table.concat(formatter_names, ", ")
              end,
              color = { fg = colors.cyan },
              cond = function()
                return package.loaded["conform"] ~= nil
              end,
            },
            { 'encoding', fmt = string.upper, cond = conditions.hide_in_width, color = { fg = colors.green, gui = 'bold' } },
            { 'fileformat', icons_enabled = true, symbols = { unix = '', dos = '', mac = '' }, cond = conditions.hide_in_width },
            { 'filetype', colored = true, icon_only = false },
          },
          lualine_y = {
            {
              -- 検索件数
              function()
                if vim.v.hlsearch == 0 then
                  return ''
                end
                local last_search = vim.fn.getreg('/')
                if not last_search or last_search == '' then
                  return ''
                end
                local searchcount = vim.fn.searchcount({ maxcount = 9999 })
                return ' ' .. searchcount.current .. '/' .. searchcount.total
              end,
              color = { fg = colors.orange },
            },
            { 'progress', color = { fg = colors.fg, gui = 'bold' } }
          },
          lualine_z = { 
            {
              -- 行数、列数、選択文字数
              function()
                local line = vim.fn.line('.')
                local col = vim.fn.col('.')
                local total_lines = vim.fn.line('$')
                
                -- ビジュアルモードの場合、選択文字数を表示
                if vim.fn.mode():find("[vV]") then
                  local start_line, start_col = vim.fn.line("'<"), vim.fn.col("'<")
                  local end_line, end_col = vim.fn.line("'>"), vim.fn.col("'>")
                  local lines = math.abs(end_line - start_line) + 1
                  local chars = 0
                  
                  if start_line == end_line then
                    chars = math.abs(end_col - start_col) + 1
                  else
                    -- 複数行の場合は概算
                    chars = (lines - 1) * 80 + end_col
                  end
                  
                  return string.format(' %d  %dL %dC', line, lines, chars)
                end
                
                return string.format(' %d/%d:%d', line, total_lines, col)
              end,
              color = { fg = colors.orange, gui = 'bold' }
            },
            {
              -- 現在時刻
              function()
                return ' ' .. os.date('%H:%M')
              end,
              color = { fg = colors.blue },
            }
          }
        },
        inactive_sections = {
          lualine_a = {},
          lualine_b = {},
          lualine_c = { 
            {
              'filename',
              path = 1,
              symbols = {
                modified = ' ●',
                readonly = ' ',
                unnamed = '[No Name]',
                newfile = ' ',
              }
            }
          },
          lualine_x = { 'location' },
          lualine_y = {},
          lualine_z = {}
        },
        tabline = {},
        winbar = {},
        inactive_winbar = {},
        extensions = { 'neo-tree', 'lazy', 'trouble', 'mason', 'toggleterm', 'quickfix' }
      }
    end,
  },
}