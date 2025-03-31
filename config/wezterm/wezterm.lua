local wezterm = require('wezterm')

-- モジュールのインポート
local appearance = require('lua.core.appearance')
local keybinds = require('lua.core.keybinds')
local colors = require('lua.ui.colors')
local status = require('lua.ui.status')
local tabs = require('lua.ui.tabs')
local os_utils = require('lua.utils.os') -- OSユーティリティをインポート

local config = {}
if wezterm.config_builder then
    config = wezterm.config_builder()
end

-- 各モジュールの設定を適用
appearance.apply_to_config(config)
keybinds.apply_to_config(config)
colors.apply_to_config(config)
status.apply_to_config(config)
tabs.apply_to_config(config)

-- パフォーマンス設定
config.front_end = "WebGpu"
config.webgpu_power_preference = "HighPerformance"
config.animation_fps = 60
config.max_fps = 60

-- ウィンドウフレームの設定
config.window_background_opacity = 0.95
config.window_decorations = "RESIZE"
config.window_frame = {
    font = wezterm.font { family = 'Hack Nerd Font', weight = 'Bold' },
    font_size = 12.0,
    active_titlebar_bg = colors.get_colors().mantle,
    inactive_titlebar_bg = colors.get_colors().surface0,
    border_left_width = '2cell',
    border_right_width = '2cell',
    border_bottom_height = '1cell',
    border_top_height = '0cell',
    border_left_color = colors.get_colors().mantle,
    border_right_color = colors.get_colors().mantle,
    border_bottom_color = colors.get_colors().mantle,
    border_top_color = colors.get_colors().mantle,
}

-- 外側のパディング設定
config.window_padding = {
    left = "2.5cell",
    right = "2.5cell",
    top = "0",
    bottom = "0",
}

-- パネルボーダーの設定
config.inactive_pane_hsb = {
    saturation = 0.9,
    brightness = 0.8,
}

-- デバッグ設定
config.debug_key_events = false

-- デフォルトの作業ディレクトリとシェルを設定
config.default_cwd = os_utils.get_home_dir() -- OSに応じたホームディレクトリを取得
config.default_prog = os_utils.get_default_shell() -- OSに応じたデフォルトシェルを取得

-- タブタイトルの設定
wezterm.on('format-tab-title', function(tab, tabs, panes, config, hover, max_width)
    local title = tab.active_pane.title
    local cwd = tab.active_pane.current_working_dir
    if cwd then
        local home_dir = os_utils.get_home_dir() -- OSに応じたホームディレクトリを取得
        local display_path = cwd.file_path
        if home_dir then
            display_path = display_path:gsub(home_dir, '~') -- ホームディレクトリをチルダに置換
        end
        title = wezterm.format({
            { Text = wezterm.nerdfonts.md_folder .. ' ' },
            { Text = display_path },
        })
    end
    return title
end)

-- レイアウトの設定
wezterm.on('gui-startup', function(cmd)
  local layout = require('lua.core.layout')
  local tab, pane, window = layout.default(cmd)
  -- 起動時に最大化
  window:gui_window():maximize()
end)

return config 