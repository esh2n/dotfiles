# Language servers (the dev role), discovered and started lazily by editors and agents.
{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.packages = lib.mkIf config.dotfiles.packages.dev.enable (with pkgs; [
    typescript-language-server
    zls
    bash-language-server
    nixd
    lua-language-server
    vscode-langservers-extracted # HTML, CSS, JSON, ESLint
    yaml-language-server
    marksman
    terraform-ls
    biome
    tailwindcss-language-server
    astro-language-server
  ]);
}
