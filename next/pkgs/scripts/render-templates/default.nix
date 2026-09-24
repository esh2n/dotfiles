# render-templates as a package: shellcheck runs at build time and the tools
# it calls are pinned on its PATH.
{
  writeShellApplication,
  coreutils,
  findutils,
  gnused,
  gawk,
}:
writeShellApplication {
  name = "render-templates";
  runtimeInputs = [
    coreutils
    findutils
    gnused
    gawk
  ];
  text = builtins.readFile ./render-templates.sh;
}
