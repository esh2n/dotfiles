local wezterm = require('wezterm')
local mux = wezterm.mux

local M = {}

-- デフォルトレイアウト: 3ペイン
M.default = function(cmd)
  local tab, pane, window = mux.spawn_window(cmd or {})
  -- 最大化してからペインを分割
  window:gui_window():maximize()
  wezterm.sleep_ms(100) -- ウィンドウの最大化を待つ
  
  -- 右側に1/3のペインを作成
  local right_pane = pane:split({ size = 0.3 })
  -- 残りの2/3の中央に1/2のペインを作成
  pane:split({ size = 0.5 })
  return tab, pane, window
end

-- フォーカスレイアウト: シンプルな1ペイン
M.focus = function(cmd)
  local tab, pane, window = mux.spawn_window(cmd or {})
  window:gui_window():maximize()
  return tab, pane, window
end

-- ホビーレイアウト: プロジェクト用の2ペイン
M.hobby = function(cmd)
  local project_dir = wezterm.home_dir .. '/projects'
  local tab, build_pane, window = mux.spawn_window({
    workspace = 'hobby',
    cwd = project_dir,
    args = cmd and cmd.args or {},
  })
  window:gui_window():maximize()
  wezterm.sleep_ms(100)
  
  local editor_pane = build_pane:split({
    direction = 'Top',
    size = 0.7,
    cwd = project_dir,
  })
  return tab, build_pane, window
end

-- ギークレイアウト: システムモニタリング用の4ペイン
M.geek = function(cmd)
  local tab, pane, window = mux.spawn_window(cmd or {})
  window:gui_window():maximize()
  wezterm.sleep_ms(100)
  
  -- 上部に htop
  local htop = pane:split({
    direction = 'Top',
    size = 0.5,
  })
  htop:send_text('htop\n')
  
  -- 右側に neofetch
  local neofetch = pane:split({
    direction = 'Right',
    size = 0.5,
  })
  neofetch:send_text('neofetch\n')
  
  -- 下部に duf (ディスク使用量)
  pane:send_text('duf\n')
  return tab, pane, window
end

return M 