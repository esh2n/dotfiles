local M = {}

-- Rosé Pine Palette
M.palette = {
    rosewater = 0xffebbcba, -- rose
    flamingo = 0xffeb6f92, -- love
    pink = 0xffebbcba, -- rose
    mauve = 0xffc4a7e7, -- iris
    red = 0xffeb6f92, -- love
    maroon = 0xffeb6f92, -- love
    peach = 0xfff6c177, -- gold
    yellow = 0xfff6c177, -- gold
    green = 0xff31748f, -- pine
    teal = 0xff9ccfd8, -- foam
    sky = 0xff9ccfd8, -- foam
    sapphire = 0xff31748f, -- pine
    blue = 0xff31748f, -- pine
    lavender = 0xffc4a7e7, -- iris
    text = 0xffe0def4, -- text
    subtext1 = 0xff908caa, -- subtle
    subtext0 = 0xff6e6a86, -- muted
    overlay2 = 0xff524f67, -- highlight high
    overlay1 = 0xff403d52, -- highlight med
    overlay0 = 0xff26233a, -- highlight low
    surface2 = 0xff403d52, -- highlight med
    surface1 = 0xff26233a, -- highlight low
    surface0 = 0xff1f1d2e, -- surface
    base = 0xff191724, -- base
    mantle = 0xff1f1d2e, -- surface
    crust = 0xff191724, -- base
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

