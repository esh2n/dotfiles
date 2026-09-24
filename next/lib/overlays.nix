# The package overlays both platforms build with: the repo's own packages and
# overrides (still in core/nix/overlays.nix until they move to pkgs/ and
# overlays/), plus packages taken from flake inputs. brew-nix (macOS casks)
# only exists on darwin.
{ inputs, system }:
let
  isDarwin = builtins.match ".*-darwin" system != null;
in
[
  (import ../../core/nix/overlays.nix)
  (final: prev: { crit = inputs.crit.packages.${system}.default; })
  (final: prev: { capsule = inputs.capsule.packages.${system}.default; })
]
++ (if isDarwin then [ inputs.brew-nix.overlays.default ] else [ ])
