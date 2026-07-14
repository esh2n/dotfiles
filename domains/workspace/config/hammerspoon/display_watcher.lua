-- Restart sketchybar and borders when the display configuration changes
-- (monitor hotplug, resolution change, network display reconnect).
-- Both have known issues recalculating frames on reconfiguration: sketchybar
-- keeps a stale bar width, JankyBorders leaves stale border frames.
-- Same recovery strategy as sketchybar's items/wake.lua: launchctl kickstart.

local M = {}

-- Screen reconfiguration fires several times in a burst; restart once after
-- the layout settles.
local DEBOUNCE_SECONDS = 3

local JOBS = {
  "homebrew.mxcl.sketchybar",
  "homebrew.mxcl.borders",
}

local debounceTimer = nil

local function kickstartServices()
  local uid, ok = hs.execute("/usr/bin/id -u")
  if not ok then return end
  uid = uid:gsub("%s+", "")
  for _, job in ipairs(JOBS) do
    hs.execute(string.format("/bin/launchctl kickstart -k gui/%s/%s", uid, job))
  end
end

M.watcher = hs.screen.watcher.new(function()
  if debounceTimer then debounceTimer:stop() end
  debounceTimer = hs.timer.doAfter(DEBOUNCE_SECONDS, kickstartServices)
end)
M.watcher:start()

return M
