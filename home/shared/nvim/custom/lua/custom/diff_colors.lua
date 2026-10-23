-- Keep syntax colours visible in diff mode, whatever the colorscheme.
-- Some themes (solarized, dracula, nord, ...) give Diff* a foreground colour
-- or `reverse`, which paints over syntax highlighting. After every
-- colorscheme load, any Diff* group that does so is replaced by a background
-- tint: the group's own colour blended into the editor background.
-- DiffDelete only colours filler lines, so only its `reverse` is replaced.
local M = {}

-- How much of the diff colour goes into the tint.
local strength = { DiffAdd = 0.2, DiffChange = 0.2, DiffDelete = 0.2, DiffText = 0.35 }

local function blend(colour, base, alpha)
  local out = {}
  for _, shift in ipairs({ 16, 8, 0 }) do
    local c = math.floor(colour / 2 ^ shift) % 256
    local b = math.floor(base / 2 ^ shift) % 256
    out[#out + 1] = math.floor(c * alpha + b * (1 - alpha) + 0.5)
  end
  return string.format('#%02x%02x%02x', out[1], out[2], out[3])
end

function M.apply()
  local normal = vim.api.nvim_get_hl(0, { name = 'Normal', link = false })
  -- Transparent themes leave Normal without a background; floats usually
  -- keep the theme's own one.
  local float = vim.api.nvim_get_hl(0, { name = 'NormalFloat', link = false })
  local base = normal.bg or float.bg or (vim.o.background == 'light' and 0xffffff or 0x000000)
  for group, alpha in pairs(strength) do
    local hl = vim.api.nvim_get_hl(0, { name = group, link = false })
    local paints_text = hl.reverse or (hl.fg and group ~= 'DiffDelete')
    if paints_text then
      -- With `reverse` the visible background is the fg colour.
      local colour = (hl.reverse and hl.fg) or hl.bg or hl.fg
      if colour then
        local new = { bg = blend(colour, base, alpha) }
        if group == 'DiffDelete' then
          new.fg = colour -- the filler characters on the other side
        end
        vim.api.nvim_set_hl(0, group, new)
      end
    end
  end
end

function M.setup()
  vim.api.nvim_create_autocmd('ColorScheme', {
    group = vim.api.nvim_create_augroup('diff_colors', { clear = true }),
    callback = M.apply,
  })
  M.apply()
end

return M
