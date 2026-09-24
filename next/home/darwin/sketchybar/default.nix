# sketchybar's config is Lua and needs SbarLua, which is not on luarocks: the
# workspace domain's script builds it against mise's lua (rebuilt when the Lua
# version changes) until its content moves (M3).
{
  lib,
  pkgs,
  facts,
  ...
}:
{
  dotfiles.setup.sbarlua.command = "${lib.getExe pkgs.bash} ${lib.escapeShellArg "${facts.repo}/domains/workspace/install.sh"}";
}
