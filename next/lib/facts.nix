# The one impure read of the whole configuration: facts about the machine the
# flake is evaluated on (requires --impure). Everything else is pure and
# receives these values through the builders, never by reading the
# environment itself.
#
#   username  $USER ("ci" under pure evaluation)
#   home      $HOME (the platform default for username under pure evaluation)
#   roles     the machine-local roles file: $DOTFILES_ROLES_FILE, else
#             ~/.config/dotfiles/roles.json. Never committed — which roles a
#             machine takes is chosen on the machine; what a role means is
#             committed in roles/.
let
  getEnv = builtins.getEnv;
  user = getEnv "USER";
  home = getEnv "HOME";
  known = import ../roles/names.nix;

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
  home = if home != "" then home else null;
  roles = if rolesFile != "" && builtins.pathExists rolesFile then parseRoles rolesFile else [ ];
}
