-- Sketchybar Color Configuration (Catppuccin Mocha)
-- Source: domains/system/config/colors.lua

-- Load central colors
-- Note: We need to find the path to the central config.
-- Since sketchybar runs lua files, we can try to require it if it's in the path,
-- or we can just duplicate the values here for simplicity and reliability if the path is complex.
-- Given the structure, let's use the values directly but keep them consistent with the central config.
-- Ideally, we would symlink the central config to ~/.config/sketchybar/colors.lua, but here we are editing the source.

-- Load central colors from domains/system/config/colors.lua
local function load_central_colors()
    local dotfiles_root = os.getenv('DOTFILES_ROOT')
    local home = os.getenv('HOME')
    local path
    
    if dotfiles_root then
        path = dotfiles_root .. "/domains/system/config/colors.lua"
    else
        -- Fallback
        path = home .. "/dotfiles/domains/system/config/colors.lua"
    end
    
    local f = loadfile(path)
    if f then
        return f().palette
    else
        -- Fallback to Catppuccin Mocha
        return {
            rosewater = 0xfff5e0dc,
            flamingo = 0xfff2cdcd,
            pink = 0xfff5c2e7,
            mauve = 0xffcba6f7,
            red = 0xfff38ba8,
            maroon = 0xffeba0ac,
            peach = 0xfffab387,
            yellow = 0xfff9e2af,
            green = 0xffa6e3a1,
            teal = 0xff94e2d5,
            sky = 0xff89dceb,
            sapphire = 0xff74c7ec,
            blue = 0xff89b4fa,
            lavender = 0xffb4befe,
            text = 0xffcdd6f4,
            subtext1 = 0xffbac2de,
            subtext0 = 0xffa6adc8,
            overlay2 = 0xff9399b2,
            overlay1 = 0xff7f849c,
            overlay0 = 0xff6c7086,
            surface2 = 0xff585b70,
            surface1 = 0xff45475a,
            surface0 = 0xff313244,
            base = 0xff1e1e2e,
            mantle = 0xff181825,
            crust = 0xff11111b,
            
            transparent = 0x00000000,
            white = 0xffffffff,
            black = 0xff000000,
        }
    end
end

local colors = load_central_colors()

-- Map to Sketchybar specific names
return {
  black = colors.subtext0, -- mapped for visibility
  white = colors.text,
  red = colors.red,
  green = colors.green,
  blue = colors.blue,
  yellow = colors.yellow,
  orange = colors.peach,
  magenta = colors.pink,
  grey = colors.overlay0,
  transparent = colors.transparent,

  bar = {
    bg = 0xf01e1e2e, -- base with alpha
    border = colors.crust,
  },
  popup = {
    bg = 0xe01e1e2e, -- base with alpha
    border = colors.surface0,
  },
  bg1 = colors.surface0,
  bg2 = colors.surface1,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}
