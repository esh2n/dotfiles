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
    -- j / k を連打したときの提案（{n}j, {n}k, }, {）だけ止める。setup に該当
    -- オプションが無いので、連打の検出結果を提案キューに渡す手前で捨てる
    local ignored = { j_repeat = true, j_many = true, k_repeat = true, k_many = true }
    local logger = require("tobira.core.logger")
    local queue = logger.on_pattern
    logger.on_pattern = function(pattern, cmd)
      if not ignored[pattern] then
        queue(pattern, cmd)
      end
    end
  end,
}
