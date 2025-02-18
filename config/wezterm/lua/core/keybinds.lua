local wezterm = require('wezterm')
local act = wezterm.action
local M = {}

function M.apply_to_config(config)
    -- リーダーキーの設定
    config.leader = { key = 'q', mods = 'CTRL', timeout_milliseconds = 1000 }
    
    -- デフォルトのキーバインドを無効化
    config.disable_default_key_bindings = true
    
    -- キーバインドの設定
    config.keys = {
        -- ペイン操作
        { key = '-', mods = 'LEADER', action = act.SplitVertical { domain = 'CurrentPaneDomain' } },
        { key = '\\', mods = 'LEADER', action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },
        { key = 'h', mods = 'LEADER', action = act.ActivatePaneDirection 'Left' },
        { key = 'j', mods = 'LEADER', action = act.ActivatePaneDirection 'Down' },
        { key = 'k', mods = 'LEADER', action = act.ActivatePaneDirection 'Up' },
        { key = 'l', mods = 'LEADER', action = act.ActivatePaneDirection 'Right' },
        { key = 'z', mods = 'LEADER', action = act.TogglePaneZoomState },
        { key = 'x', mods = 'LEADER', action = act.CloseCurrentPane { confirm = true } },
        
        -- タブ操作
        { key = 't', mods = 'SUPER', action = act.SpawnTab 'CurrentPaneDomain' },
        { key = 'w', mods = 'SUPER', action = act.CloseCurrentTab { confirm = true } },
        { key = '[', mods = 'SUPER', action = act.ActivateTabRelative(-1) },
        { key = ']', mods = 'SUPER', action = act.ActivateTabRelative(1) },
        
        -- フォントサイズ
        { key = '=', mods = 'SUPER', action = act.IncreaseFontSize },
        { key = '-', mods = 'SUPER', action = act.DecreaseFontSize },
        { key = '0', mods = 'SUPER', action = act.ResetFontSize },
        
        -- コピー＆ペースト
        { key = 'c', mods = 'SUPER', action = act.CopyTo 'Clipboard' },
        { key = 'v', mods = 'SUPER', action = act.PasteFrom 'Clipboard' },
        
        -- 検索
        { key = 'f', mods = 'SUPER', action = act.Search 'CurrentSelectionOrEmptyString' },
        
        -- その他
        { key = 'q', mods = 'SUPER', action = act.QuitApplication },
        { key = 'r', mods = 'SUPER', action = act.ReloadConfiguration },
        { key = 'n', mods = 'SUPER', action = act.SpawnWindow },
        { key = 'm', mods = 'SUPER', action = act.Hide },
    }
    
    -- コピーモードのキーバインド
    config.key_tables = {
        copy_mode = {
            { key = 'Escape', mods = 'NONE', action = act.CopyMode 'Close' },
            { key = 'q', mods = 'NONE', action = act.CopyMode 'Close' },
            { key = 'h', mods = 'NONE', action = act.CopyMode 'MoveLeft' },
            { key = 'j', mods = 'NONE', action = act.CopyMode 'MoveDown' },
            { key = 'k', mods = 'NONE', action = act.CopyMode 'MoveUp' },
            { key = 'l', mods = 'NONE', action = act.CopyMode 'MoveRight' },
            { key = 'w', mods = 'NONE', action = act.CopyMode 'MoveForwardWord' },
            { key = 'b', mods = 'NONE', action = act.CopyMode 'MoveBackwardWord' },
            { key = 'v', mods = 'NONE', action = act.CopyMode{ SetSelectionMode = 'Cell' } },
            { key = 'V', mods = 'NONE', action = act.CopyMode{ SetSelectionMode = 'Line' } },
            { key = 'y', mods = 'NONE', action = act.Multiple{
                { CopyTo = 'ClipboardAndPrimarySelection' },
                { CopyMode = 'Close' },
            }},
        },
    }
end

return M 