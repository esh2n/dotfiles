-- config/wezterm/lua/utils/os.lua
local wezterm = require('wezterm')
local M = {}

-- 現在のOSがWindows系か判定する
function M.is_windows()
  -- wezterm.target_triple に "windows" が含まれるかで判定
  return wezterm.target_triple and string.find(wezterm.target_triple, "windows") ~= nil
end

-- OSに応じたホームディレクトリを取得する
function M.get_home_dir()
  if M.is_windows() then
    -- Windowsの場合は USERPROFILE を優先
    return os.getenv('USERPROFILE')
  else
    -- それ以外 (macOS, Linuxなど) は HOME を使用
    return os.getenv('HOME')
  end
  -- もしどちらも見つからない場合は nil を返す (エラーハンドリングは呼び出し元で行う想定)
end

-- OSに応じたデフォルトシェルを取得する
function M.get_default_shell()
  if M.is_windows() then
    -- Windowsの場合、WSLのデフォルトディストリビューションのZshを起動
    -- WSL内のシェルに接続するため wsl.exe を使用
    return { 'wsl.exe', '--', 'zsh', '-l' }
    
    -- PowerShellをデフォルトにしたい場合は以下を使用:
    -- return { 'powershell.exe', '-NoLogo' }
    
    -- cmdをデフォルトにしたい場合は以下を使用:
    -- return { 'cmd.exe' }
  else
    -- macOS/Linuxの場合は zsh を使用
    return { '/bin/zsh', '-l' }
  end
end

return M