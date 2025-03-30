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

return M