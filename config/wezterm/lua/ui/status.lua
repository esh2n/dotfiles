local wezterm = require('wezterm')
local weather = require('lua.ui.weather')
local earthquake = require('lua.ui.earthquake')
local network = require('lua.ui.network')
local colors = require('lua.ui.colors')

local M = {}

-- カラーパレット（Catppuccinテーマ）
local COLORS = {
    blue = "#89b4fa",    -- 天気
    red = "#f38ba8",     -- 地震
    green = "#a6e3a1",   -- バッテリー
    mauve = "#cba6f7",   -- 時刻
    yellow = "#f9e2af",  -- ネットワーク
    peach = "#fab387",   -- 気圧
    surface0 = "#313244",
    base = "#1e1e2e",
}

-- ウィンドウ幅に基づいて表示する要素を決定
local function get_elements_by_width(window, weather_info, pressure_info, earthquake_info, network_info, battery, time)
    local width = window:get_dimensions().pixel_width
    local separator = "   "
    local C = colors.get_colors()
    local elements = {}

    -- 左パディング
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Text = " "})

    if width > 1200 then
        -- フル表示
        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.blue}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = weather_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.peach}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = pressure_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.red}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = earthquake_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.yellow}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = network_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.green}})
        table.insert(elements, {Text = battery .. separator})
    elseif width > 800 then
        -- 中程度の表示（天気、気圧、バッテリー、時計）
        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.blue}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = weather_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.peach}})
        table.insert(elements, {Attribute = {Intensity = "Bold"}})
        table.insert(elements, {Text = pressure_info .. separator})

        table.insert(elements, {Background = {Color = C.base}})
        table.insert(elements, {Foreground = {Color = C.green}})
        table.insert(elements, {Text = battery .. separator})
    end

    -- 時刻（常に表示）
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Foreground = {Color = C.mauve}})
    table.insert(elements, {Attribute = {Intensity = "Bold"}})
    table.insert(elements, {Text = time})

    -- 右パディング
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Text = " "})

    return elements
end

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

        -- 天気情報と気圧情報
        local weather_info, pressure_info = weather.get_weather()
        
        -- 地震情報
        local earthquake_info = earthquake.get_earthquake()

        -- ネットワーク情報
        local network_info = network.get_network_info()

        -- ウィンドウ幅に基づいて要素を取得
        local elements = get_elements_by_width(window, weather_info, pressure_info or "気圧N/A", earthquake_info, network_info, battery, time)

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