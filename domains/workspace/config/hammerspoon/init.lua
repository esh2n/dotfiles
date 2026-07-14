-- Hammerspoon Configuration
-- 動作検証

-- リロード
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "r", function()
  hs.reload()
end)

-- Load dropdown system
-- dofile(hs.configdir .. "/dropdown.lua")

-- GatherV2: hold Z to dance, auto-spam F for confetti.
-- IMPORTANT: capture the return value as a global so the module's eventtap /
-- hotkey / watcher userdata are not garbage-collected. See z_to_f_spammer.lua.
ZSpammer = dofile(hs.configdir .. "/z_to_f_spammer.lua")

-- Restart sketchybar/borders after display reconfiguration (stale bar width /
-- stale border frames). Global for the same GC reason as above.
DisplayWatcher = dofile(hs.configdir .. "/display_watcher.lua")

hs.alert.show("Hammerspoon ready")