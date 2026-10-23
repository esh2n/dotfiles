return {
  "kamegoro/tobira.nvim",
  event = "VeryLazy",
  opts = {
    lang = "ja", -- 提案メッセージを日本語で表示
    idle_delay = 1500, -- 何もしなくなってから提案を出すまでの待機(ms)
    idle_suggestions = true, -- アイドル時の自動提案を有効化
    suggestion_cooldown = 5, -- 次の自動提案までの最小間隔(秒)
    max_shown = 9999, -- 同じコマンドを何回でも提案する(実質無制限)
  },
  config = function(_, opts)
    require("tobira").setup(opts)
    -- j の5連打で出る {n}j の提案だけ止める。setup に該当オプションが無いので、
    -- :TobiraProgress の x と同じ suppress 状態を起動時に書き込む
    local logger = require("tobira.core.logger")
    for _, cmd in ipairs({ "{n}j" }) do
      if not logger.get(cmd).suppressed then
        logger.set_suppressed(cmd, true)
      end
    end
  end,
}
