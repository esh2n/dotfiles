local colors = require("colors")

-- Floating pill-style bar (Figma-like)
sbar.bar({
  height = 36,
  color = colors.bar.bg,
  padding_right = 8,
  padding_left = 8,
  margin = 12,
  y_offset = 8,
  corner_radius = 12,
  border_color = colors.blue,
  border_width = 2,
  blur_radius = 20,
  sticky = true,
})
