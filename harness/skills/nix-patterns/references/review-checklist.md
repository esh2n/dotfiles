# nix-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` (purity, hashes, overrides, language, module system, platform conditionals, formatting), `security-reviewer` (insecure allowances, fetcher hashes that did not change with their source, environment-driven allowances) and `rollout-reviewer` (activation, `home.file` targets, `home.stateVersion`, Homebrew cleanup, flake input bumps and `follows`) through the `change-review` skill when a diff touches `*.nix`, `flake.nix`, `flake.lock`, overlays, NixOS, home-manager or nix-darwin modules (defects; silences and trade-offs in a design or spec review), and by `grilling` (trade-offs). Read `nixfmt --check`, `statix check`, `deadnix` and `nix flake check` output first, in that order: an item whose `tools:` line names a tool that ran is reported by that tool, not again by hand. Lock-file integrity and the origin of a new input or fetcher source are in `supply-chain-review/references/review-checklist.md`. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: nix:getenv-empty-unchecked
  rule: Environment reads are confined to one place and fail loudly when empty.
  check: `builtins.getEnv` whose result is used without testing for `""` (a pure flake evaluation returns `""` even for a set variable); environment reads spread across several files instead of one.
  tools: none.
  section: "## Purity and evaluation inputs"

- id: nix:current-system
  rule: Do not take the system from `builtins.currentSystem`.
  check: `builtins.currentSystem` anywhere in flake code or modules; pass `system` explicitly.
  tools: `nix flake check` fails in pure mode when the expression is evaluated; otherwise none.
  section: "## Purity and evaluation inputs"

- id: nix:lookup-path-or-implicit-config
  rule: No `<nixpkgs>` lookup paths and no Nixpkgs import without explicit `config` and `overlays`.
  check: `<nixpkgs>` or any `<...>` path outside a minimal example; `import nixpkgs { }` / `import <nixpkgs> { }` without `config` and `overlays`.
  tools: none.
  section: "## Purity and evaluation inputs"

- id: nix:hash-unchanged-with-source
  rule: A fetcher parameter change carries a hash change in the same diff.
  check: `url`, `rev`, `tag`, `version` feeding a fetcher, or `owner`/`repo` changed while `hash`/`sha256` stayed the same.
  tools: none — the build succeeds with the old content.
  section: "## Fixed-output derivation hashes"

- id: nix:fake-hash-committed
  rule: No fake hash is committed.
  check: `lib.fakeHash`, `lib.fakeSha256`, `lib.fakeSha512`, `hash = ""` or `sha256 = ""`, or an all-zero/arbitrary placeholder hash.
  tools: `nix flake check` when the fetcher is part of a built check; otherwise none.
  section: "## Fixed-output derivation hashes"

- id: nix:dependency-hash-stale
  rule: A `src` bump updates the helper's dependency hash too.
  check: `buildGoModule`/`buildRustPackage`/`buildNpmPackage` and the like with a new `src` or `version` but the same `vendorHash`/`cargoHash`/`npmDepsHash`; `goModules.overrideAttrs` (unsupported).
  tools: none.
  section: "## Fixed-output derivation hashes"

- id: nix:scope-override-missed
  rule: An override meant to reach dependents is made inside the package set.
  check: `perlPackages.<X>.overrideAttrs`, `python3Packages.<X>.overrideAttrs`, or `prev.<set> // { <X> = ...; }` where another package in the same set depends on `<X>`; fix is the set's `overrideScope`, `python.override { packageOverrides }` or `pythonPackagesExtensions`. Verify with a dependent's `.drvPath` or inputs.
  tools: none.
  section: "## Overriding packages"

- id: nix:override-derivation
  rule: Use `overrideAttrs` or `override`, not `overrideDerivation`.
  check: `overrideDerivation` in code that others build on.
  tools: none.
  section: "## Overriding packages"

- id: nix:name-version-drift
  rule: After `overrideAttrs` changes `version` or `src`, `name` and `src` both match what is built.
  check: `overrideAttrs` that sets `version` but not `src` (or `src` but not `version`); helpers that fix `name` from original arguments (`buildPerlPackage`) overridden without resetting `name`. Compare `nix eval .#<pkg>.name` with the `src` URL.
  tools: none.
  section: "## Overriding packages"

- id: nix:rec-in-overridable-package
  rule: A package that others may override uses `finalAttrs`, not `rec`.
  check: `mkDerivation rec { ... }` or `overrideAttrs (old: rec { ... })` where `src` or flags read `version` or another attribute through `rec`.
  tools: none.
  section: "## Overriding packages"

