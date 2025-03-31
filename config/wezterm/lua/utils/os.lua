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

return M