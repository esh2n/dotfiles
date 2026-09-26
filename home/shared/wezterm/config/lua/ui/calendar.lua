local wezterm = require('wezterm')

local M = {}

-- 次の予定を取得（macOS）
local function get_next_event_mac()
    local script = [[
        tell application "Calendar"
            set currentDate to current date
            set nextEvent to null
            repeat with calendarAccount in calendars
                set eventList to (first event of calendarAccount whose start date is greater than or equal to currentDate)
                if nextEvent is null or (start date of eventList) is less than (start date of nextEvent) then
                    set nextEvent to eventList
                end if
            end repeat
            if nextEvent is not null then
                set eventTime to time string of (start date of nextEvent)
                set eventTitle to summary of nextEvent
                return eventTime & " " & eventTitle
            end if
        end tell
    ]]

    local success, stdout, stderr = wezterm.run_child_process({
        'osascript',
        '-e', script
    })

    if success and stdout and stdout ~= "" then
        local event_info = stdout:gsub('\n', '')
        return "📅 " .. event_info
    end
    return nil
end

function M.get_next_event()
    if wezterm.target_triple == "x86_64-apple-darwin" or 
       wezterm.target_triple == "aarch64-apple-darwin" then
        return get_next_event_mac()
    end
    return nil
end

return M 