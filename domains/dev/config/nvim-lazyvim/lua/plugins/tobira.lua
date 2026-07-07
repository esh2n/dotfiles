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
}
