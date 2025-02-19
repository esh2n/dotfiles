local wezterm = require('wezterm')

local M = {}

-- OpenWeatherMap APIキー
local function get_api_key()
    -- 1. まず環境変数から取得を試みる
    local key = os.getenv('OPENWEATHER_API_KEY')
    if key and key ~= '' then
        return key
    end
    
    -- 2. 環境変数が設定されていない場合は.envファイルから直接読み込む
    local home = os.getenv('HOME')
    local env_file = home .. '/go/github.com/esh2n/dotfiles/.env'
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

local function fetch_weather()
    if not WEATHER_API_KEY then
        return '⚠️ API KEY未設定'
    end

    local url = string.format(
        'http://api.openweathermap.org/data/2.5/weather?id=%s&appid=%s&units=metric',
        CITY_ID,
        WEATHER_API_KEY
    )

    local success, stdout, stderr = wezterm.run_child_process({
        'curl',
        '-s',
        url
    })

    if success then
        local ok, weather_data = pcall(wezterm.json_parse, stdout)
        if ok then
            local temp = weather_data.main.temp
            local weather = weather_data.weather[1].main
            local icons = {
                Clear = '☼',
                Clouds = '☁',
                Rain = '☂',
                Snow = '❄',
                Thunderstorm = '⚡',
                Drizzle = '☔',
                Mist = '≡'
            }
            return string.format('%s %.1f°C', icons[weather] or '○', temp)
        end
    end
    return '🌡️ N/A'
end

function M.get_weather()
    local success, weather = pcall(fetch_weather)
    if success then
        return weather
    end
    return '🌡️ Error'
end

return M 