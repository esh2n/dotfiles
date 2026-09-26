local M = {}

-- Dracula Palette
M.palette = {
    rosewater = 0xffffb86c, -- orange
    flamingo = 0xffff5555, -- red
    pink = 0xffff79c6, -- pink
    mauve = 0xffbd93f9, -- purple
    red = 0xffff5555, -- red
    maroon = 0xffff6e6e, -- bright red
    peach = 0xffffb86c, -- orange
    yellow = 0xfff1fa8c, -- yellow
    green = 0xff50fa7b, -- green
    teal = 0xff8be9fd, -- cyan
    sky = 0xff8be9fd, -- cyan
    sapphire = 0xff6272a4, -- comment
    blue = 0xffbd93f9, -- purple
    lavender = 0xffff79c6, -- pink
    text = 0xfff8f8f2, -- fg
    subtext1 = 0xffe0e0e0, -- fg dim
    subtext0 = 0xffbfbfbf, -- fg dimmer
    overlay2 = 0xff6272a4, -- comment
    overlay1 = 0xff44475a, -- current line
    overlay0 = 0xff383a59, -- selection
    surface2 = 0xff44475a, -- current line
    surface1 = 0xff383a59, -- selection
    surface0 = 0xff282a36, -- bg
    base = 0xff282a36, -- bg
    mantle = 0xff21222c, -- darker bg
    crust = 0xff191a21, -- darkest bg
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

