-- Hammerspoon Configuration
-- 動作検証

-- リロード
hs.hotkey.bind({"cmd", "alt", "ctrl"}, "r", function()
  hs.reload()
end)

-- Load dropdown system
dofile(hs.configdir .. "/dropdown.lua")

hs.alert.show("Hammerspoon ready")