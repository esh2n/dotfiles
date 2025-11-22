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
    -- Windowsでは直接WSLに接続し、不要なプロセス起動を避ける
    -- 標準の方法でWSL起動（コマンドの簡素化）
    return { 'wsl.exe', '~' }
    
    -- PowerShellを使用したい場合のオプション:
    -- return { 'powershell.exe', '-NoLogo' }
    
    -- cmdを使用したい場合のオプション:
    -- return { 'cmd.exe' }
  else
    -- macOS/Linuxの場合はzsh
    return { '/bin/zsh', '-l' }
  end
end
-- 特定のパターンにマッチするファイルをディレクトリから取得し、ランダムに1つ選択する
-- io.popenを使わない方式に変更し、Windows環境でのパフォーマンスを向上
function M.get_random_file(directory, pattern)
  if not directory then return nil end
  
  -- ターゲットOSを判定
  local is_win = M.is_windows()
  
  -- OSに応じたパス区切り文字
  local separator = is_win and "\\" or "/"
  
  -- 直接ファイルシステムにアクセスせず、静的なパスを使用
  -- 背景画像の場合は固定数のファイルがあることを想定
  -- 実装の単純化のため固定パターンを使用
  -- パターンが*.jpgの場合は画像ファイルと仮定
  if pattern == "*.jpg" then
    -- 1から23までの数字でファイル名を生成
    local image_num = math.random(23)
    local filename = image_num .. "_0.jpg"
    return directory .. separator .. filename
  end
  
  -- パターンマッチングが必要な他のケースは今後必要に応じて実装
  return nil
end

-- dotfilesプロジェクトの背景画像ディレクトリからランダムに画像を選択
-- 最適化版：io.popenを使わずにシンプルに実装
function M.get_random_background()
  local home = M.get_home_dir()
  if not home then return nil end
  
  local is_win = M.is_windows()
  local separator = is_win and "\\" or "/"
  
  -- dotfilesプロジェクトのパスを構築
  -- DOTFILES_ROOT環境変数があればそれを使用、なければデフォルトパス
  local dotfiles_root = os.getenv('DOTFILES_ROOT')
  local bg_dir
  
  if dotfiles_root then
    -- DOTFILES_ROOTが設定されている場合はそれを使用
    bg_dir = dotfiles_root .. separator .. "config" .. separator .. "background"
  else
    -- 環境変数がない場合は標準的な場所を推測
    -- ユーザー名は動的に取得できないため、dotfilesが~/dotfilesにあると仮定
    bg_dir = home .. separator .. "dotfiles" .. separator .. "config" .. separator .. "background"
  end
  
  -- シンプルな実装でランダムに画像を選択
  local image_num = math.random(23) -- 1から23までのランダムな数字
  return bg_dir .. separator .. image_num .. "_0.jpg"
end

return M
