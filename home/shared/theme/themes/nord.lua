local M = {}

-- Nord Palette
M.palette = {
    rosewater = 0xffbf616a, -- aurora red (mapped)
    flamingo = 0xffd08770, -- aurora orange (mapped)
    pink = 0xffb48ead, -- aurora purple (mapped)
    mauve = 0xffb48ead, -- aurora purple
    red = 0xffbf616a, -- aurora red
    maroon = 0xffd08770, -- aurora orange
    peach = 0xffd08770, -- aurora orange
    yellow = 0xffebcb8b, -- aurora yellow
    green = 0xffa3be8c, -- aurora green
    teal = 0xff8fbcbb, -- frost teal
    sky = 0xff88c0d0, -- frost blue
    sapphire = 0xff81a1c1, -- frost blue 2
    blue = 0xff5e81ac, -- frost blue 3
    lavender = 0xff81a1c1, -- frost blue 2 (mapped)
    text = 0xffeceff4, -- snow storm 3
    subtext1 = 0xffe5e9f0, -- snow storm 2
    subtext0 = 0xffd8dee9, -- snow storm 1
    overlay2 = 0xff4c566a, -- polar night 4
    overlay1 = 0xff434c5e, -- polar night 3
    overlay0 = 0xff3b4252, -- polar night 2
    surface2 = 0xff4c566a, -- polar night 4 (mapped)
    surface1 = 0xff434c5e, -- polar night 3 (mapped)
    surface0 = 0xff3b4252, -- polar night 2 (mapped)
    base = 0xff2e3440, -- polar night 1
    mantle = 0xff242933, -- darker base (custom)
    crust = 0xff1c2028, -- darkest base (custom)
    
    transparent = 0x00000000,
    white = 0xffffffff,
    black = 0xff000000,
}

function M.with_alpha(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
end

return M
