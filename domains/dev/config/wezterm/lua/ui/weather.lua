local wezterm = require('wezterm')
local os_utils = require('lua.utils.os') -- OSユーティリティをインポート

local M = {}

-- OpenWeatherMap APIキー
local function get_api_key()
    -- 1. まず環境変数から取得を試みる
    local key = os.getenv('OPENWEATHER_API_KEY')
    if key and key ~= '' then
        return key
    end
    
    -- 2. 環境変数がない場合は、さまざまな場所の.envファイルを探す
    local function find_env_file()
        -- 候補パスのリスト
        local paths = {}

        -- 設定ディレクトリからリポジトリルートを見つける試み
        if wezterm.config_dir then
            local config_dir = wezterm.config_dir:gsub([[\]], '/')
            local repo_root = config_dir:match('(.+)/config/wezterm')
            
            -- 設定ディレクトリから見つかったパスを追加
            if repo_root then
                table.insert(paths, repo_root .. '/.env')
            end

            -- 直接設定ディレクトリの親の親を試す
            table.insert(paths, config_dir .. '/../../.env')
        end
        
        -- ホームディレクトリを使用する場合のパス
        local home = os_utils.get_home_dir() -- OSに応じたホームディレクトリを取得
        if home then
            -- DOTFILES_ROOT環境変数を優先
            local dotfiles_root = os.getenv('DOTFILES_ROOT')
            if dotfiles_root then
                table.insert(paths, dotfiles_root .. '/.env')
            end
            -- 標準的なdotfilesの場所
            table.insert(paths, home .. '/dotfiles/.env')
        end
        
        -- 確実に検出できなかった場合に備えて、Weztermの設定ディレクトリを基準にしたパスも追加
        local wezterm_config = wezterm.config_dir
        if wezterm_config then
            -- パス区切り文字の標準化
            wezterm_config = wezterm_config:gsub([[\]], '/')
            -- 相対的な場所の推測
            table.insert(paths, wezterm_config .. '/../../.env')
            table.insert(paths, wezterm_config .. '/../../../.env')
        end
        
        -- 存在するパスを返す
        for _, path in ipairs(paths) do
            local f = io.open(path, 'r')
            if f then
                f:close()
                return path
            end
        end
        
        return nil
    end
    
    -- 環境変数ファイルを見つける
    local env_file = find_env_file()
    if not env_file then
        -- ファイルが見つからない場合はAPIキーなしで続行
        return nil
    end
    local f = io.open(env_file, 'r')
    if f then
        for line in f:lines() do
            local api_key = line:match('^OPENWEATHER_API_KEY=(.+)$')
            if api_key then
                f:close()
                -- 値から引用符を削除
                return api_key:gsub('^["\'](.+)["\']$', '%1')
            end
        end
        f:close()
    end
    return nil
end

local WEATHER_API_KEY = get_api_key()
-- 地点情報 (東京)
local CITY_ID = '1850147'

-- 気圧の状態を判定
local function get_pressure_state(pressure)
    if pressure <= 980 then
        return "爆弾低気圧", "⚠️"
    elseif pressure <= 1010 then
        return "低気圧", "⇣"
    elseif pressure <= 1020 then
        return "標準気圧", "−"
    elseif pressure <= 1030 then
        return "高気圧", "⇡"
    else
        return "強い高気圧", "⇈"
    end
end

local function format_time(timestamp)
    return os.date("%H:%M", timestamp)
end

local function get_humidity_state(humidity)
    if humidity <= 30 then
        return "乾燥", "⚠️"
    elseif humidity <= 40 then
        return "やや乾燥", "!"
    elseif humidity <= 60 then
        return "快適", "✓"
    elseif humidity <= 80 then
        return "やや湿潤", "~"
    else
        return "湿潤", "⚠️"
    end
end

local function fetch_weather()
    if not WEATHER_API_KEY then
        return '⚠️ API KEY未設定', nil, nil, nil
    end

    -- 現在の天気を取得
    local current_url = string.format(
        'http://api.openweathermap.org/data/2.5/weather?id=%s&appid=%s&units=metric',
        CITY_ID,
        WEATHER_API_KEY
    )

    -- 予報を取得（降水確率用）
    local forecast_url = string.format(
        'http://api.openweathermap.org/data/2.5/forecast?id=%s&appid=%s&units=metric',
        CITY_ID,
        WEATHER_API_KEY
    )

    local success, stdout, stderr = wezterm.run_child_process({
        'curl',
        '-s',
        current_url
    })

    if success then
        local ok, weather_data = pcall(wezterm.json_parse, stdout)
        if ok then
            local temp = weather_data.main.temp
            local feels_like = weather_data.main.feels_like
            local pressure = weather_data.main.pressure
            local humidity = weather_data.main.humidity
            local weather = weather_data.weather[1].main
            local sunrise = weather_data.sys.sunrise
            local sunset = weather_data.sys.sunset

            -- 降水確率を取得
            local pop = 0
            local forecast_success, forecast_stdout = wezterm.run_child_process({
                'curl',
                '-s',
                forecast_url
            })
            if forecast_success then
                local forecast_ok, forecast_data = pcall(wezterm.json_parse, forecast_stdout)
                if forecast_ok and forecast_data.list and #forecast_data.list > 0 then
                    pop = forecast_data.list[1].pop * 100
                end
            end

            local icons = {
                Clear = '☼',
                Clouds = '☁',
                Rain = '☂',
                Snow = '❄',
                Thunderstorm = '⚡',
                Drizzle = '☔',
                Mist = '≡'
            }

            local pressure_state, pressure_icon = get_pressure_state(pressure)
            local humidity_state, humidity_icon = get_humidity_state(humidity)

            -- 基本天気情報
            local weather_info = string.format('%s %.1f°C (体感%.1f°C)', 
                icons[weather] or '○', 
                temp,
                feels_like
            )

            -- 気圧情報
            local pressure_info = string.format('%s %dhPa %s',
                pressure_icon,
                pressure,
                pressure_state
            )

            -- 湿度と降水確率
            local condition_info = string.format('💧%d%% %s ☔%d%%',
                humidity,
                humidity_icon,
                pop
            )

            -- 日の出入り
            local sun_info = string.format('☀%s 🌙%s',
                format_time(sunrise),
                format_time(sunset)
            )

            return weather_info, pressure_info, condition_info, sun_info
        end
    end
    return '🌡️ N/A', nil, nil, nil
end

function M.get_weather()
    local success, weather, pressure, condition, sun = pcall(function()
        return fetch_weather()
    end)
    if success then
        return weather, pressure, condition, sun
    end
    return '🌡️ Error', nil, nil, nil
end

return M 
