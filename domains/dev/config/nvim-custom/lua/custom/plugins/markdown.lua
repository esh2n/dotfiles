-- Markdown enhancement plugins
return {
  -- Enhanced markdown rendering
  {
    'MeanderingProgrammer/render-markdown.nvim',
    dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
    ft = { 'markdown', 'mdx' },
    opts = {
      -- ヘッダー
      heading = {
        -- アイコンを使用したヘッダー表示
        icons = { '󰲡 ', '󰲣 ', '󰲥 ', '󰲧 ', '󰲩 ', '󰲫 ' },
        signs = { '󰫎 ' },
        width = 'full',
        backgrounds = {
          'RenderMarkdownH1Bg',
          'RenderMarkdownH2Bg', 
          'RenderMarkdownH3Bg',
          'RenderMarkdownH4Bg',
          'RenderMarkdownH5Bg',
          'RenderMarkdownH6Bg',
        },
      },
      
      -- コードブロック
      code = {
        enabled = true,
        sign = true,
        width = 'full',
        position = 'left',
        language_pad = 2,
        disable_background = { 'diff' },
      },
      
      -- 引用
      quote = {
        icon = '▎',
        repeat_linebreak = false,
      },
      
      -- パイプテーブル
      pipe_table = {
        enabled = true,
        preset = 'round',
        style = 'full',
        alignment_indicator = '━',
      },
      
      -- チェックボックス
      checkbox = {
        enabled = true,
        checked = {
          icon = '󰄲 ',
        },
        unchecked = {
          icon = '󰄱 ',
        },
        custom = {
          todo = { raw = '[-]', rendered = '󰥔 ', highlight = 'RenderMarkdownTodo' },
        },
      },
      
      -- バレット（リスト）
      bullet = {
        enabled = true,
        icons = { '•', '◦', '▪', '▫' },
      },
      
      -- リンク
      link = {
        enabled = true,
        image = '󰥶 ',
        email = '󰀓 ',
        hyperlink = '󰌹 ',
        highlight = 'RenderMarkdownLink',
        custom = {
          web = { pattern = '^http[s]?://', icon = '󰖟 ' },
        },
      },
      
      -- サイン
      sign = {
        enabled = true,
      },
      
      -- インラインハイライト
      inline_highlight = {
        enabled = true,
        query = {
          block = {
            '{nvim-treesitter/nvim-treesitter}',
            'markdown_inline',
            '(code_span) @_inline',
          },
        },
        highlights = { '_inline', },
      },
      
      -- ファイルタイプ
      file_types = { 'markdown', 'mdx' },
      
      -- LaTeX
      latex = {
        enabled = true,
        converter = 'latex2text',
        highlight = 'RenderMarkdownMath',
      },
    },
    config = function(_, opts)
      require('render-markdown').setup(opts)
      
      -- カスタムハイライトグループ
      vim.cmd [[
        hi RenderMarkdownH1Bg guibg=#332c4a
        hi RenderMarkdownH2Bg guibg=#2d3f5f
        hi RenderMarkdownH3Bg guibg=#30435c
        hi RenderMarkdownH4Bg guibg=#32485a
        hi RenderMarkdownH5Bg guibg=#344c59
        hi RenderMarkdownH6Bg guibg=#365057
      ]]
    end,
  },
}