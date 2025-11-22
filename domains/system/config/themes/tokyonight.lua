local M = {}

-- Tokyo Night Palette
M.palette = {
    rosewater = 0xfff7768e, -- red (mapped)
    flamingo = 0xfff7768e, -- red (mapped)
    pink = 0xffbb9af7, -- magenta
    mauve = 0xff9d7cd8, -- purple
    red = 0xfff7768e, -- red
    maroon = 0xfff7768e, -- red (mapped)
    peach = 0xffff9e64, -- orange
    yellow = 0xffe0af68, -- yellow
    green = 0xff9ece6a, -- green
    teal = 0xff73daca, -- teal
    sky = 0xff7dcfff, -- cyan
    sapphire = 0xff7aa2f7, -- blue
    blue = 0xff7aa2f7, -- blue
    lavender = 0xffb4f9f8, -- cyan (mapped)
    text = 0xffc0caf5, -- fg
    subtext1 = 0xffa9b1d6, -- fg_dark
    subtext0 = 0xff9aa5ce, -- terminal_black (bright)
    overlay2 = 0xff565f89, -- comment
    overlay1 = 0xff414868, -- bg_highlight
    overlay0 = 0xff24283b, -- bg
    surface2 = 0xff414868, -- bg_highlight (mapped)
    surface1 = 0xff24283b, -- bg (mapped)
    surface0 = 0xff1a1b26, -- bg_dark
    base = 0xff1a1b26, -- bg_dark
    mantle = 0xff16161e, -- darker base
    crust = 0xff16161e, -- darkest base
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M
