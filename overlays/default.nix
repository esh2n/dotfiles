# Overrides of upstream packages, plus this repository's own packages
# (pkgs). claude-code is managed by its native installer (auto-updates)
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

  # perlcritic and perltidy at their current CPAN releases. PPI before 1.281
  # does not parse subroutine signatures, so Perl::Critic on nixpkgs' PPI
  # 1.277 reports every signature as a prototype. overrideScope (not
  # perl.override's overrides) so PerlCritic is built against this PPI.
  # buildPerlPackage fixes the store name from the original version, so it
  # is set again here. Drop each entry once the flake's nixpkgs carries it.
  perlPackages = prev.perlPackages.overrideScope (
    pfinal: pprev:
    let
      cpan =
        drv:
        {
          author,
          version,
          hash,
          extraDeps ? [ ],
        }:
        drv.overrideAttrs (old: {
          inherit version;
          name = "perl${pfinal.perl.version}-${old.pname}-${version}";
          src = prev.fetchurl {
            url = "mirror://cpan/authors/id/${author}/${old.pname}-${version}.tar.gz";
            inherit hash;
          };
          propagatedBuildInputs = (old.propagatedBuildInputs or [ ]) ++ extraDeps;
        });
    in
    {
      PPI = cpan pprev.PPI {
        author = "M/MI/MITHALDU";
        version = "1.291";
        hash = "sha256-dKwQv2ZEPqgT+zfS/1IZxNjmhTeSctZpnIEqOdkfPB0=";
        extraDeps = [
          pfinal.SafeIsa
          pfinal.YAMLPP
        ];
      };
      PerlCritic = cpan pprev.PerlCritic {
        author = "P/PE/PETDANCE";
        version = "1.156";
        hash = "sha256-Vyp8h1i6HAq22vC9QCl8Tw3PFRbwhFIt8sK/BNUl4jI=";
      };
      PerlTidy = cpan pprev.PerlTidy {
        author = "S/SH/SHANCOCK";
        version = "20260826";
        hash = "sha256-EE4+XuXIRSTV5QMk1mTHhZsaxCKrl6PnokiYWktPf2Q=";
      };
    }
  );
}
// import ../pkgs { inherit (final) callPackage; }
