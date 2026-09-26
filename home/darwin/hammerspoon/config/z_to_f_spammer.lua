-- GatherV2: Hold Z to dance, auto-spam F to throw confetti.
--
-- Loaded from init.lua via:
--   ZSpammer = dofile(hs.configdir .. "/z_to_f_spammer.lua")
-- The return value MUST be captured by a global (not `local`) so that the
-- module table — and the eventtap/watcher userdata it holds — survives GC.
-- (See Hammerspoon FAQ: "Why does my callback stop firing?")

local M = {}

local TARGET_APP = "GatherV2"
local INTERVAL   = 0.5      -- seconds between F presses (2Hz)
local Z_KEYCODE  = 6        -- macOS keyCode for "z"
local DEBUG      = true

local function dlog(...)
  if DEBUG then print("[z2f]", ...) end
end

M.enabled = false
M.zHeld   = false
M.fTimer  = nil

local function stopSpam()
  if M.fTimer then
    M.fTimer:stop()
    M.fTimer = nil
    dlog("timer stopped")
  end
  M.zHeld = false
end

local function startSpam()
  if M.fTimer then return end
  dlog("timer starting (interval=" .. INTERVAL .. "s)")
  M.fTimer = hs.timer.doEvery(INTERVAL, function()
    hs.eventtap.keyStroke({}, "f", 0)
    dlog("F sent")
  end)
end

local function isTargetFrontmost()
  local app = hs.application.frontmostApplication()
  return app and app:name() == TARGET_APP
end

-- The eventtap callback. Returning false propagates the original key event to
-- the focused app (so Z still triggers the in-game dance).
local function onKey(event)
  -- Unconditional log: confirms the tap is alive and Z events are reaching us.
  local kc = event:getKeyCode()
  if kc == Z_KEYCODE then
    dlog("tap saw Z, enabled=" .. tostring(M.enabled) ..
         ", frontmost=" .. (hs.application.frontmostApplication() and hs.application.frontmostApplication():name() or "?"))
  end

  if not M.enabled then return false end
  if kc ~= Z_KEYCODE then return false end
  if not isTargetFrontmost() then return false end

  local eventType = event:getType()
  if eventType == hs.eventtap.event.types.keyDown then
    dlog("Z keyDown")
    if not M.zHeld then
      M.zHeld = true
      startSpam()
    end
  elseif eventType == hs.eventtap.event.types.keyUp then
    dlog("Z keyUp")
    stopSpam()
  end

  return false
end

M.tap = hs.eventtap.new(
  { hs.eventtap.event.types.keyDown, hs.eventtap.event.types.keyUp },
  onKey
)
M.tap:start()
dlog("module loaded; tap started; isRunning=" .. tostring(M.tap:isEnabled()))

local function enable()
  if M.enabled then return end
  M.enabled = true
  dlog("enabled; Z_KEYCODE=" .. tostring(Z_KEYCODE) .. ", tap isEnabled=" .. tostring(M.tap:isEnabled()))
  hs.alert.show("🎉 Confetti spam: ON")
end

local function disable(reason)
  if not M.enabled then return end
  M.enabled = false
  stopSpam()
  dlog("disabled (reason=" .. tostring(reason) .. ")")
  if reason == "focus" then
    hs.alert.show("Confetti spam: OFF (lost focus)")
  else
    hs.alert.show("Confetti spam: OFF")
  end
end

local function toggle()
  if M.enabled then disable("manual") else enable() end
end

M.hotkey = hs.hotkey.bind({ "cmd", "alt" }, "g", toggle)

M.watcher = hs.application.watcher.new(function(appName, eventType, _)
  if appName == TARGET_APP and eventType == hs.application.watcher.deactivated then
    disable("focus")
  end
end)
M.watcher:start()

-- Expose enable/disable for manual debugging from the Console.
M.enable  = enable
M.disable = disable
M.toggle  = toggle

return M
