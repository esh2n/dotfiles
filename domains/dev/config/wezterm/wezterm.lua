local wezterm = require('wezterm')

-- モジュールのインポート
local appearance = require('lua.core.appearance')
local keybinds = require('lua.core.keybinds')
local colors = require('lua.ui.colors')
local status = require('lua.ui.status')
local tabs = require('lua.ui.tabs')
local os_utils = require('lua.utils.os') -- OSユーティリティをインポート

-- Windows環境でCtrl+]を直接ターミナルに渡すための設定
local config = {}
if wezterm.config_builder then
    config = wezterm.config_builder()
end

-- 各モジュールの設定を適用（Windows環境では選択的に適用）
appearance.apply_to_config(config)
keybinds.apply_to_config(config)
colors.apply_to_config(config)

-- Windows環境では標準のステータスバーを無効化し、シンプルな独自実装に置き換え
if not os_utils.is_windows() then
  -- macOS/Linux環境では通常のステータスバー
  status.apply_to_config(config)
end

tabs.apply_to_config(config)

-- パフォーマンス設定
local os_utils = require('lua.utils.os')
if os_utils.is_windows() then
    -- Windows(WSL)環境での最適化パフォーマンス設定
    config.front_end = "Software"  -- 安定性のためソフトウェアレンダリングを使用
    config.animation_fps = 15      -- アニメーションフレームレート削減
    config.max_fps = 30            -- 最大FPS維持
    
    -- Windows環境での追加最適化
    config.enable_tab_bar = true    -- 必要に応じてタブバーを表示
    config.use_fancy_tab_bar = false -- シンプルなタブバー
    config.window_close_confirmation = "NeverPrompt" -- 閉じる確認を表示しない
    config.exit_behavior = "Close"  -- 終了時に即座に閉じる
    config.check_for_updates = false -- 更新確認を無効化（パフォーマンス向上）
    config.adjust_window_size_when_changing_font_size = false -- フォントサイズ変更時のリサイズを無効化
    
    -- Windows環境向けの簡易ステータスバー設定
    config.status_update_interval = 5000  -- 5秒ごとの更新（低頻度）
    
    -- Windows環境では外部プロセスを起動しないシンプルなステータスバー
    wezterm.on("update-status", function(window, pane)
        -- 現在時刻のみを表示
        local time = wezterm.strftime("%H:%M")
        
        -- バッテリー情報（外部コマンドを使用せず内部APIのみ）
        local battery = '● N/A'
        local battery_info = wezterm.battery_info()
        if battery_info and #battery_info > 0 then
            local b = battery_info[1]
            local icon = '●'
            if b.state == 'Charging' then
                icon = '↑'
            elseif b.state == 'Empty' then
                icon = '○'
            end
            battery = string.format('%s %d%%', icon, math.floor(b.state_of_charge * 100))
        end
        
        -- シンプルなステータスバー（時刻とバッテリーのみ）
        local elements = {
            {Background = {Color = "#1e1e2e"}},
            {Text = "     "},
            {Foreground = {Color = "#94e2d5"}},
            {Text = battery .. "   "},
            {Foreground = {Color = "#cba6f7"}},
            {Attribute = {Intensity = "Bold"}},
            {Text = time},
            {Background = {Color = "#1e1e2e"}},
            {Text = "     "},
        }
        
        window:set_right_status(wezterm.format(elements))
    end)
else
    -- macOS/Linux環境ではWebGpuを使用
    config.front_end = "WebGpu"
    config.webgpu_power_preference = "HighPerformance"
    config.animation_fps = 60
    config.max_fps = 60
end

-- ウィンドウフレームの設定
config.window_background_opacity = 0.95

-- OS別のウィンドウフレーム設定
if os_utils.is_windows() then
    -- Windows用のシンプルなフレーム設定
    config.window_decorations = "RESIZE"
    config.window_frame = {
        font = wezterm.font { family = 'Consolas', weight = 'Bold' },
        font_size = 12.0,
        active_titlebar_bg = colors.get_colors().mantle,
        inactive_titlebar_bg = colors.get_colors().surface0,
        -- Windowsではシンプルなフレームにして安定性を高める
        border_left_width = '0.5cell',
        border_right_width = '0.5cell',
        border_bottom_height = '0.5cell',
        border_top_height = '0cell',
        border_left_color = colors.get_colors().mantle,
        border_right_color = colors.get_colors().mantle,
        border_bottom_color = colors.get_colors().mantle,
        border_top_color = colors.get_colors().mantle,
    }
