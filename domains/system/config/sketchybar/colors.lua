return {
  black = 0xff1a1b26,
  white = 0xffa9b1d6,
  red = 0xfff7768e,
  green = 0xff9ece6a,
  blue = 0xff7aa2f7,
  yellow = 0xffe0af68,
  orange = 0xffff9e64,
  magenta = 0xffbb9af7,
  grey = 0xff565f89,
  transparent = 0x00000000,

  bar = {
    bg = 0xf01a1b26,
    border = 0xff1a1b26,
  },
  popup = {
    bg = 0xc01a1b26,
    border = 0xff565f89
  },
  bg1 = 0xff24283b,
  bg2 = 0xff414868,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}
