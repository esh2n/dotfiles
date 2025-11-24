local icons = require("icons")
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
  updates = true,
})

-- Update function
local function update_spotify()
  sbar.exec("osascript -e 'tell application \"System Events\" to (name of processes) contains \"Spotify\"'", function(result)
    if result == "true" then
      sbar.exec("osascript -e 'tell application \"Spotify\" to get player state'", function(state)
        if state and state:match("playing") then
          sbar.exec("osascript -e 'tell application \"Spotify\" to get (name of current track) & \" - \" & (artist of current track)'", function(track_info)
            if track_info and track_info ~= "" then
              spotify:set({
                icon = { color = colors.green },
                label = { string = track_info:gsub("\n", ""):sub(1, 25) },
                drawing = true
              })
            end
          end)
        elseif state and state:match("paused") then
          sbar.exec("osascript -e 'tell application \"Spotify\" to get (name of current track) & \" - \" & (artist of current track)'", function(track_info)
            if track_info and track_info ~= "" then
              spotify:set({
                icon = { color = colors.grey },
                label = { string = track_info:gsub("\n", ""):sub(1, 25) .. " (paused)" },
                drawing = true
              })
            end
          end)
        else
          spotify:set({ drawing = false })
        end
      end)
    else
      spotify:set({ drawing = false })
    end
  end)
end

-- Click handler for play/pause
spotify:subscribe("mouse.clicked", function(env)
  sbar.exec("osascript -e 'tell application \"Spotify\" to playpause'")
  sbar.delay(1, update_spotify)
end)

-- Initial update and set timer
update_spotify()
sbar.add("event", "spotify_update")
sbar.trigger("spotify_update")

-- Update every 2 seconds
spotify:subscribe("spotify_update", function(env)
  update_spotify()
  sbar.delay(2, function() sbar.trigger("spotify_update") end)
end)