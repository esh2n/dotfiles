local M = {}

-- Kanagawa Palette
M.palette = {
    rosewater = 0xffd27e99, -- sakuraPink
    flamingo = 0xffe46876, -- waveRed
    pink = 0xffd27e99, -- sakuraPink
    mauve = 0xff957fb8, -- oniViolet
    red = 0xffc34043, -- autumnRed
    maroon = 0xffe82424, -- samuraiRed
    peach = 0xffffa066, -- surimiOrange
    yellow = 0xffc0a36e, -- boatYellow2
    green = 0xff76946a, -- autumnGreen
    teal = 0xff6a9589, -- waveAqua1
    sky = 0xff7fb4ca, -- springBlue
    sapphire = 0xff7e9cd8, -- crystalBlue
    blue = 0xff7e9cd8, -- crystalBlue
    lavender = 0xff9cabca, -- springViolet2
    text = 0xffdcd7ba, -- fujiWhite (fg)
    subtext1 = 0xffc8c093, -- oldWhite
    subtext0 = 0xff727169, -- fujiGray
    overlay2 = 0xff54546d, -- sumiInk4
    overlay1 = 0xff363646, -- sumiInk3
    overlay0 = 0xff2a2a37, -- sumiInk2
    surface2 = 0xff363646, -- sumiInk3
    surface1 = 0xff2a2a37, -- sumiInk2
    surface0 = 0xff1f1f28, -- sumiInk1 (bg)
    base = 0xff1f1f28, -- sumiInk1 (bg)
    mantle = 0xff16161d, -- sumiInk0
    crust = 0xff16161d, -- sumiInk0
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M

