local wezterm = require('wezterm')

local M = {}

-- P2P地震情報のAPIエンドポイント
local EQ_API_URL = 'https://api.p2pquake.net/v2/history?codes=551&limit=1'

local function fetch_earthquake()
    local success, stdout, stderr = wezterm.run_child_process({
        'curl',
        '-s',
        EQ_API_URL
    })

    if success then
        local ok, eq_data = pcall(wezterm.json_parse, stdout)
        if ok and #eq_data > 0 then
            local latest = eq_data[1]
            local scale = latest.earthquake.maxScale
            local location = latest.earthquake.hypocenter.name
            local magnitude = latest.earthquake.hypocenter.magnitude
            
            -- 震度を日本語表記に変換
            local scale_str = ''
            if scale == -1 then
                scale_str = '不明'
            elseif scale == 10 then
                scale_str = '1'
            elseif scale == 20 then
                scale_str = '2'
            elseif scale == 30 then
                scale_str = '3'
            elseif scale == 40 then
                scale_str = '4'
            elseif scale == 45 then
                scale_str = '5弱'
            elseif scale == 50 then
                scale_str = '5強'
            elseif scale == 55 then
                scale_str = '6弱'
            elseif scale == 60 then
                scale_str = '6強'
            elseif scale == 70 then
                scale_str = '7'
            end

            return string.format('◈ 震度%s M%.1f %s', scale_str, magnitude, location)
        end
    end
    return '◈ データなし'
end

function M.get_earthquake()
    local success, eq_info = pcall(fetch_earthquake)
    if success then
        return eq_info
    end
    return '◈ Error'
end

return M 