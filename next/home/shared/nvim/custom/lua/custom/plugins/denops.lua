-- Denops-based plugins (requires Deno)
return {
  -- Denops dependency
  {
    'vim-denops/denops.vim',
    lazy = false,
    cond = function()
      return vim.fn.executable('deno') == 1
    end,
    config = function()
      -- Denops設定
      vim.g['denops#deno'] = vim.fn.exepath('deno')
      vim.g['denops#debug'] = 0
      -- vim.g['denops_server_addr'] = '127.0.0.1:32123' -- 自動起動させるためコメントアウト
      
      -- Denopsサーバーの自動起動を有効化
      vim.g['denops#server#channel#deno_executable'] = vim.fn.exepath('deno')
    end,
  },
  
  -- Popup preview for completion
  {
    'matsui54/denops-popup-preview.vim',
    dependencies = { 'vim-denops/denops.vim' },
    event = 'InsertEnter',
    cond = function()
      return vim.fn.executable('deno') == 1
    end,
    config = function()
      vim.g.popup_preview_config = {
        delay = 100,
        height = 20,
        width = 80,
        maxHeight = 20,
        maxWidth = 80,
        winblend = 10,
        border = true,
      }
    end,
  },
  
  -- Signature help  
  {
    'matsui54/denops-signature_help',
    dependencies = { 'vim-denops/denops.vim' },
    event = 'InsertEnter',
    cond = function()
      return vim.fn.executable('deno') == 1
    end,
    config = function()
      vim.g.signature_help_config = {
        border = true,
        maxHeight = 20,
        maxWidth = 80,
        winblend = 10,
      }
      -- Denopsサーバーが起動してから有効化
      vim.defer_fn(function()
        if vim.fn.exists('*denops#server#status') == 1 and vim.fn['denops#server#status']() == 'running' then
          vim.cmd('call signature_help#enable()')
        end
      end, 3000) -- 3秒後に実行
    end,
  },
}