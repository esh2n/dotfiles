local wezterm = require('wezterm')

local M = {}

-- osascriptを使ってSpotifyの情報を取得
local function get_spotify_info_mac()
    local success, stdout, stderr = wezterm.run_child_process({
        'osascript',
        '-e', 'tell application "Spotify"',
        '-e', 'if player state is playing then',
        '-e', 'return (get artist of current track) & " - " & (get name of current track)',
        '-e', 'else',
        '-e', 'return "Not playing"',
        '-e', 'end if',
        '-e', 'end tell'
    })

    if success then
        local track_info = stdout:gsub('\n', '')
        if track_info ~= "Not playing" then
            return "♫ " .. track_info
        end
    end
    return nil
end

function M.get_spotify()
    if wezterm.target_triple == "x86_64-apple-darwin" or 
       wezterm.target_triple == "aarch64-apple-darwin" then
        return get_spotify_info_mac()
    end
    return nil
end

return M 