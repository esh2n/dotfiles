return {
  black = 0xff2e3440,
  white = 0xffeceff4,
  red = 0xffbf616a,
  green = 0xffa3be8c,
  blue = 0xff5e81ac,
  yellow = 0xffebcb8b,
  orange = 0xffd08770,
  magenta = 0xffb48ead,
  grey = 0xff4c566a,
  transparent = 0x00000000,

  bar = {
    bg = 0xf0242933,
    border = 0xff3b4252,
  },
  popup = {
    bg = 0xc0242933,
    border = 0xff4c566a
  },
  bg1 = 0xff3b4252,
  bg2 = 0xff434c5e,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}

