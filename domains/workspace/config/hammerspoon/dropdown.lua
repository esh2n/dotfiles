-- 汎用ドロップダウンアニメーション（専用ウィンドウ管理版）
--
-- 重要: 仮想デスクトップ（Spaces）で正しく動作させるための設定
-- IMPORTANT: Configuration for proper virtual desktop (Spaces) support
--
-- 各アプリケーションを「すべてのデスクトップ」に割り当てる必要があります：
-- You need to assign each application to "All Desktops":
--
-- 1. Dockでアプリケーションアイコンを右クリック
--    Right-click the application icon in the Dock
-- 2. オプション > 割り当て先 > すべてのデスクトップ
--    Options > Assign To > All Desktops
--
-- これにより、どの仮想デスクトップからでもドロップダウンが正しく表示されます
-- This ensures the dropdown works correctly from any virtual desktop

local dropdowns = {}
local windowMapping = {}  -- appName -> windowID のマッピング
local mappingFile = hs.configdir .. "/dropdown_windows.json"

-- デフォルトのウィンドウ戦略
local defaultStrategies = {
  -- ターミナル系は専用ウィンドウ
  ["iTerm2"] = "dedicated",
  ["Alacritty"] = "dedicated",
  ["Terminal"] = "dedicated",
  ["WezTerm"] = "dedicated",
  ["Warp"] = "dedicated",
  
  -- ノートアプリも専用ウィンドウ
  ["Notion"] = "dedicated",
  ["Obsidian"] = "dedicated",
  ["Craft"] = "dedicated",
  
  -- エディタ系も専用
  ["Code"] = "dedicated",
  ["Sublime Text"] = "dedicated",
  ["IntelliJ IDEA"] = "dedicated",
  
  -- コミュニケーション系も専用
  ["Discord"] = "dedicated",
  ["Slack"] = "dedicated",
  
  -- AI/チャット系も専用
  ["Claude"] = "dedicated",
  ["Dia"] = "dedicated",
  
  -- ブラウザも専用ウィンドウ
  ["Safari"] = "dedicated",
  ["Chrome"] = "dedicated",
  ["Firefox"] = "dedicated"
}

-- ウィンドウマッピングを読み込む
local function loadWindowMapping()
  local file = io.open(mappingFile, "r")
  if file then
    local content = file:read("*all")
    file:close()
    local success, data = pcall(hs.json.decode, content)
    if success and data then
      windowMapping = data
    end
  end
end

-- ウィンドウマッピングを保存する
local function saveWindowMapping()
  local file = io.open(mappingFile, "w")
  if file then
    file:write(hs.json.encode(windowMapping))
    file:close()
  end
end

-- 初期化時に読み込む
loadWindowMapping()

-- 専用ウィンドウを取得または作成
local function getOrCreateDedicatedWindow(app, config)
  local appName = config.appName
  
  -- 保存されたウィンドウIDから検索
  if windowMapping[appName] then
    local win = hs.window.get(windowMapping[appName])
    if win and win:application():name() == appName then
      return win
    end
  end
  
  -- 既存のウィンドウから選択
  local windows = app:allWindows()
  if #windows > 0 then
    -- 最初のウィンドウを専用として使用
    local win = windows[1]
    windowMapping[appName] = win:id()
    saveWindowMapping()
    return win
  end
  
  -- 新規ウィンドウを作成
  if config.createWindow then
    return config.createWindow(app)
  else
    -- デフォルトの新規ウィンドウ作成
    hs.eventtap.keyStroke({"cmd"}, "n")
    hs.timer.doAfter(0.5, function()
      local newWin = app:focusedWindow()
      if newWin then
        windowMapping[appName] = newWin:id()
        saveWindowMapping()
      end
    end)
    return app:focusedWindow()
  end
end

-- ウィンドウ選択戦略に基づいてウィンドウを取得
local function selectWindow(app, config)
  local strategy = config.windowStrategy or defaultStrategies[config.appName] or "dedicated"
  
  if strategy == "dedicated" then
    return getOrCreateDedicatedWindow(app, config)
  elseif strategy == "first" then
    local windows = app:allWindows()
    return windows[1]
  elseif strategy == "last" then
    return app:focusedWindow() or app:mainWindow()
  elseif strategy == "minimized" then
    local windows = app:allWindows()
    for _, win in ipairs(windows) do
      if win:isMinimized() then
        return win
      end
    end
    return windows[1]
  elseif strategy == "custom" and config.selectWindow then
    local windows = app:allWindows()
    return config.selectWindow(app, windows) or windows[1]
  else
    return app:mainWindow()
  end
