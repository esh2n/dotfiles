-- Add the sketchybar module to the package cpath
package.cpath = package.cpath .. ";/Users/" .. os.getenv("USER") .. "/.local/share/sketchybar_lua/?.so"

-- Use absolute path to avoid issues when launched from launchd
local config_dir = os.getenv("HOME") .. "/.config/sketchybar"
os.execute("(cd " .. config_dir .. "/helpers && make)")
