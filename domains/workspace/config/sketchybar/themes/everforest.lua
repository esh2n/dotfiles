return {
  black = 0xff2e383c,
  white = 0xffd3c6aa,
  red = 0xffe67e80,
  green = 0xffa7c080,
  blue = 0xff7fbbb3,
  yellow = 0xffdbbc7f,
  orange = 0xffe69875,
  magenta = 0xffd699b6,
  grey = 0xff859289,
  transparent = 0x00000000,

  bar = {
    bg = 0xf0272e33,
    border = 0xff3d484d,
  },
  popup = {
    bg = 0xc0272e33,
    border = 0xff859289
  },
  bg1 = 0xff3d484d,
  bg2 = 0xff4f5b58,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}

