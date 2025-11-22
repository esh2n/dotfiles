local wezterm = require('wezterm')

local M = {}

local function get_lan_ip()
    local handle
    if wezterm.target_triple == "x86_64-apple-darwin" or wezterm.target_triple == "aarch64-apple-darwin" then
        handle = io.popen("ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1")
    else
        handle = io.popen("ip addr show | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -n 1")
    end
    
    if handle then
        local result = handle:read("*a")
        handle:close()
        result = result:gsub("%s+", "")
        return result ~= "" and result or "N/A"
    end
    return "N/A"
end

function M.get_network_info()
    local lan_ip = get_lan_ip()
    return string.format("ⓛ %s", lan_ip)
end

return M 