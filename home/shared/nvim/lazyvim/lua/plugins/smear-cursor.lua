-- カーソル移動アニメーション
return {
  {
    "sphamba/smear-cursor.nvim",
    event = "VeryLazy",
    opts = {
      stiffness = 0.8,
      trailing_stiffness = 0.5,
      trailing_exponent = 0.3,
      distance_stop_animating = 0.5,
      hide_target_hack = false,
    },
  },
}
