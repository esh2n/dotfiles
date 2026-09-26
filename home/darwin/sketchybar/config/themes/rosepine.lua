return {
  black = 0xff191724,
  white = 0xffe0def4,
  red = 0xffeb6f92,
  green = 0xff31748f,
  blue = 0xff31748f,
  yellow = 0xfff6c177,
  orange = 0xfff6c177,
  magenta = 0xffc4a7e7,
  grey = 0xff524f67,
  transparent = 0x00000000,

  bar = {
    bg = 0xf01f1d2e,
    border = 0xff26233a,
  },
  popup = {
    bg = 0xc01f1d2e,
    border = 0xff524f67
  },
  bg1 = 0xff26233a,
  bg2 = 0xff403d52,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}

