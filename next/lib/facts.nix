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
#   nvidia    the host's NVIDIA driver, from the same file's optional
#             "nvidia": {"version", "sha256", "acceptLicense"} (the gpu role
#             needs it: Nix's driver libraries must match what the
#             distribution installed, and using them means accepting NVIDIA's
#             license — the owner's act, so it lives in their file); null
#             when absent.
let
  getEnv = builtins.getEnv;
  known = import ../roles/names.nix;

  user = getEnv "USER";
  homeEnv = getEnv "HOME";
  home =
    if homeEnv != "" then
      homeEnv
    else
      throw "facts: HOME is not set (evaluate with --impure in a login environment)";

  repoEnv = getEnv "DOTFILES_ROOT";
  repo =
    if repoEnv != "" then
      repoEnv
    else
      throw "facts: DOTFILES_ROOT is not set (make up exports it; it is the checkout links point into)";

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

  doc =
    if builtins.pathExists rolesFile then
      builtins.fromJSON (builtins.readFile rolesFile)
    else
      { roles = [ ]; };

  parseRoles =
    if builtins.isAttrs doc && doc ? roles && builtins.isList doc.roles then
      map checkRole doc.roles
    else
      throw ''facts: ${rolesFile} must be {"roles": [ ... ]}'';

  parseNvidia =
    let
      n = doc.nvidia or null;
    in
    if n == null then
      null
    else if
      builtins.isAttrs n && builtins.isString (n.version or null) && builtins.isString (n.sha256 or null)
    then
      {
        inherit (n) version sha256;
        acceptLicense = n.acceptLicense or false;
      }
    else
      throw ''facts: "nvidia" in ${rolesFile} needs both "version" and "sha256" (the host driver's, e.g. from nvidia-smi and nix store prefetch-file)'';
in
{
  username = if user == "" then "ci" else user;
  inherit home repo;
  roles = parseRoles;
  nvidia = parseNvidia;
}
