-- config/wezterm/lua/utils/os.lua
local wezterm = require('wezterm')
local M = {}

-- Determine if the current OS is Windows-based
function M.is_windows()
  -- Check if "windows" is included in wezterm.target_triple
  return wezterm.target_triple and string.find(wezterm.target_triple, "windows") ~= nil
end

-- Get the home directory according to the OS
function M.get_home_dir()
  if M.is_windows() then
    -- For Windows, prioritize USERPROFILE
    return os.getenv('USERPROFILE')
  else
    -- For others (macOS, Linux, etc.), use HOME
    return os.getenv('HOME')
  end
  -- If neither is found, return nil (error handling is expected to be done by the caller)
end

-- Get the default shell according to the OS
function M.get_default_shell()
  if M.is_windows() then
    -- For Windows, launch Zsh in the default WSL distribution
    -- Using wsl.exe to connect to the shell in WSL
    return { 'wsl.exe', '--', 'zsh', '-l' }
    
    -- To use PowerShell as the default:
    -- return { 'powershell.exe', '-NoLogo' }
    
    -- To use cmd as the default:
    -- return { 'cmd.exe' }
  else
    -- For macOS/Linux, use zsh
    return { '/bin/zsh', '-l' }
  end
end
-- 特定のパターンにマッチするファイルをディレクトリから取得し、ランダムに1つ選択する
function M.get_random_file(directory, pattern)
  if not directory then return nil end
  
  -- ターゲットOSを判定
  local is_win = M.is_windows()
  
  -- OSに応じたパス区切り文字とコマンド
  local separator = is_win and "\\" or "/"
  
  -- コマンド構築
  local cmd
  if is_win then
    cmd = 'dir /b "' .. directory .. '\\' .. pattern .. '" 2>nul'
  else
    cmd = 'ls "' .. directory .. '"/' .. pattern .. ' 2>/dev/null'
  end
  
  -- ファイル一覧を取得
  local handle = io.popen(cmd)
  if not handle then return nil end
  
  local result = handle:read("*a")
  handle:close()
  
  -- パスを収集
  local files = {}
  for path in result:gmatch("[^\n]+") do
    -- Windowsの場合はファイル名だけが返ってくるので、フルパスを構築
    local full_path = is_win and (directory .. "\\" .. path) or path
    table.insert(files, full_path)
  end
  
  -- ランダムに選択
  if #files > 0 then
    return files[math.random(#files)]
  end
  return nil
end

-- dotfilesプロジェクトの背景画像ディレクトリからランダムに画像を選択
function M.get_random_background()
  local home = M.get_home_dir()
  if not home then return nil end
  
  local is_win = M.is_windows()
  local separator = is_win and "\\" or "/"
  
  -- dotfilesプロジェクトのパスを構築
  local dotfiles_path
  if is_win then
    dotfiles_path = home .. "\\go\\github.com\\esh2n\\dotfiles"
  else
    dotfiles_path = home .. "/go/github.com/esh2n/dotfiles"
  end
  
  -- 背景画像ディレクトリのパス
  local bg_dir = dotfiles_path .. separator .. "config" .. separator .. "background"
  
  -- ランダムな画像を取得
  return M.get_random_file(bg_dir, "*.jpg")
end

return M