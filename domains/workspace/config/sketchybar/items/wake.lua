-- Recover from sleep/wake: SkyLight loses its delegate after wake, leaving the
-- bar invisible despite the process staying alive. On the built-in system_woke
-- event, kickstart the launchd job so it re-spawns with a fresh SkyLight bridge.

local wake_listener = sbar.add("item", {
  drawing = false,
  updates = true,
})

wake_listener:subscribe("system_woke", function()
  -- Detach + defer so this callback returns before launchctl kills us.
  -- kickstart -k is the most reliable way to get launchd to re-spawn the job.
  os.execute("(sleep 1 && /bin/launchctl kickstart -k gui/$(/usr/bin/id -u)/homebrew.mxcl.sketchybar) >/dev/null 2>&1 &")
end)
