local colors = require("colors")
local settings = require("settings")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/sketchybar"

local earthquake = sbar.add("item", "widgets.earthquake", {
  position = "right",
  icon = {
    string = "◈",
    font = {
      style = settings.font.style_map["Regular"],
      size = 19.0,
    },
    color = colors.red,
  },
  label = {
    font = { family = settings.font.numbers },
    string = "--",
  },
  update_freq = 300,
})

earthquake:subscribe({"routine", "forced", "system_woke"}, function()
  sbar.exec(config_dir .. "/plugins/earthquake.sh widgets.earthquake")
end)

earthquake:subscribe("mouse.clicked", function()
  sbar.exec(config_dir .. "/plugins/earthquake.sh widgets.earthquake")
end)

sbar.add("bracket", "widgets.earthquake.bracket", { earthquake.name }, {
  background = { color = colors.bg1 }
})

sbar.add("item", "widgets.earthquake.padding", {
  position = "right",
  width = settings.group_paddings
})
