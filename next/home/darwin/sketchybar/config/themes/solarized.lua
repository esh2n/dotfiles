return {
  black = 0xff002b36,
  white = 0xff839496,
  red = 0xffdc322f,
  green = 0xff859900,
  blue = 0xff268bd2,
  yellow = 0xffb58900,
  orange = 0xffcb4b16,
  magenta = 0xffd33682,
  grey = 0xff586e75,
  transparent = 0x00000000,

  bar = {
    bg = 0xf0001e26,
    border = 0xff073642,
  },
  popup = {
    bg = 0xc0001e26,
    border = 0xff586e75
  },
  bg1 = 0xff073642,
  bg2 = 0xff002b36,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}

