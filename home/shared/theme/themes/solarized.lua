local M = {}

-- Solarized Dark Palette
M.palette = {
    rosewater = 0xffcb4b16, -- orange
    flamingo = 0xffdc322f, -- red
    pink = 0xffd33682, -- magenta
    mauve = 0xff6c71c4, -- violet
    red = 0xffdc322f, -- red
    maroon = 0xffdc322f, -- red
    peach = 0xffcb4b16, -- orange
    yellow = 0xffb58900, -- yellow
    green = 0xff859900, -- green
    teal = 0xff2aa198, -- cyan
    sky = 0xff2aa198, -- cyan
    sapphire = 0xff268bd2, -- blue
    blue = 0xff268bd2, -- blue
    lavender = 0xff6c71c4, -- violet
    text = 0xff839496, -- base0
    subtext1 = 0xff93a1a1, -- base1
    subtext0 = 0xff657b83, -- base00
    overlay2 = 0xff586e75, -- base01
    overlay1 = 0xff073642, -- base02
    overlay0 = 0xff002b36, -- base03
    surface2 = 0xff073642, -- base02
    surface1 = 0xff002b36, -- base03
    surface0 = 0xff002b36, -- base03
    base = 0xff002b36, -- base03
    mantle = 0xff001e26, -- darker
    crust = 0xff00141a, -- darkest
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

