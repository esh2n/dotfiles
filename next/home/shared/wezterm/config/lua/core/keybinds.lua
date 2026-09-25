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
        
        -- 透過度トグル (Leader + o)
        { key = 'o', mods = 'LEADER', action = act.EmitEvent 'toggle-opacity' },

        -- コピーモード (Leader + c で入る)
        { key = 'c', mods = 'LEADER', action = act.ActivateCopyMode },
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
    
    -- コピーモードのキーバインド（Vim準拠）
    config.key_tables = {
        copy_mode = {
            -- 終了
            { key = 'Escape', mods = 'NONE', action = act.CopyMode 'Close' },
            { key = 'q', mods = 'NONE', action = act.CopyMode 'Close' },

            -- 基本移動 (hjkl)
            { key = 'h', mods = 'NONE', action = act.CopyMode 'MoveLeft' },
            { key = 'j', mods = 'NONE', action = act.CopyMode 'MoveDown' },
            { key = 'k', mods = 'NONE', action = act.CopyMode 'MoveUp' },
            { key = 'l', mods = 'NONE', action = act.CopyMode 'MoveRight' },

            -- 単語移動
            { key = 'w', mods = 'NONE', action = act.CopyMode 'MoveForwardWord' },
            { key = 'b', mods = 'NONE', action = act.CopyMode 'MoveBackwardWord' },
            { key = 'e', mods = 'NONE', action = act.CopyMode 'MoveForwardWordEnd' },

            -- 行内移動
            { key = '0', mods = 'NONE', action = act.CopyMode 'MoveToStartOfLine' },
            { key = '^', mods = 'NONE', action = act.CopyMode 'MoveToStartOfLineContent' },
            { key = '$', mods = 'NONE', action = act.CopyMode 'MoveToEndOfLineContent' },

            -- 文字検索 (f/F/t/T)
            { key = 'f', mods = 'NONE', action = act.CopyMode{ JumpForward = { prev_char = false } } },
            { key = 'F', mods = 'NONE', action = act.CopyMode{ JumpBackward = { prev_char = false } } },
            { key = 't', mods = 'NONE', action = act.CopyMode{ JumpForward = { prev_char = true } } },
            { key = 'T', mods = 'NONE', action = act.CopyMode{ JumpBackward = { prev_char = true } } },
            { key = ',', mods = 'NONE', action = act.CopyMode 'JumpReverse' },
            { key = ';', mods = 'NONE', action = act.CopyMode 'JumpAgain' },

            -- スクロールバック先頭/末尾 (g → top, G → bottom)
            { key = 'g', mods = 'NONE', action = act.CopyMode 'MoveToScrollbackTop' },
            { key = 'G', mods = 'NONE', action = act.CopyMode 'MoveToScrollbackBottom' },

            -- ビューポート移動 (H/M/L)
            { key = 'H', mods = 'NONE', action = act.CopyMode 'MoveToViewportTop' },
            { key = 'M', mods = 'NONE', action = act.CopyMode 'MoveToViewportMiddle' },
            { key = 'L', mods = 'NONE', action = act.CopyMode 'MoveToViewportBottom' },

            -- ページ移動
            { key = 'u', mods = 'CTRL', action = act.CopyMode{ MoveByPage = -0.5 } },
            { key = 'd', mods = 'CTRL', action = act.CopyMode{ MoveByPage = 0.5 } },
            { key = 'b', mods = 'CTRL', action = act.CopyMode 'PageUp' },
            { key = 'f', mods = 'CTRL', action = act.CopyMode 'PageDown' },

            -- セマンティックゾーン移動 ({/} 相当)
            { key = '{', mods = 'NONE', action = act.CopyMode 'MoveBackwardSemanticZone' },
            { key = '}', mods = 'NONE', action = act.CopyMode 'MoveForwardSemanticZone' },

            -- 選択
            { key = 'v', mods = 'NONE', action = act.CopyMode{ SetSelectionMode = 'Cell' } },
            { key = 'V', mods = 'NONE', action = act.CopyMode{ SetSelectionMode = 'Line' } },
            { key = 'v', mods = 'CTRL', action = act.CopyMode{ SetSelectionMode = 'Block' } },

            -- コピー
            { key = 'y', mods = 'NONE', action = act.Multiple{
                { CopyTo = 'Clipboard' },
                { CopyMode = 'Close' },
            }},

            -- 検索
            { key = '/', mods = 'NONE', action = act.CopyMode 'EditPattern' },
            { key = 'n', mods = 'NONE', action = act.CopyMode 'NextMatch' },
            { key = 'N', mods = 'NONE', action = act.CopyMode 'PriorMatch' },
        },

        -- 検索モードのキーバインド
        search_mode = {
            { key = 'Escape', mods = 'NONE', action = act.CopyMode 'Close' },
            { key = 'Enter', mods = 'NONE', action = act.CopyMode 'AcceptPattern' },
            { key = 'n', mods = 'CTRL', action = act.CopyMode 'NextMatch' },
            { key = 'p', mods = 'CTRL', action = act.CopyMode 'PriorMatch' },
            { key = 'r', mods = 'CTRL', action = act.CopyMode 'CycleMatchType' },
            { key = 'u', mods = 'CTRL', action = act.CopyMode 'ClearPattern' },
        },
    }
end

return M 
