# harness-apply as a package (shellcheck at build time). bun, pnpm and codex
# are taken from the user's PATH on purpose: mise and Homebrew own them.
{
  writeShellApplication,
  coreutils,
  gnused,
}:
writeShellApplication {
  name = "harness-apply";
  runtimeInputs = [
    coreutils
    gnused
  ];
  inheritPath = true;
  text = builtins.readFile ./harness-apply.sh;
}
