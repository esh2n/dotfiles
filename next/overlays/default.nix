# Overrides of upstream packages, plus this repository's own packages
# (next/pkgs). claude-code is managed by its native installer (auto-updates)
# and aicommits by mise, not here.
final: prev:
{
  gotools = prev.gotools.overrideAttrs (old: {
    postInstall = (old.postInstall or "") + ''
      rm -f $out/bin/bundle
      rm -f $out/bin/modernize
    '';
  });

  # gh from cli/cli trunk: carries `--attach` (issue/PR attachments from the
  # CLI, merged 2026-08-25, cli/cli#14186) which no release has yet — 2.98.0
  # (2026-08-20) predates it. Drop this override once a release ships it and
  # the flake's nixpkgs carries that release.
  gh = prev.gh.overrideAttrs (old: rec {
    version = "2.98.0-trunk-40b742f";
    src = prev.fetchFromGitHub {
      owner = "cli";
      repo = "cli";
      rev = "40b742f76d68e6b1f472942a6368db4b5d765641";
      hash = "sha256-nGquMOwkEZp6ysFJOw5qa1PqQqw7+WLqpPQiziEAPG0=";
    };
    vendorHash = "sha256-v9h17XD/fyHasgLsHHkGvoV1qITWpwGDJ6MtlvWnN4c=";
  });
}
// import ../pkgs { inherit (final) callPackage; }