end

-- ドロップダウンを作成する関数
-- config: {
--   appName: アプリケーション名（必須）
--   width: 幅（0.0-1.0の割合、デフォルト0.7）
--   height: 高さ（0.0-1.0の割合、デフォルト0.7）
--   position: 表示位置 "center", "left", "right"（デフォルト"center"）
--   direction: アニメーション方向 "bottom", "left", "right"（デフォルト"bottom"）
--   duration: アニメーション時間（秒、デフォルト0.3）
--   windowStrategy: ウィンドウ選択戦略 "dedicated", "first", "last", "minimized", "custom"
--   createWindow: 新規ウィンドウ作成関数（オプション）
--   selectWindow: カスタムウィンドウ選択関数（windowStrategy="custom"の場合）
--   bottomOffset: 下部オフセット（ピクセル、オプション、デフォルト0）
-- }
function createDropdown(hotkey, config)
  -- デフォルト値を設定
  config.width = config.width or 0.7
  config.height = config.height or 0.7
  config.position = config.position or "center"
  config.direction = config.direction or "bottom"
  config.duration = config.duration or 0.3
  config.bottomOffset = config.bottomOffset or 0
  
  -- 状態管理
  local state = {
    visible = false,
    animating = false,
    windowId = nil,
    hiddenWindowFrame = nil
  }
  
  hs.hotkey.bind(hotkey[1], hotkey[2], function()
    if state.animating then
      print("Animation in progress, ignoring input")
      return
    end
    
    local app = hs.application.get(config.appName)
    if not app then
      -- Launch app silently
      hs.application.launchOrFocus(config.appName)
      return
    end
    
    local win = selectWindow(app, config)
    if not win then
      -- Window not found, skip silently
      return
    end
    
    -- 専用ウィンドウの場合はIDを記録
    if (config.windowStrategy or defaultStrategies[config.appName] or "dedicated") == "dedicated" then
      state.windowId = win:id()
    end
    
    local screen = win:screen()
    local screenFrame = screen:frame()
    
    -- ウィンドウサイズを計算
    local winSize = {
      w = screenFrame.w * config.width,
      h = screenFrame.h * config.height
    }
    
    -- 表示位置を計算
    local visibleFrame = {}
    
    -- X座標の計算（position設定に基づく）
    if config.position == "left" then
      visibleFrame.x = screenFrame.x
    elseif config.position == "right" then
      visibleFrame.x = screenFrame.x + screenFrame.w - winSize.w
    else -- center
      visibleFrame.x = screenFrame.x + (screenFrame.w - winSize.w) / 2
    end
    
    -- Y座標とサイズ
    if config.direction == "bottom" then
      visibleFrame.y = screenFrame.y + screenFrame.h - winSize.h + config.bottomOffset
    elseif config.direction == "left" or config.direction == "right" then
      visibleFrame.y = screenFrame.y + (screenFrame.h - winSize.h) / 2  -- 縦中央
    end
    visibleFrame.w = winSize.w
    visibleFrame.h = winSize.h
    
    -- 非表示位置を計算（方向に基づく）
    local hiddenFrame = {
      x = visibleFrame.x,
      y = visibleFrame.y,
      w = winSize.w,
      h = winSize.h
    }
    
    if config.direction == "bottom" then
      hiddenFrame.y = screenFrame.y + screenFrame.h
    elseif config.direction == "left" then
      hiddenFrame.x = screenFrame.x - winSize.w
    elseif config.direction == "right" then
      hiddenFrame.x = screenFrame.x + screenFrame.w
    end
    
    state.animating = true
    
    if state.visible then
      -- Hide window
      
      local duration = config.duration
      local startTime = hs.timer.secondsSinceEpoch()
      local startFrame = win:frame()
      
      local timer
      timer = hs.timer.doEvery(0.016, function()
        local elapsed = hs.timer.secondsSinceEpoch() - startTime
        local progress = math.min(elapsed / duration, 1.0)
        local easedProgress = 1 - math.pow(1 - progress, 3)
        
        local frame = {}
        frame.x = startFrame.x + (hiddenFrame.x - startFrame.x) * easedProgress
        frame.y = startFrame.y + (hiddenFrame.y - startFrame.y) * easedProgress
        frame.w = startFrame.w
        frame.h = startFrame.h
        
        win:setFrame(frame)
        
        if progress >= 1.0 then
          timer:stop()
          -- 専用ウィンドウの場合は、そのウィンドウだけを隠す
          if (config.windowStrategy or defaultStrategies[config.appName] or "dedicated") == "dedicated" then
            -- ウィンドウを最小化
            win:minimize()
          else
            -- 専用でない場合はアプリ全体を隠す
            app:hide()
          end
          state.visible = false
          state.animating = false
        end
      end)
    else
      -- Show window
      
      hs.window.animationDuration = 0
      
      -- ウィンドウが最小化されているか、アプリが隠れている場合
      if win:isMinimized() or app:isHidden() then
        -- 極小サイズで準備
        local tempFrame = {
          x = hiddenFrame.x,
          y = screenFrame.y + screenFrame.h - 1,
          w = 1,
          h = 1
        }
        
        win:setFrame(tempFrame)
        
        if win:isMinimized() then
          win:unminimize()
        end
        
        if app:isHidden() then
          app:unhide()
        end
        
        
        win:setFrame(hiddenFrame)
        
        hs.timer.doAfter(0.01, function()
            app:activate()
            win:focus()
            
            local duration = config.duration
            local startTime = hs.timer.secondsSinceEpoch()
            
            local timer
            timer = hs.timer.doEvery(0.020, function()  -- 50fps for better performance
              local elapsed = hs.timer.secondsSinceEpoch() - startTime
              local progress = math.min(elapsed / duration, 1.0)
              local easedProgress = 1 - math.pow(1 - progress, 3)
              
              local frame = {}
              frame.x = hiddenFrame.x + (visibleFrame.x - hiddenFrame.x) * easedProgress
              frame.y = hiddenFrame.y + (visibleFrame.y - hiddenFrame.y) * easedProgress
              frame.w = winSize.w
              frame.h = winSize.h
              
              win:setFrame(frame)
              
              if progress >= 1.0 then
                timer:stop()
                state.visible = true
                state.animating = false
              end
            end)
        end)
      else
        -- 既に表示されている場合
        win:setFrame(hiddenFrame)
        app:activate()
        win:focus()
        
        
        hs.timer.doAfter(0.01, function()
          local duration = config.duration
          local startTime = hs.timer.secondsSinceEpoch()
          
          local timer
          timer = hs.timer.doEvery(0.020, function()  -- 50fps for better performance
            local elapsed = hs.timer.secondsSinceEpoch() - startTime
            local progress = math.min(elapsed / duration, 1.0)
            local easedProgress = 1 - math.pow(1 - progress, 3)
            
            local frame = {}
            frame.x = hiddenFrame.x + (visibleFrame.x - hiddenFrame.x) * easedProgress
            frame.y = hiddenFrame.y + (visibleFrame.y - hiddenFrame.y) * easedProgress
            frame.w = winSize.w
            frame.h = winSize.h
            
            win:setFrame(frame)
            
            if progress >= 1.0 then
              timer:stop()
              state.visible = true
              state.animating = false
            end
          end)
        end)
      end
    end
  end)
  
  dropdowns[config.appName] = state