- id: nix:overlay-final-prev
  rule: In an overlay, the replaced package comes from `prev`, dependencies from `final`.
  check: `foo = final.foo.override...` / `final.foo.overrideAttrs` while defining `foo`; dependencies taken from `prev` so later overlays are skipped.
  tools: `nix flake check` reports infinite recursion for the self-reference; otherwise none.
  section: "## Overriding packages"

- id: nix:with-top-level
  rule: No `with` at the top of a file or around a module body.
  check: `with pkgs;`, `with lib;` or `with (import ...)` wrapping a whole file or module; nested `with` blocks. A local `with pkgs; [ ... ]` around a package list is accepted.
  tools: none.
  section: "## Language: scope, recursion and merging"

- id: nix:rec-attrset
  rule: Avoid `rec { }`; use `let ... in`.
  check: `rec {` attribute sets, especially where an attribute name equals an outer binding.
  tools: none.
  section: "## Language: scope, recursion and merging"

- id: nix:shallow-merge
  rule: `//` is shallow; nested configuration uses `lib.recursiveUpdate`.
  check: `a // b` where both sides carry the same top-level key holding a nested set.
  tools: none.
  section: "## Language: scope, recursion and merging"

- id: nix:src-dot-unnamed
  rule: `src = ./.` is wrapped in `builtins.path` with a fixed `name`.
  check: `src = ./.;` or `src = ../.;` passed to a derivation.
  tools: none.
  section: "## Language: scope, recursion and merging"

- id: nix:if-instead-of-mkif
  rule: Condition definitions on configuration with `mkIf`, never `if ... then ... else`.
  check: `config = if config.<x> then { ... } else { };` or a module body chosen by `if` on a `config` value.
  tools: `nix flake check` reports the infinite recursion when the module is evaluated.
  section: "## Module system"

- id: nix:imports-depend-on-config
  rule: `imports` does not depend on `config`, `pkgs` or `_module.args`.
  check: `imports = lib.optional config.<x> ...`, `imports = lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ ... ]`, or an import path built from a `_module.args` value; fix is `specialArgs` or `mkIf` inside the imported module.
  tools: `nix flake check` reports the infinite recursion.
  section: "## Module system"

- id: nix:priority-override-unexplained
  rule: A priority override needs a stated reason.
  check: `lib.mkForce` or `lib.mkOverride <n>` with no comment naming the conflicting definition; a library or shared module setting values without `mkDefault`.
  tools: none.
  section: "## Module system"

- id: nix:option-type-merge
  rule: Option types decide merging; no new `types.attrs`.
  check: New option declared `types.attrs`; `types.str` for an option several modules append to (use `types.lines` or a list).
  tools: `nix flake check` reports conflicting `types.str` definitions; `types.attrs` drops silently — none.
  section: "## Module system"

- id: nix:out-of-store-path-literal
  rule: `mkOutOfStoreSymlink` in a flake gets an absolute path string.
  check: `mkOutOfStoreSymlink ./...` or `mkOutOfStoreSymlink (self + ...)` — a path literal resolves to the flake's store copy.
  tools: none.
  section: "## home-manager files and activation"

- id: nix:home-file-force
  rule: `home.file.<n>.force = true` is not set on a target the user may have edited.
  check: `force = true` on any `home.file`, `xdg.configFile` or similar entry.
  tools: none.
  section: "## home-manager files and activation"

- id: nix:activation-not-idempotent
  rule: Activation entries are idempotent, write only after `writeBoundary`, and honour `DRY_RUN`.
  check: `home.activation.*` placed before `writeBoundary` that writes; `>>` appends, `mkdir` without `-p`, unguarded `git clone` or download; commands not wrapped in `run`.
  tools: none.
  section: "## home-manager files and activation"

- id: nix:state-version-bumped
  rule: `home.stateVersion` is not bumped as part of an upgrade.
  check: `home.stateVersion` (or `system.stateVersion`) changed in the diff without a note on the release notes' state-version changes.
  tools: none.
  section: "## home-manager files and activation"

- id: nix:darwin-root-activation
  rule: nix-darwin activation runs as root; per-user state belongs in home-manager.
  check: `system.activationScripts.*` writing under a home directory; use of the removed `extraUserActivation`, `preUserActivation`, `postUserActivation`.
  tools: `nix flake check` fails on the removed options; root-owned files — none.
  section: "## nix-darwin activation"

- id: nix:homebrew-cleanup-destructive
  rule: Turning Homebrew cleanup to `uninstall` or `zap` lists what it will remove.
  check: `homebrew.onActivation.cleanup` changed to `"uninstall"` or `"zap"` with no list of packages outside the Brewfile; `autoUpdate` or `upgrade` turned on.
  tools: none.
  section: "## nix-darwin activation"

