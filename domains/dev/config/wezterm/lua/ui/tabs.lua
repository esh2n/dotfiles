local wezterm = require('wezterm')
local M = {}

-- タブのフォーマット
local function tab_title(tab_info)
    local title = tab_info.tab_title
    
    -- タブタイトルが空の場合はプロセス名を使用
    if title == nil or title == '' then
        title = tab_info.active_pane.foreground_process_name
    end
    
    -- プロセス名が空の場合はシェル名を使用
    if title == nil or title == '' then
        title = tab_info.active_pane.title:match("[^/]+$") or "shell"
    end
    
    return title
end

function M.apply_to_config(config)
    wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
        local title = tab_title(tab)
        
        -- アイコンの選択（プロセスに基づく）
        local process_name = tab.active_pane.foreground_process_name
        local icon = wezterm.nerdfonts.dev_terminal
        
        if process_name:find("nvim") then
            icon = wezterm.nerdfonts.custom_vim
        elseif process_name:find("git") then
            icon = wezterm.nerdfonts.dev_git
        elseif process_name:find("node") then
            icon = wezterm.nerdfonts.dev_nodejs
        elseif process_name:find("python") then
            icon = wezterm.nerdfonts.dev_python
        end
        
        -- カラーの設定
        local bg
        local fg
        if tab.is_active then
            bg = "#8caaee"  -- blue
            fg = "#303446"  -- base
        elseif hover then
            bg = "#626880"  -- surface2
            fg = "#c6d0f5"  -- text
        else
            bg = "#414559"  -- surface0
            fg = "#a5adce"  -- subtext0
        end
        
        -- タブの装飾
        local edge_background = "#292c3c"  -- mantle
        local edge_foreground = bg
        local edge_char = wezterm.nerdfonts.pl_right_hard_divider
        
        -- タブのフォーマット
        return {
            -- 左パディング
            { Background = { Color = edge_background } },
            { Text = "     " },  -- 約1.25cellに相当する空白

            -- タブの内容
            { Background = { Color = edge_background } },
            { Foreground = { Color = edge_foreground } },
            { Text = edge_char },
            { Background = { Color = bg } },
            { Foreground = { Color = fg } },
            { Text = string.format(" %s %s ", icon, title) },
            { Background = { Color = edge_background } },
            { Foreground = { Color = bg } },
            { Text = edge_char },
        }
    end)
end

return M 