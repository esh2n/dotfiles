local M = {}

-- Everforest Light (Light variant)
M.variant = "light"

M.palette = {
    rosewater = 0xffe67e80, -- red (mapped)
    flamingo = 0xffe67e80, -- red (mapped)
    pink = 0xffd699b6, -- purple (mapped)
    mauve = 0xffd699b6, -- purple
    red = 0xffe67e80, -- red
    maroon = 0xffe67e80, -- red (mapped)
    peach = 0xffe69875, -- orange
    yellow = 0xffdfa000, -- yellow
    green = 0xff93b259, -- green (aqua mapped)
    teal = 0xff83c092, -- aqua
    sky = 0xff7fbbb3, -- blue
    sapphire = 0xff7fbbb3, -- blue
    blue = 0xff7fbbb3, -- blue
    lavender = 0xffd699b6, -- purple (mapped)
    text = 0xff5c6a72, -- fg
    subtext1 = 0xff708089, -- grey0
    subtext0 = 0xff829181, -- grey1
    overlay2 = 0xff93a097, -- grey2
    overlay1 = 0xffa6b0a0, -- statusline3
    overlay0 = 0xffbdc3af, -- statusline2
    surface2 = 0xffd3c6aa, -- statusline1
    surface1 = 0xffe5dfc5, -- bg4
    surface0 = 0xffedeada, -- bg3
    base = 0xfffdf6e3, -- bg0
    mantle = 0xfff4f0d9, -- bg1
    crust = 0xffefebd4, -- bg2

    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M
