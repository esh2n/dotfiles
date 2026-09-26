# The package overlays both platforms build with: this repo's own packages and
# overrides (overlays, pkgs), plus packages taken from flake inputs.
# brew-nix (macOS casks) only exists on darwin.
{ inputs, system }:
let
  isDarwin = builtins.match ".*-darwin" system != null;
in
[
  (import ../overlays)
  (final: prev: { crit = inputs.crit.packages.${system}.default; })
  (final: prev: { capsule = inputs.capsule.packages.${system}.default; })
]
++ (
  if isDarwin then
    [ inputs.brew-nix.overlays.default ]
  else
    [ (final: prev: { llama-server-cuda = inputs.llama-cpp.packages.${system}.cuda; }) ]
)