else
    -- macOS用の装飾的なフレーム設定
    config.window_decorations = "RESIZE"
    config.window_frame = {
        font = wezterm.font { family = 'Hack Nerd Font', weight = 'Bold' },
        font_size = 12.0,
        active_titlebar_bg = colors.get_colors().mantle,
        inactive_titlebar_bg = colors.get_colors().surface0,
        border_left_width = '2cell',
        border_right_width = '2cell',
        border_bottom_height = '1cell',
        border_top_height = '0cell',
        border_left_color = colors.get_colors().mantle,
        border_right_color = colors.get_colors().mantle,
        border_bottom_color = colors.get_colors().mantle,
        border_top_color = colors.get_colors().mantle,
    }
end

-- 外側のパディング設定
config.window_padding = {
    left = "2.5cell",
    right = "2.5cell",
    top = "0",
    bottom = "0",
}

-- パネルボーダーの設定
config.inactive_pane_hsb = {
    saturation = 0.9,
    brightness = 0.8,
}
-- デバッグ設定
config.debug_key_events = false

-- ベル音設定
config.audible_bell = 'SystemBeep'

-- Windows環境での追加パフォーマンス最適化
if os_utils.is_windows() then
  -- Windows環境ではファイル監視を無効化（パフォーマンス向上）
  config.automatically_reload_config = false
  
  -- WSL向け設定最適化
  config.enable_wayland = false
  config.term = "wezterm"
end


-- デフォルトの作業ディレクトリとシェルを設定
config.default_cwd = os_utils.get_home_dir() -- OSに応じたホームディレクトリを取得

-- WSL起動方法を最適化
if os_utils.is_windows() then
  -- WSL直接起動（簡素化、効率化）
  config.default_prog = { 'wsl.exe', '-d', 'Ubuntu' }  -- Ubuntuディストリビューションを直接指定
else
  -- macOS/Linux環境では通常のシェル
  config.default_prog = os_utils.get_default_shell()
end

-- タブタイトルの設定
wezterm.on('format-tab-title', function(tab, tabs, panes, config, hover, max_width)
    local title = tab.active_pane.title
    local cwd = tab.active_pane.current_working_dir
    if cwd then
        local home_dir = os_utils.get_home_dir() -- OSに応じたホームディレクトリを取得
        local display_path = cwd.file_path
        if home_dir then
            display_path = display_path:gsub(home_dir, '~') -- ホームディレクトリをチルダに置換
        end
        title = wezterm.format({
            { Text = wezterm.nerdfonts.md_folder .. ' ' },
            { Text = display_path },
        })
    end
    return title
end)

-- ベル通知の設定（Claudeが実行中の場合のみ）
local function is_claude(pane)
  local process = pane:get_foreground_process_info()
  if not process or not process.argv then
    return false
  end
  -- 引数に"claude"が含まれているかチェック
  for _, arg in ipairs(process.argv) do
    if arg:find("claude") then
      return true
    end
  end
  return false
end

wezterm.on("bell", function(window, pane)
  if is_claude(pane) then
    window:toast_notification("Claude Code", "Task completed", nil, 4000)
  end
end)

-- レイアウトの設定
wezterm.on('gui-startup', function(cmd)
  local layout = require('lua.core.layout')
  
  -- OSに応じた起動処理
  if os_utils.is_windows() then
    -- Windows環境では最小限の初期化（パフォーマンス重視）
    local mux = wezterm.mux
    local tab, pane, window = mux.spawn_window(cmd or {})
    
    -- Windows環境でも起動時に最大化（ユーザー要望）
    -- パフォーマンス問題を避けるため少し遅延
    wezterm.sleep_ms(100)
    window:gui_window():maximize()
  else
    -- macOS環境では通常のレイアウト処理
    local tab, pane, window = layout.default(cmd)
    -- macOSでも起動時に最大化
    window:gui_window():maximize()
  end
end)

return config 