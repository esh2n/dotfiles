local wezterm = require('wezterm')
local M = {}

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
        wezterm.log_error("Failed to load central colors from: " .. path)
        -- Fallback to Catppuccin Mocha if load fails
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
        }
    end
end

local COLORS_RAW = load_central_colors()

-- Convert integer colors to hex strings for WezTerm
local COLORS = {}
for k, v in pairs(COLORS_RAW) do
    if type(v) == "number" then
        COLORS[k] = string.format("#%06x", v & 0xffffff)
    else
        COLORS[k] = v
    end
end

function M.get_colors()
    return COLORS
end

function M.apply_to_config(config)
    -- カラースキーマの設定
    config.colors = {
        foreground = COLORS.text,
        background = COLORS.base,
        cursor_bg = COLORS.rosewater,
        cursor_fg = COLORS.base,
        cursor_border = COLORS.rosewater,
        selection_fg = COLORS.base,
        selection_bg = COLORS.rosewater,
        scrollbar_thumb = COLORS.surface2,
        split = COLORS.mantle,
        ansi = {
            COLORS.surface1,
            COLORS.red,
            COLORS.green,
            COLORS.yellow,
            COLORS.blue,
            COLORS.pink,
            COLORS.teal,
            COLORS.subtext1,
        },
        brights = {
            COLORS.surface2,
            COLORS.red,
            COLORS.green,
            COLORS.yellow,
            COLORS.blue,
            COLORS.pink,
            COLORS.teal,
            COLORS.subtext0,
        },
        tab_bar = {
            background = COLORS.mantle,
            active_tab = {
                bg_color = COLORS.base,
                fg_color = COLORS.lavender,
            },
            inactive_tab = {
                bg_color = COLORS.mantle,
                fg_color = COLORS.overlay0,
            },
            inactive_tab_hover = {
                bg_color = COLORS.crust,
                fg_color = COLORS.text,
            },
            new_tab = {
                bg_color = COLORS.surface0,
                fg_color = COLORS.text,
            },
            new_tab_hover = {
                bg_color = COLORS.surface1,
                fg_color = COLORS.text,
            },
        },
    }
end

return M 
