local wezterm = require('wezterm')
local M = {}

-- Catppuccinのカラーパレット（Mocha）
local COLORS = {
    rosewater = "#f5e0dc",
    flamingo = "#f2cdcd",
    pink = "#f5c2e7",
    mauve = "#cba6f7",
    red = "#f38ba8",
    maroon = "#eba0ac",
    peach = "#fab387",
    yellow = "#f9e2af",
    green = "#a6e3a1",
    teal = "#94e2d5",
    sky = "#89dceb",
    sapphire = "#74c7ec",
    blue = "#89b4fa",
    lavender = "#b4befe",
    text = "#cdd6f4",
    subtext1 = "#bac2de",
    subtext0 = "#a6adc8",
    overlay2 = "#9399b2",
    overlay1 = "#7f849c",
    overlay0 = "#6c7086",
    surface2 = "#585b70",
    surface1 = "#45475a",
    surface0 = "#313244",
    base = "#1e1e2e",
    mantle = "#181825",
    crust = "#11111b",
}

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