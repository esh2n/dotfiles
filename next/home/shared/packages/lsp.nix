# Language servers, discovered and started lazily by editors and agents.
{ pkgs, ... }:
{
  home.packages = with pkgs; [
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
  ];
}
