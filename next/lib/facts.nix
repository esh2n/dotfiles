# The one impure read of the whole configuration: facts about the machine the
# flake is evaluated on (requires --impure). Everything else is pure and
# receives these values through the builders, never by reading the
# environment itself.
#
#   username  $USER ("ci" when unset, so a pure evaluation still names a user)
#   home      $HOME — required: a missing $HOME is an error, never a guess
#   repo      $DOTFILES_ROOT — the checkout editable configs link into
#             (out-of-store symlinks point at the checkout, not the store copy
#             the flake is evaluated from); required when a link is placed
#   roles     the machine-local roles file: $DOTFILES_ROLES_FILE, else
#             $HOME/.config/dotfiles/roles.json; no file means no roles.
#             Never committed — which roles a machine takes is chosen on the
#             machine; what a role means is committed in roles/.
let
  getEnv = builtins.getEnv;
  known = import ../roles/names.nix;

  user = getEnv "USER";
  homeEnv = getEnv "HOME";
  home = if homeEnv != "" then homeEnv else throw "facts: HOME is not set (evaluate with --impure in a login environment)";

  repoEnv = getEnv "DOTFILES_ROOT";
  repo = if repoEnv != "" then repoEnv else throw "facts: DOTFILES_ROOT is not set (make up exports it; it is the checkout links point into)";

  rolesFile =
    let
      override = getEnv "DOTFILES_ROLES_FILE";
    in
    if override != "" then override else "${home}/.config/dotfiles/roles.json";

  checkRole =
    role:
    if builtins.elem role known then
      role
    else
      throw ''facts: unknown role "${role}" in ${rolesFile} (known: ${builtins.concatStringsSep ", " known})'';

  parseRoles =
    path:
    let
      doc = builtins.fromJSON (builtins.readFile path);
    in
    if builtins.isAttrs doc && doc ? roles && builtins.isList doc.roles then
      map checkRole doc.roles
    else
      throw ''facts: ${path} must be {"roles": [ ... ]}'';
in
{
  username = if user == "" then "ci" else user;
  inherit home repo;
  roles = if builtins.pathExists rolesFile then parseRoles rolesFile else [ ];
}
