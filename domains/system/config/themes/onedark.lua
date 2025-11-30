local M = {}

-- One Dark Palette
M.palette = {
    rosewater = 0xffd19a66, -- orange
    flamingo = 0xffe06c75, -- red
    pink = 0xffc678dd, -- magenta
    mauve = 0xffc678dd, -- magenta
    red = 0xffe06c75, -- red
    maroon = 0xffbe5046, -- dark red
    peach = 0xffd19a66, -- orange
    yellow = 0xffe5c07b, -- yellow
    green = 0xff98c379, -- green
    teal = 0xff56b6c2, -- cyan
    sky = 0xff56b6c2, -- cyan
    sapphire = 0xff61afef, -- blue
    blue = 0xff61afef, -- blue
    lavender = 0xffc678dd, -- magenta
    text = 0xffabb2bf, -- fg
    subtext1 = 0xff9da5b3, -- fg dim
    subtext0 = 0xff828997, -- comment
    overlay2 = 0xff5c6370, -- gutter
    overlay1 = 0xff4b5263, -- bg highlight
    overlay0 = 0xff3e4452, -- selection
    surface2 = 0xff4b5263, -- bg highlight
    surface1 = 0xff3e4452, -- selection
    surface0 = 0xff282c34, -- bg
    base = 0xff282c34, -- bg
    mantle = 0xff21252b, -- darker bg
    crust = 0xff1b1f23, -- darkest bg
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

