local wezterm = require('wezterm')
local act = wezterm.action
local M = {}
local os_utils = require('lua.utils.os')

function M.apply_to_config(config)
    -- リーダーキーの設定
    config.leader = { key = 'q', mods = 'CTRL', timeout_milliseconds = 1000 }
    -- デフォルトのキーバインドを選択的に有効化（Windows環境ではCtrl+]などのキーを通すため）
    config.disable_default_key_bindings = false
    
    
    -- OS別のモディファイアキー選択
    local is_win = os_utils.is_windows()
    
    -- macOSとWindowsでモディファイアキーを切り替え
    local mod_cmd = is_win and 'CTRL' or 'SUPER'
    
    -- ベースとなるキーバインドの設定（OS共通）
    local base_keys = {
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
        { key = 't', mods = mod_cmd, action = act.SpawnTab 'CurrentPaneDomain' },
        { key = 'w', mods = mod_cmd, action = act.CloseCurrentTab { confirm = true } },
        
        -- タブ切り替え（macOSは⌘+[]、WindowsはCtrl+Tab/Shift+Tabを使用）
        { key = '[', mods = mod_cmd, action = act.ActivateTabRelative(-1) },
        { key = ']', mods = mod_cmd, action = act.ActivateTabRelative(1) },
        
        -- フォントサイズ
        { key = '=', mods = mod_cmd, action = act.IncreaseFontSize },
        { key = '-', mods = mod_cmd, action = act.DecreaseFontSize },
        { key = '0', mods = mod_cmd, action = act.ResetFontSize },
        
        -- コピー＆ペースト
        { key = 'c', mods = mod_cmd, action = act.CopyTo 'Clipboard' },
        { key = 'v', mods = mod_cmd, action = act.PasteFrom 'Clipboard' },
        
        -- 検索
        { key = 'f', mods = mod_cmd, action = act.Search 'CurrentSelectionOrEmptyString' },
        
        -- その他
        { key = 'q', mods = mod_cmd, action = act.QuitApplication },
        { key = 'r', mods = mod_cmd, action = act.ReloadConfiguration },
        { key = 'n', mods = mod_cmd, action = act.SpawnWindow },
        { key = 'm', mods = mod_cmd, action = act.Hide },
    }
    
    -- Windows環境向けの追加キーバインドとシェルへのキーパススルー設定
    if is_win then
        -- Windows環境では、Windows標準のショートカットキーとの競合を避けるために
        -- 一部キーバインドを別の組み合わせでも使用可能にする
        table.insert(base_keys, { key = 'Tab', mods = 'CTRL|SHIFT', action = act.ActivateTabRelative(-1) })
        table.insert(base_keys, { key = 'Tab', mods = 'CTRL', action = act.ActivateTabRelative(1) })
        -- Ctrl+]を明示的にシェルにパススルーする（WSL環境でのsk_select_src用）
        -- キーをそのままパススルーする方法を使用
        table.insert(base_keys, { key = ']', mods = 'CTRL', action = act.SendKey{ key = ']', mods = 'CTRL' } })
    end
    
    config.keys = base_keys
    
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