return {
  black = 0xff1f1f28,
  white = 0xffdcd7ba,
  red = 0xffc34043,
  green = 0xff76946a,
  blue = 0xff7e9cd8,
  yellow = 0xffc0a36e,
  orange = 0xffffa066,
  magenta = 0xff957fb8,
  grey = 0xff54546d,
  transparent = 0x00000000,

  bar = {
    bg = 0xf016161d,
    border = 0xff2a2a37,
  },
  popup = {
    bg = 0xc016161d,
    border = 0xff54546d
  },
  bg1 = 0xff2a2a37,
  bg2 = 0xff363646,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}

