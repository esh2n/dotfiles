local settings = require("settings")
local colors = require("colors")

local cal = sbar.add("item", "widgets.calendar", {
  position = "right",
  icon = {
    color = colors.white,
    font = { family = settings.font.numbers },
  },
  label = {
    color = colors.white,
    font = { family = settings.font.numbers },
  },
  update_freq = 30,
})

cal:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal:set({ icon = os.date("%a. %d %b."), label = os.date("%H:%M") })
end)

cal:subscribe("mouse.clicked", function()
  sbar.exec("open -a 'Calendar'")
end)

sbar.add("bracket", "widgets.calendar.bracket", { cal.name }, {
  background = { color = colors.bg1 }
})

sbar.add("item", "widgets.calendar.padding", {
  position = "right",
  width = settings.group_paddings
})
