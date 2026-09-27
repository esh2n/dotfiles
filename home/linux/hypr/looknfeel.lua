-- Change the default Omarchy look'n'feel.

-- https://wiki.hypr.land/Configuring/Basics/Variables/#general
-- hl.config({
--   general = {
--     -- No gaps between windows or borders.
--     gaps_in = 0,
--     gaps_out = 0,
--     border_size = 0,
--
--     -- Change to niri-like side-scrolling layout.
--     layout = "scrolling",
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#decoration
-- hl.config({
--   decoration = {
--     -- Use round window corners.
--     rounding = 8,
--
--     -- Dim unfocused windows (0.0 = no dim, 1.0 = fully dimmed).
--     dim_inactive = true,
--     dim_strength = 0.15,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#animations
-- hl.config({
--   animations = {
--     -- Disable all animations.
--     enabled = false,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#layout
-- hl.config({
--   layout = {
--     -- Avoid overly wide single-window layouts on wide screens.
--     single_window_aspect_ratio = { 1, 1 },
--   },
-- })

-- https://wiki.hypr.land/Configuring/Layouts/Scrolling-Layout/
-- hl.config({
--   scrolling = {
--     -- See only one column per screen instead of two.
--     column_width = 0.97,
--   },
-- })

-- dos-moos author's look (without colors; colors come from the theme)
hl.config({
  general = {
    border_size = 1,
  },
  decoration = {
    rounding = 4,
    rounding_power = 2,
    active_opacity = 0.94,
    inactive_opacity = 0.94,
    fullscreen_opacity = 1.0,
    shadow = {
      enabled = true,
      range = 15,
      render_power = 3,
      color = "rgba(0A0B06ee)",
      color_inactive = "rgba(0A0B0688)",
    },
    blur = {
      enabled = false,
    },
  },
})

-- Keep media and image apps fully opaque
hl.window_rule({
  opacity = "1.0 override 1.0 override",
  match = {
    class = "^(imv|mpv|vlc|org.gnome.NautilusPreviewer|org.gnome.Evince|com.gabm.satty|zoom|org.kde.kdenlive|com.obsproject.Studio|com.github.PintaProject.Pinta)$",
  },
})

-- Keep color-critical GTK apps fully opaque
hl.window_rule({
  opacity = "1.0 override 1.0 override",
  match = {
    class = "^(gimp|com.github.xournalpp.xournalpp|nwg-look|system-config-printer)$",
  },
})
