local wezterm = require('wezterm')
local weather = require('lua.ui.weather')
local earthquake = require('lua.ui.earthquake')
local colors = require('lua.ui.colors')

local M = {}

-- カラーパレット（Catppuccinテーマ）
local COLORS = {
    blue = "#89b4fa",    -- 天気
    red = "#f38ba8",     -- 地震
    green = "#a6e3a1",   -- バッテリー
    mauve = "#cba6f7",   -- 時刻
    surface0 = "#313244",
    base = "#1e1e2e",
}

function M.apply_to_config(config)
    -- ステータスバーの更新間隔（秒）
    config.status_update_interval = 1000

    wezterm.on("update-status", function(window, pane)
        -- 現在時刻
        local time = wezterm.strftime("%H:%M")
        
        -- バッテリー情報
        local battery = ''
        for _, b in ipairs(wezterm.battery_info()) do
            local battery_icon = '●'  -- シンプルな丸アイコン
            if b.state == 'Charging' then
                battery_icon = '↑'  -- 充電中
            elseif b.state == 'Empty' then
                battery_icon = '○'  -- 要充電
            end
            battery = string.format('%s %d%%', battery_icon, b.state_of_charge * 100)
        end

        -- 天気情報
        local weather_info = weather.get_weather()
        
        -- 地震情報
        local earthquake_info = earthquake.get_earthquake()

        -- セパレータ
        local separator = "   "  -- スペースを広めに
        local C = colors.get_colors()

        -- ステータスバーのスタイル
        local elements = {
            -- 左パディング
            {Background = {Color = C.base}},
            {Text = " "},

            -- 天気情報
            {Background = {Color = C.base}},
            {Foreground = {Color = C.blue}},
            {Attribute = {Intensity = "Bold"}},
            {Text = weather_info .. separator},

            -- 地震情報
            {Background = {Color = C.base}},
            {Foreground = {Color = C.red}},
            {Attribute = {Intensity = "Bold"}},
            {Text = earthquake_info .. separator},

            -- バッテリー情報
            {Background = {Color = C.base}},
            {Foreground = {Color = C.green}},
            {Text = battery .. separator},

            -- 時刻
            {Background = {Color = C.base}},
            {Foreground = {Color = C.mauve}},
            {Attribute = {Intensity = "Bold"}},
            {Text = time},

            -- 右パディング
            {Background = {Color = C.base}},
            {Text = " "},
        }

        -- ステータスバーを更新
        window:set_right_status(wezterm.format(elements))
    end)

    -- タブバーのスタイル設定
    config.use_fancy_tab_bar = false
    config.tab_bar_at_bottom = true
    config.hide_tab_bar_if_only_one_tab = false

    -- タブバーの背景色を設定（ステータスバーと同じ）
    local C = colors.get_colors()
    config.colors = config.colors or {}
    config.colors.tab_bar = {
        background = C.base,
        active_tab = {
            bg_color = C.surface0,
            fg_color = C.text,
        },
        inactive_tab = {
            bg_color = C.base,
            fg_color = C.overlay0,
        },
        inactive_tab_hover = {
            bg_color = C.surface0,
            fg_color = C.text,
        },
        new_tab = {
            bg_color = C.base,
            fg_color = C.overlay0,
        },
        new_tab_hover = {
            bg_color = C.surface0,
            fg_color = C.text,
        },
    }
end

return M 