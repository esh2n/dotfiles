local wezterm = require('wezterm')

-- モジュールのインポート
local appearance = require('lua.core.appearance')
local keybinds = require('lua.core.keybinds')
local colors = require('lua.ui.colors')
local status = require('lua.ui.status')
local tabs = require('lua.ui.tabs')

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
config.max_fps = 120

-- デバッグ設定
config.debug_key_events = false

return config 