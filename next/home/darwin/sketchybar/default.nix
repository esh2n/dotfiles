# sketchybar's config is Lua and needs SbarLua, built against mise's lua and
# rebuilt when that Lua changes (dotctl setup sbarlua).
{ config, ... }:
{
  dotfiles.setup.sbarlua.command = config.lib.dotfiles.setupStep "sbarlua";
}