end

-- アプリケーション設定
-- Notion: 下から
createDropdown({{"cmd", "alt"}, "n"}, {
  appName = "Notion",
  width = 1.0,
  height = 0.5,
  position = "center",
  direction = "bottom",
  duration = 0.15  -- アニメーション高速化
})

-- Discord: 下から
createDropdown({{"cmd", "alt"}, "i"}, {  -- dからiに変更（Dock切り替えショートカット回避）
  appName = "Discord",
  width = 1.0,
  height = 0.5,
  position = "center",
  direction = "bottom",
  duration = 0.15  -- アニメーション高速化
})

-- Warp: 下から
createDropdown({{"cmd", "alt"}, "w"}, {
  appName = "Warp",
  width = 1.0,
  height = 0.5,
  position = "center",
  direction = "bottom",
  duration = 0.15  -- アニメーション高速化
})

-- Dia: 下から
createDropdown({{"cmd", "alt"}, "b"}, {
  appName = "Dia",
  width = 1.0,
  height = 0.5,
  position = "center",
  direction = "bottom",
  duration = 0.15  -- アニメーション高速化
})

-- Claude: 下から
createDropdown({{"cmd", "alt"}, "c"}, {
  appName = "Claude",
  width = 1.0,
  height = 0.5,
  position = "center",
  direction = "bottom",
  duration = 0.15  -- アニメーション高速化
})

-- Dropdown system loaded