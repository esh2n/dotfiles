# code-reading: crt, the language server that explains code per line, and its
# configuration (the endpoint, model and key every editor shares). The
# configuration is a link to config.toml beside this file, so :CrConfig and
# "Code Reading: Open Configuration" edit it in place. Only where the dev
# packages are, since it talks to the machine's loopback LiteLLM.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  # crt reads its configuration from the platform config directory.
  path =
    if pkgs.stdenv.hostPlatform.isDarwin then
      "Library/Application Support/crt/config.toml"
    else
      "${lib.removePrefix "${config.home.homeDirectory}/" config.xdg.configHome}/crt/config.toml";
in
lib.mkIf config.dotfiles.packages.dev.enable {
  home.packages = [ pkgs.crt ];
  home.file.${path} = {
    source = config.lib.dotfiles.link "home/shared/code-reading/config.toml";
    # A hand-written file was there before this module.
    force = true;
  };
}
