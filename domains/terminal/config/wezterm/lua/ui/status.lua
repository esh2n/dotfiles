local wezterm = require('wezterm')
local weather = require('lua.ui.weather')
local earthquake = require('lua.ui.earthquake')
local network = require('lua.ui.network')
local colors = require('lua.ui.colors')
local spotify = require('lua.ui.spotify')
local calendar = require('lua.ui.calendar')

local M = {}

-- カラーパレット（Catppuccinテーマ）
local COLORS = {
    blue = "#89b4fa",    -- 天気
    red = "#f38ba8",     -- 地震
    green = "#a6e3a1",   -- バッテリー
    mauve = "#cba6f7",   -- 時刻
    yellow = "#f9e2af",  -- ネットワーク
    peach = "#fab387",   -- 気圧
    lavender = "#b4befe", -- Spotify
    teal = "#94e2d5",    -- カレンダー
    surface0 = "#313244",
    base = "#1e1e2e",
}

-- ウィンドウ幅に基づいて表示する要素を決定
local function get_elements_by_width(window, weather_info, pressure_info, condition_info, sun_info, earthquake_info, network_info, battery, time, spotify_info, calendar_info)
    local width = window:get_dimensions().pixel_width
    local separator = "   "
    local C = colors.get_colors()
    local elements = {}
    
    -- タブの数を取得
    local tabs = window:mux_window():tabs()
    local tab_count = #tabs

    -- 左パディング
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Text = "     "})  -- 約1.25cellに相当する空白

    -- 左側のコンテンツ
    local left_elements = {}

    -- タブが3つ以上ある場合は最小限の情報のみ表示
    if tab_count >= 3 then
        -- 最小表示（時刻とバッテリーのみ）
        table.insert(left_elements, {Background = {Color = C.base}})
        table.insert(left_elements, {Foreground = {Color = C.green}})
        table.insert(left_elements, {Text = battery .. separator})
    else
        if width > 1500 then
            -- カレンダー情報（もし次の予定があれば）
            if calendar_info then
                table.insert(left_elements, {Background = {Color = C.base}})
                table.insert(left_elements, {Foreground = {Color = COLORS.teal}})
                table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
                table.insert(left_elements, {Text = calendar_info .. separator})
            end

            -- Spotify情報（もし再生中なら）
            if spotify_info then
                table.insert(left_elements, {Background = {Color = C.base}})
                table.insert(left_elements, {Foreground = {Color = COLORS.lavender}})
                table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
                table.insert(left_elements, {Text = spotify_info .. separator})
            end

            -- フル表示（全ての情報）
            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.blue}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = weather_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.peach}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = pressure_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.mauve}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = condition_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.yellow}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = sun_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.red}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = earthquake_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.yellow}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = network_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.green}})
            table.insert(left_elements, {Text = battery .. separator})
        elseif width > 1200 then
            -- 中程度の表示（天気、気圧、コンディション、バッテリー）
            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.blue}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = weather_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.peach}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = pressure_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.mauve}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = condition_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.green}})
            table.insert(left_elements, {Text = battery .. separator})
        elseif width > 800 then
            -- 最小表示（天気、気圧、バッテリー）
            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.blue}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = weather_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.peach}})
            table.insert(left_elements, {Attribute = {Intensity = "Bold"}})
            table.insert(left_elements, {Text = pressure_info .. separator})

            table.insert(left_elements, {Background = {Color = C.base}})
            table.insert(left_elements, {Foreground = {Color = C.green}})
            table.insert(left_elements, {Text = battery .. separator})
        end
    end

    -- 左側の要素を追加
    for _, element in ipairs(left_elements) do
        table.insert(elements, element)
    end

    -- 時刻（常に表示）
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Foreground = {Color = C.mauve}})
    table.insert(elements, {Attribute = {Intensity = "Bold"}})
    table.insert(elements, {Text = time})

    -- 右パディング
    table.insert(elements, {Background = {Color = C.base}})
    table.insert(elements, {Text = "     "})  -- 約1.25cellに相当する空白

    return elements
end

function M.apply_to_config(config)
    -- ステータスバーの更新間隔（秒）
    config.status_update_interval = 1000

    wezterm.on("update-status", function(window, pane)
        -- 現在時刻
        local time = wezterm.strftime("%H:%M")
        
        -- バッテリー情報
        local battery = '● N/A'  -- デフォルト値
        local battery_info = wezterm.battery_info()
        if battery_info and #battery_info > 0 then
            local b = battery_info[1]  -- 最初のバッテリー情報を使用
            local battery_icon = '●'  -- シンプルな丸アイコン
            if b.state == 'Charging' then
                battery_icon = '↑'  -- 充電中
            elseif b.state == 'Empty' then
                battery_icon = '○'  -- 要充電
            end
            battery = string.format('%s %d%%', battery_icon, math.floor(b.state_of_charge * 100))
        end

        -- 天気情報と気圧情報
        local weather_info, pressure_info, condition_info, sun_info
        
        -- 天気モジュールを安全に読み込む
        weather_info, pressure_info, condition_info, sun_info = '🌡️ モジュール初期化中', nil, nil, nil
        
        local success_check, is_available = pcall(function()
            return weather ~= nil and type(weather.get_weather) == 'function'
        end)
        
        if success_check and is_available then
            local success_weather = pcall(function()
                weather_info, pressure_info, condition_info, sun_info = weather.get_weather()
            end)
            if not success_weather then
                weather_info = '🌡️ 無効'
                pressure_info = nil
                condition_info = nil
                sun_info = nil
            end
        else
            weather_info = '🌡️ モジュール未対応'
            pressure_info = nil
            condition_info = nil
            sun_info = nil
        end
        
        -- 地震情報
        local earthquake_info
        local success_earthquake = pcall(function()
            earthquake_info = earthquake.get_earthquake()
        end)
        if not success_earthquake then
            earthquake_info = '◈ Error'
        end

        -- ネットワーク情報
        local network_info
        local success_network = pcall(function()
            network_info = network.get_network_info()
        end)
        if not success_network then
            network_info = 'ⓛ Error'
        end

        -- Spotify情報
        local spotify_info
        local success_spotify = pcall(function()
            spotify_info = spotify.get_spotify()
        end)
        if not success_spotify then
            spotify_info = nil
        end

        -- カレンダー情報
        local calendar_info
        local success_calendar = pcall(function()
            calendar_info = calendar.get_next_event()
        end)
        if not success_calendar then
            calendar_info = nil
        end

        -- ウィンドウ幅に基づいて要素を取得
        local elements = get_elements_by_width(
            window,
            weather_info,
            pressure_info or "気圧N/A",
            condition_info or "湿度N/A",
            sun_info or "日の出N/A",
            earthquake_info,
            network_info,
            battery,
            time,
            spotify_info,
            calendar_info
        )

        -- ステータスバーを更新
        window:set_right_status(wezterm.format(elements))
    end)

    -- タブバーのスタイル設定
    config.use_fancy_tab_bar = false
    config.tab_bar_at_bottom = false
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