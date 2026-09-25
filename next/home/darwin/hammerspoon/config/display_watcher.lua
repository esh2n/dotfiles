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
  sketchybar = "homebrew.mxcl.sketchybar",
  borders = "homebrew.mxcl.borders",
}

-- mado (bin/mado) records which services the active WM profile keeps running.
-- Only kickstart those, so a profile that stopped sketchybar/borders (e.g.
-- omniwm) doesn't get them resurrected on display changes.
local SERVICES_STATE = os.getenv("HOME") .. "/.local/state/mado/services"

local function activeJobs()
  local f = io.open(SERVICES_STATE, "r")
  if not f then
    -- No mado state yet: pre-mado behavior, restart both
    local all = {}
    for _, job in pairs(JOBS) do all[#all + 1] = job end
    return all
  end
  local jobs = {}
  for line in f:lines() do
    local job = JOBS[line:gsub("%s+", "")]
    if job then jobs[#jobs + 1] = job end
  end
  f:close()
  return jobs
end

local debounceTimer = nil

local function kickstartServices()
  local uid, ok = hs.execute("/usr/bin/id -u")
  if not ok then return end
  uid = uid:gsub("%s+", "")
  for _, job in ipairs(activeJobs()) do
    hs.execute(string.format("/bin/launchctl kickstart -k gui/%s/%s", uid, job))
  end
end

M.watcher = hs.screen.watcher.new(function()
  if debounceTimer then debounceTimer:stop() end
  debounceTimer = hs.timer.doAfter(DEBOUNCE_SECONDS, kickstartServices)
end)
M.watcher:start()

return M
