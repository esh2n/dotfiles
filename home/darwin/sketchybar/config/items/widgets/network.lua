local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/sketchybar"

local network_ip = sbar.add("item", "widgets.network_ip", {
  position = "right",
  icon = {
    string = "󰩟",
    font = {
      style = settings.font.style_map["Regular"],
      size = 19.0,
    },
    color = colors.blue,
  },
  label = {
    font = { family = settings.font.numbers },
    string = "...",
  },
  update_freq = 120,
})

network_ip:subscribe({"routine", "forced", "system_woke"}, function()
  sbar.exec(config_dir .. "/plugins/network.sh widgets.network_ip")
end)

network_ip:subscribe("mouse.clicked", function()
  sbar.exec("ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 | pbcopy")
  network_ip:set({ label = { string = icons.clipboard } })
  sbar.delay(1, function()
    sbar.exec(config_dir .. "/plugins/network.sh widgets.network_ip")
  end)
end)

sbar.add("bracket", "widgets.network_ip.bracket", { network_ip.name }, {
  background = { color = colors.bg1 }
})

sbar.add("item", "widgets.network_ip.padding", {
  position = "right",
  width = settings.group_paddings
})
