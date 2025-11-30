local colors = require("colors")
local settings = require("settings")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/sketchybar"

local weather = sbar.add("item", "widgets.weather", {
  position = "right",
  icon = {
    string = "☀",
    font = {
      style = settings.font.style_map["Regular"],
      size = 19.0,
    },
    color = colors.yellow,
  },
  label = {
    font = { family = settings.font.numbers },
    string = "...",
  },
  update_freq = 600,
})

weather:subscribe({"routine", "forced", "system_woke"}, function()
  sbar.exec(config_dir .. "/plugins/weather.sh widgets.weather")
end)

weather:subscribe("mouse.clicked", function()
  sbar.exec(config_dir .. "/plugins/weather.sh widgets.weather")
end)

sbar.add("bracket", "widgets.weather.bracket", { weather.name }, {
  background = { color = colors.bg1 }
})

sbar.add("item", "widgets.weather.padding", {
  position = "right",
  width = settings.group_paddings
})
