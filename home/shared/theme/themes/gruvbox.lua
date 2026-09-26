local M = {}

-- Gruvbox Dark Palette
M.palette = {
    rosewater = 0xffd65d0e, -- orange
    flamingo = 0xffcc241d, -- red
    pink = 0xffd3869b, -- purple
    mauve = 0xffb16286, -- purple
    red = 0xffcc241d, -- red
    maroon = 0xfffb4934, -- bright red
    peach = 0xfffe8019, -- bright orange
    yellow = 0xfffabd2f, -- bright yellow
    green = 0xffb8bb26, -- bright green
    teal = 0xff8ec07c, -- aqua
    sky = 0xff83a598, -- bright blue
    sapphire = 0xff458588, -- blue
    blue = 0xff83a598, -- bright blue
    lavender = 0xffd3869b, -- purple
    text = 0xffebdbb2, -- fg
    subtext1 = 0xffd5c4a1, -- fg2
    subtext0 = 0xffbdae93, -- fg3
    overlay2 = 0xff665c54, -- bg4
    overlay1 = 0xff504945, -- bg3
    overlay0 = 0xff3c3836, -- bg2
    surface2 = 0xff504945, -- bg3
    surface1 = 0xff3c3836, -- bg2
    surface0 = 0xff282828, -- bg
    base = 0xff282828, -- bg
    mantle = 0xff1d2021, -- bg0_h
    crust = 0xff1d2021, -- bg0_h
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

