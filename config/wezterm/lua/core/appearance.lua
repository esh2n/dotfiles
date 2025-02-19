local wezterm = require('wezterm')
local colors = require('lua.ui.colors')
local M = {}

-- 背景画像をランダムに選択する関数
local function get_random_background()
    local home = os.getenv("HOME")
    local bg_dir = home .. "/go/github.com/esh2n/dotfiles/config/background"
    local handle = io.popen('ls "' .. bg_dir .. '"/*.jpg 2>/dev/null')
    local result = handle:read("*a")
    handle:close()
    
    local images = {}
    for path in result:gmatch("[^\n]+") do
        table.insert(images, path)
    end
    
    if #images > 0 then
        return images[math.random(#images)]
    end
    return nil
end

function M.apply_to_config(config)
    -- 背景画像の設定
    local bg_image = get_random_background()
    if bg_image then
        config.background = {
            {
                source = {
                    File = bg_image,
                },
                opacity = 0.2,
                hsb = {
                    brightness = 0.1,
                },
            },
        }
    end

    -- フォント設定
    config.font = wezterm.font_with_fallback({
        {
            -- fc-listで確認した正確なフォント名を使用
            family = "HackGen35 Console NF",
            weight = "Regular",
        },
        {
            family = "HackGen Console NF",
            weight = "Regular",
        },
        {
            family = "HackGen35 Console",
            weight = "Regular",
        },
        "Apple Color Emoji",  -- 絵文字フォント
    })
    config.font_size = 14.0  -- 白源は少し大きめが見やすい
    config.line_height = 1.3  -- 行間を広げて日本語を見やすく
    config.cell_width = 1.0
    config.underline_position = -2
    config.underline_thickness = 2
    config.freetype_load_target = "Light"
    config.freetype_render_target = "HorizontalLcd"

    -- ウィンドウ設定
    config.window_background_opacity = 0.95
    config.macos_window_background_blur = 30  -- ブラーを強めに
    config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"
    config.window_close_confirmation = "AlwaysPrompt"
    config.window_padding = {
        left = 15,
        right = 15,
        top = 5,     -- 上の余白を減らす
        bottom = 0,  -- ボトムバーがあるので余白なし
    }

    -- タブバー設定
    config.use_fancy_tab_bar = false  -- カスタムタブバーを使用
    config.hide_tab_bar_if_only_one_tab = false
    config.tab_bar_at_bottom = true
    config.tab_max_width = 32
    config.show_tab_index_in_tab_bar = false
    config.switch_to_last_active_tab_when_closing_tab = true

    -- カーソル設定
    config.default_cursor_style = "SteadyBar"
    config.cursor_blink_rate = 500
    config.cursor_thickness = 1

    -- スクロールバー設定
    config.enable_scroll_bar = false
    config.scrollback_lines = 10000

    -- 初期ウィンドウサイズ
    config.initial_rows = 40
    config.initial_cols = 120

    -- モダンUI設定
    -- ウィンドウフレーム設定
    local C = colors.get_colors()
    config.window_frame = {
        -- macOSスタイルの角丸
        border_left_width = "0.5cell",
        border_right_width = "0.5cell",
        border_bottom_height = "0.3cell",
        border_top_height = "0.3cell",
        border_left_color = "rgba(0, 0, 0, 0)",
        border_right_color = "rgba(0, 0, 0, 0)",
        border_bottom_color = "rgba(0, 0, 0, 0)",
        border_top_color = "rgba(0, 0, 0, 0)",
    }

    -- ウィンドウシャドウ設定
    config.window_background_gradient = {
        -- 微妙なグラデーションでシャドウ効果を演出
        orientation = "Vertical",
        interpolation = "Linear",
        colors = {
            C.base,
            C.mantle,
        },
    }

    -- パネル分割線設定
    config.inactive_pane_hsb = {
        saturation = 0.8,
        brightness = 0.7,
    }
    config.pane_focus_follows_mouse = true

    -- カラースキーマを適用
    colors.apply_to_config(config)
end

return M 