local colors = require("colors")

-- Spotify widget
local spotify = sbar.add("item", {
  position = "right",
  icon = {
    string = "󰓇",
    color = colors.green,
    font = {
      family = "SF Pro",
      style = "Regular",
      size = 14.0
    }
  },
  label = {
    string = "Spotify",
    color = colors.white,
    font = {
      family = "SF Pro",
      style = "Medium",
      size = 12.0
    },
    max_chars = 25,
    padding_left = 8,
  },
  background = {
    color = colors.bg2,
    corner_radius = 6,
    height = 28,
  },
  padding_left = 8,
  padding_right = 8,
  drawing = false,
  updates = true,
})

-- Event-driven update via MediaRemote (same push-based source as media.lua).
-- No polling: avoids the sbar.delay recursion + nested osascript calls that
-- leaked memory in the previous implementation.
spotify:subscribe("media_change", function(env)
  if env.INFO.app ~= "Spotify" then
    spotify:set({ drawing = false })
    return
  end

  local playing = env.INFO.state == "playing"
  local paused = env.INFO.state == "paused"
  if not (playing or paused) then
    spotify:set({ drawing = false })
    return
  end

  local title = env.INFO.title or ""
  local artist = env.INFO.artist or ""
  local track = title
  if artist ~= "" then
    track = title .. " - " .. artist
  end
  if paused then
    track = track .. " (paused)"
  end

  spotify:set({
    icon = { color = playing and colors.green or colors.grey },
    label = { string = track },
    drawing = true,
  })
end)

-- Click toggles play/pause; media_change fires on the resulting state change,
-- so no manual refresh/delay is needed.
spotify:subscribe("mouse.clicked", function(env)
  sbar.exec("osascript -e 'tell application \"Spotify\" to playpause'")
end)
