# sketchybar's config is Lua and needs SbarLua, built against mise's lua and
# rebuilt when that Lua changes (dev-setup sbarlua).
{ config, ... }:
{
  dotfiles.setup.sbarlua.command = config.lib.dotfiles.devSetup "sbarlua";
}
