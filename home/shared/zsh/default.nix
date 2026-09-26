# zsh: the login and interactive entry points, and the fragments .zshrc
# reads from beside them (rc/: helpers, aliases, options, functions,
# integrations, keybindings, editors, brew). All links into the checkout, so
# an edit takes effect in the next shell.
# capsule, the prompt, answers from a daemon it registers itself.
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  # A feature module adds its own zsh fragment beside itself; which modules a
  # platform imports (lib/mk-darwin.nix, lib/mk-linux.nix) decides which
  # fragments a machine gets, so no fragment asks which OS it is on.
  # .zshrc reads ~/.config/zsh/conf.d/*.zsh after rc/.
  options.dotfiles.zsh.snippets = lib.mkOption {
    type = lib.types.attrsOf lib.types.str;
    default = { };
    description = "zsh fragments by name: checkout-relative paths, linked into ~/.config/zsh/conf.d.";
  };

  config = {
    dotfiles.setup.capsule-daemon.command = config.lib.dotfiles.setupStep "capsule-daemon";

    home.file = {
      ".zshenv".source = link "home/shared/zsh/zshenv";
      ".zprofile".source = link "home/shared/zsh/zprofile";
      ".zshrc".source = link "home/shared/zsh/zshrc";
    };

    xdg.configFile = lib.mapAttrs' (
      name: path: lib.nameValuePair "zsh/conf.d/${name}.zsh" { source = link path; }
    ) config.dotfiles.zsh.snippets;
  };
}