- id: nix:input-missing-follows
  rule: Every input that takes `nixpkgs` follows the top-level one unless the diff says why not.
  check: New flake input with its own `nixpkgs` input and no `inputs.nixpkgs.follows`, and no comment on why. Check `flake.lock` for a second `nixpkgs` node.
  tools: none.
  section: "## Flake inputs and lock bumps"

- id: nix:insecure-both-set
  rule: `permittedInsecurePackages` and `allowInsecurePredicate` are not both set; each allowance names version, reason and removal.
  check: Both options in the same Nixpkgs `config`; an entry without a comment naming the vulnerability and exit condition.
  tools: none.
  section: "## Unfree and insecure packages"

- id: nix:allow-env-var
  rule: Unfree or insecure allowances live in Nixpkgs `config`, not in `NIXPKGS_ALLOW_*`.
  check: Docs, scripts or CI relying on `NIXPKGS_ALLOW_UNFREE` / `NIXPKGS_ALLOW_INSECURE` for a flake build.
  tools: none.
  section: "## Unfree and insecure packages"

- id: nix:stdenv-platform-shorthand
  rule: Use `stdenv.hostPlatform.is*` (or `buildPlatform` for build-time tools), not `stdenv.is*`.
  check: `stdenv.isDarwin`, `stdenv.isLinux`, `stdenv.isAarch64` and the other wrapped shorthands.
  tools: `nix flake check` prints the nixpkgs deprecation warning when evaluated with aliases on; otherwise none.
  section: "## Platform conditionals"

- id: nix:platform-hand-list
  rule: Filter packages by `meta.platforms` (`lib.meta.availableOn`), not a hand-kept list.
  check: A package included or excluded by matching a system string where the package's own `meta.platforms` decides it.
  tools: none.
  section: "## Platform conditionals"

- id: nix:not-formatted
  rule: Nix files are formatted with nixfmt (RFC 166 standard).
  check: `nixfmt --check` reports a file.
  tools: nixfmt.
  section: "## Tool coverage"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: nix:impure-unexplained
  rule: A configuration that needs `--impure` says why and which reads are impure.
  check: `--impure` in a Makefile, script, CI step or doc with no list of the impure reads.
  section: "## Purity and evaluation inputs"

- id: nix:override-no-exit
  rule: Every override of an upstream package names its exit condition.
  check: Overlay or `override`/`overrideAttrs`/`overrideScope` entry with no upstream release or nixpkgs revision after which it is removed.
  section: "## Overriding packages"

- id: nix:ifd-unstated
  rule: Import from derivation is stated where it is introduced.
  check: `import` or `builtins.readFile` of a derivation output, or `callPackage` on generated Nix built in the same evaluation, with no note that it is IFD.
  section: "## Language: scope, recursion and merging"

- id: nix:lock-bump-unexplained
  rule: A `flake.lock` bump says which inputs moved and what changed in the result.
  check: Lock changes with no list of moved inputs and no `nix store diff-closures` summary; a nixpkgs bump mixed into an unrelated change.
  section: "## Flake inputs and lock bumps"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: nix:ifd-or-generated
  rule: Import from derivation vs committed generated Nix.
  options: IFD (no generated code in the repo, always current; every evaluation builds first, fails where IFD is disabled) | committed generated file (fast evaluation, reviewable; drifts unless a check regenerates and compares)
  section: "## Language: scope, recursion and merging"

- id: nix:store-copy-or-out-of-store
  rule: Store copy vs out-of-store symlink for a managed file.
  options: store copy (reproducible, rolled back with the generation, read-only) | `mkOutOfStoreSymlink` (live edits without a switch; not rolled back, breaks when the checkout moves or is absent)
  section: "## home-manager files and activation"

- id: nix:follows-or-own-nixpkgs
  rule: `follows` vs the input's own nixpkgs.
  options: follows (one evaluation, one set of library versions; input built against a nixpkgs its authors did not test) | own nixpkgs (matches the input's CI and cache; extra evaluation and a second set of libraries)
  section: "## Flake inputs and lock bumps"

- id: nix:unfree-global-or-listed
  rule: Global `allowUnfree = true` vs naming unfree packages.
  options: global flag (one line, never blocks a build; new unfree packages arrive unnoticed) | `allowUnfreePackages` / `allowUnfreePredicate` (each new unfree package is a visible diff; a list to maintain)
  section: "## Unfree and insecure packages"
