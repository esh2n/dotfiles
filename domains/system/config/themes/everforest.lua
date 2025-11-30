local M = {}

-- Everforest Dark Palette
M.palette = {
    rosewater = 0xffe69875, -- orange
    flamingo = 0xffe67e80, -- red
    pink = 0xffd699b6, -- purple
    mauve = 0xffd699b6, -- purple
    red = 0xffe67e80, -- red
    maroon = 0xffe67e80, -- red
    peach = 0xffe69875, -- orange
    yellow = 0xffdbbc7f, -- yellow
    green = 0xffa7c080, -- green
    teal = 0xff83c092, -- aqua
    sky = 0xff7fbbb3, -- blue
    sapphire = 0xff7fbbb3, -- blue
    blue = 0xff7fbbb3, -- blue
    lavender = 0xffd699b6, -- purple
    text = 0xffd3c6aa, -- fg
    subtext1 = 0xffc9c0a8, -- fg dim
    subtext0 = 0xff9da9a0, -- grey1
    overlay2 = 0xff859289, -- grey0
    overlay1 = 0xff5c6a72, -- bg5
    overlay0 = 0xff4f5b58, -- bg4
    surface2 = 0xff4f5b58, -- bg4
    surface1 = 0xff3d484d, -- bg3
    surface0 = 0xff2e383c, -- bg1
    base = 0xff2e383c, -- bg1
    mantle = 0xff272e33, -- bg0
    crust = 0xff1e2326, -- bg_dim
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

