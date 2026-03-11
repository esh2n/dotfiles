-- 絶対行番号と相対行番号を両方表示
return {
  {
    "luukvbaal/statuscol.nvim",
    event = "BufReadPre",
    config = function()
      local builtin = require("statuscol.builtin")
      require("statuscol").setup({
        relculright = true,
        segments = {
          -- Git signs等
          { text = { "%s" }, click = "v:lua.ScSa" },
          -- 絶対行番号 + 相対行番号
          {
            text = {
              function(args)
                local abs_num = string.format("%3d", args.lnum)
                local rel_num = ""

                if vim.wo.relativenumber then
                  local current_line = vim.fn.line(".")
                  local rel = math.abs(args.lnum - current_line)
                  if args.lnum == current_line then
                    rel_num = "( 0)"
                  else
                    rel_num = string.format("(%2d)", rel)
                  end
                else
                  rel_num = "    "
                end

                return abs_num .. rel_num .. " │ "
              end,
            },
            click = "v:lua.ScLa",
          },
          -- 折りたたみ
          { text = { builtin.foldfunc }, click = "v:lua.ScFa" },
        },
      })
    end,
  },
}
