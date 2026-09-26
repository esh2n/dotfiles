local M = {}

-- Tokyo Night Day (Light variant)
M.variant = "light"

M.palette = {
    rosewater = 0xfff52a65, -- red (mapped)
    flamingo = 0xfff52a65, -- red (mapped)
    pink = 0xff9854f1, -- magenta
    mauve = 0xff7847bd, -- purple
    red = 0xfff52a65, -- red
    maroon = 0xffc64343, -- red2
    peach = 0xffb15c00, -- orange
    yellow = 0xff8c6c3e, -- yellow
    green = 0xff587539, -- green
    teal = 0xff118c74, -- teal
    sky = 0xff07879d, -- cyan
    sapphire = 0xff2e7de9, -- blue
    blue = 0xff2e7de9, -- blue
    lavender = 0xff7287fd, -- blue2
    text = 0xff3760bf, -- fg
    subtext1 = 0xff6172b0, -- fg_dark
    subtext0 = 0xff848cb5, -- comment
    overlay2 = 0xff8990b3, -- dark5
    overlay1 = 0xffa8aecb, -- dark3
    overlay0 = 0xffc4c8da, -- bg_visual
    surface2 = 0xffc4c8da, -- bg_visual
    surface1 = 0xffb6bfe2, -- bg_highlight
    surface0 = 0xffd0d5e3, -- bg_dark
    base = 0xffe1e2e7, -- bg
    mantle = 0xffd4d6e4, -- bg_dark
    crust = 0xffc8cad8, -- darkest

    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M
