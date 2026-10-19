---
name: nix-patterns
description: Use when writing or reviewing Nix code — `*.nix`, `flake.nix`, `flake.lock`, overlays, NixOS, home-manager or nix-darwin modules — and when judging purity and `--impure`, `builtins.getEnv` or `builtins.currentSystem`, fixed-output hashes and `lib.fakeHash`, `override` vs `overrideAttrs` vs `overrideScope` (including Perl and Python package scopes where dependents miss an override), `name`/`version` drift, import from derivation, `with` and `rec` scoping, `mkIf`/`mkMerge`/`mkDefault`/`mkForce` and option types, `home.file` and `mkOutOfStoreSymlink`, activation scripts, flake input bumps and `follows`, unfree or insecure allowances, platform conditionals, and nixfmt, statix and deadnix output.
metadata:
  namespaces: [platform/infra]
---

# Nix Patterns

Judgment criteria for reviewing Nix expressions, flakes and module
configurations — not a Nix tutorial. Sources checked 2026-10-19 against Nix
2.34/2.35, nixpkgs `master`, home-manager `master` and nix-darwin `master`.
The nixpkgs and NixOS manual sections were read from their source files in
the nixpkgs repository, which the published manuals are built from.

Lock-file integrity (`narHash`/`rev` changes for the same input), the origin
of a new flake input, and whether a new dependency is needed belong to
`supply-chain-review`; this skill covers what the Nix code does with them.

## Purity and evaluation inputs

**[defect] An expression that reads the environment, the clock or the host
platform must be confined to one place and must fail loudly when the value is
missing.** Flakes evaluate in pure mode unless `--impure` is passed (measured
below; the flag's own text is "Allow
access to mutable paths and repositories",
https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-build). Pure mode
disables `builtins.currentSystem`, `currentTime`, `nixPath` and `storePath`
(https://nix.dev/manual/nix/latest/command-ref/conf-file#conf-pure-eval), so
`currentSystem` is an evaluation error. `builtins.getEnv` is worse: it returns
the empty string for an unset variable
(https://nix.dev/manual/nix/latest/language/builtins#builtins-getEnv), and in
a pure flake evaluation it also returns `""` for a variable that *is* set —
measured with Nix 2.34.8 on 2026-10-19 (`builtins.getEnv "HOME"` evaluates to
`""` without `--impure`, to the home directory with it). A `getEnv` whose
empty result is used as a value therefore misconfigures silently whenever
someone forgets `--impure`. The check: every `getEnv` result is tested for
`""` and either throws or falls back to a named, documented value.

**[defect] Do not take the system from `builtins.currentSystem`.** Pass
`system` explicitly (a flake output keyed per system, `lib.genAttrs systems`)
— it is unavailable in pure mode and makes the result depend on the machine
that evaluates it.

**[defect] No `<nixpkgs>` lookup paths and no bare `import nixpkgs {}`.**
Lookup paths resolve through `$NIX_PATH` and differ between machines, and a
Nixpkgs import without explicit `config` and `overlays` reads configuration
from the file system (https://nix.dev/guides/best-practices). Use the flake
input, and set `config` and `overlays` when importing.

**[silence] A configuration that needs `--impure` says why and which reads
are impure.** Requiring it for the whole flake also lifts the guard for every
other expression, so the impure reads should be listed in one file.

## Fixed-output derivation hashes

**[defect] A fetcher whose `url`, `rev`, `tag` or other parameter changed must
change its hash in the same diff.** The hash describes the output, so a store
object that already matches the old hash is reused and the new source is never
fetched (https://github.com/NixOS/nixpkgs/blob/master/doc/build-helpers/fetchers.chapter.md,
section "Caveats"). The build succeeds with the old content under the new
version label.

**[defect] No fake hash is committed.** The fake hash method sets the hash to
`""`, `lib.fakeHash`, `lib.fakeSha256` or `lib.fakeSha512`, builds, and copies
the real hash from the mismatch error (same chapter, "Updating source hashes").
A committed placeholder is a build that cannot succeed. Any other
"arbitrarily-chosen" placeholder is wrong even during the update — the chapter
requires one of those four.

**[defect] Language helpers carry a second hash.** `buildGoModule` has
`vendorHash`, which `overrideAttrs` can override; calling `goModules.overrideAttrs`
is unsupported
(https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/go.section.md).
A `src` bump without the dependency hash (`vendorHash`, `cargoHash`,
`npmDepsHash` and the like) reuses the old dependency output on the same rule
as above.

## Overriding packages

| Want to change | Use | Source |
|---|---|---|
| an argument of the package function (a feature flag, a dependency) | `pkg.override { ... }` | https://nixos.org/manual/nixpkgs/stable/#sec-pkg-override |
| the attributes passed to `mkDerivation` (src, version, patches, phases) | `pkg.overrideAttrs (finalAttrs: previousAttrs: { ... })` | https://nixos.org/manual/nixpkgs/stable/#sec-pkg-overrideAttrs |
| a package *and everything in its set that depends on it* | the set's `overrideScope`, or the language's own hook (`python.override { packageOverrides }`, `pythonPackagesExtensions`) | see the scope rule below |
| the evaluated derivation itself | `overrideDerivation` — never in Nixpkgs; it evaluates the derivation first | https://nixos.org/manual/nixpkgs/stable/#sec-pkg-overrideDerivation |

**[defect] An override meant to reach dependents must be made inside the
package set, not on the single attribute.** `pkgs.perlPackages.PPI.overrideAttrs`
in an overlay, or `perlPackages = prev.perlPackages // { PPI = ...; }`, changes
the attribute you read, but `PerlCritic` was built by the set's own
`callPackage` against the set's own `PPI`, so it keeps the old one. A scope
made with `lib.makeScope` exposes `overrideScope` so that "all functions `p`
invoked with `callPackage` will be called with the modified values"
(https://github.com/NixOS/nixpkgs/blob/master/lib/customisation.nix). Python's
FAQ makes the same point for its set: after overriding through
`packageOverrides`, "All packages in the package set will use the renamed
package", and the scipy/BLAS example warns that overriding one package's
dependency without its siblings "will likely result in compilation issues"
(https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/python.section.md).
The check: after the change, evaluate a dependent's input
(`nix eval .#perlPackages.PerlCritic.propagatedBuildInputs` or its
`.drvPath`) and confirm it now refers to the new version.

**[defect] After `overrideAttrs` changes `version` or `src`, `name` must match
what is built.** `mkDerivation` derives `name` from `pname` and `version`
(https://github.com/NixOS/nixpkgs/blob/master/doc/stdenv/stdenv.chapter.md,
"Using stdenv"), but helpers can fix it earlier: `buildPerlPackage` computes
`name = "perl${perl.version}-${attrs.pname}-${attrs.version}"` from its
original arguments, not from `finalAttrs`, and forbids passing `name`
(https://github.com/NixOS/nixpkgs/blob/master/pkgs/development/perl-modules/generic/default.nix).
Overriding only `version` there leaves the store name on the old version; overriding
only `version` on a package whose `src` was computed from the original version
(through `rec` or a `let`) rebuilds the old source under a new label. The
check: `nix eval .#<pkg>.name` and the `src` URL both show the new version.

**[defect] A package that others may override uses `finalAttrs`, not `rec`.**
"The `rec` keyword works at the syntax level and is unaware of overriding"
(stdenv chapter, "Fixed-point arguments of mkDerivation"); a later
`overrideAttrs { version = ...; }` does not reach a `src` that read `version`
through `rec`.

**[defect] In an overlay, take the package being replaced from `prev` and its
dependencies from `final`.** The overlays chapter assigns `final` to
"dependencies of all packages specified in your overlay" and `prev` to
"packages you wish to override" and to Nixpkgs functions
(https://github.com/NixOS/nixpkgs/blob/master/doc/using/overlays.chapter.md).
Defining `foo` from `final.foo` is a self-reference and fails with infinite
recursion.

**[silence] Every override of an upstream package names its exit condition** —
the upstream release or nixpkgs revision after which it is deleted. An
override with no exit condition outlives the bug it worked around and later
pins a security fix out.

## Language: scope, recursion and merging

**[defect] No `with` at the top of a file or around a module body.** It hides
where names come from and defeats static analysis
(https://nix.dev/guides/best-practices). It also resolves silently in the
wrong direction: names bound by `let` or function arguments are not shadowed
by `with`, while an outer `with` *is* shadowed by an inner one
(https://nix.dev/manual/nix/latest/language/syntax#with-expressions). A local
`with pkgs; [ ... ]` around a package list is the accepted narrow form.

**[defect] Avoid `rec { }`; use `let ... in`.** In a recursive set attributes
enter the lexical scope, so `x = x + 1` or a shadowed name produces
`infinite recursion encountered`
(https://nix.dev/manual/nix/latest/language/syntax#recursive-sets,
https://nix.dev/guides/best-practices).

**[defect] `//` is shallow.** A nested key on the left is dropped when the
right side has the same top-level key; use `lib.recursiveUpdate` for nested
configuration (https://nix.dev/guides/best-practices).

**[defect] `src = ./.` names the store path after the directory.** A rename
or a different checkout name rebuilds everything; wrap it in `builtins.path`
with a fixed `name` (https://nix.dev/guides/best-practices).

**[silence] Import from derivation is stated where it is introduced.** IFD
happens when a store path produced by a build is read by `import` or
`builtins.readFile` during evaluation; evaluation pauses to build it, and
because the evaluator is sequential these builds run one at a time
(https://nix.dev/manual/nix/latest/language/import-from-derivation). Setting
`allow-import-from-derivation = false` turns it into an error (default `true`,
https://nix.dev/manual/nix/latest/command-ref/conf-file#conf-allow-import-from-derivation).
Generators run at evaluation time (`callPackage` on the output of a
`*2nix` tool built in the same evaluation, `readFile` of a build result) are
the usual entry.

**[trade-off] IFD vs committed generated Nix.** IFD keeps the generated code
out of the repository and always current; it makes every evaluation (including
`nix flake show` and `nix flake check`) build first, and fails where IFD is
disabled. Committing the generated file evaluates fast and is reviewable; it
drifts unless a check regenerates and compares it.

## Module system

**[defect] Condition a definition on configuration with `mkIf`, never
`if ... then ... else`.** When the condition reads `config`, an `if` around
the definition makes the value depend on itself; `mkIf` pushes the condition
down into the individual definitions
(https://github.com/NixOS/nixpkgs/blob/master/nixos/doc/manual/development/option-def.section.md,
"Delaying Conditionals"). Use `mkMerge` to return several definition sets from
one module.

**[defect] `imports` must not depend on `config`, `pkgs` or `_module.args`.**
Imports "must be computed statically before anything else"; values needed
during import resolution go through `specialArgs`, and the module system's own
error context says an infinite recursion there usually means `config` is
referenced in `imports` (https://github.com/NixOS/nixpkgs/blob/master/lib/modules.nix).
This covers `imports = lib.optional pkgs.stdenv.hostPlatform.isDarwin ./x.nix`.

**[defect] A priority override needs a stated reason.** Definitions have
priority 100, option defaults 1500, `mkDefault` is `mkOverride 1000` and
`mkForce` is `mkOverride 50`; only the lowest number survives and the rest are
discarded (option-def section, "Setting Priorities"). `mkForce` therefore
silences a real conflict instead of resolving it, and `mkDefault` in a
library module is what lets a consumer override without `mkForce`. Ordering
(`mkBefore` = `mkOrder 500`, `mkAfter` = `mkOrder 1500`) controls position in
a merged list, not inclusion (same section, "Ordering Definitions").

**[defect] Option types decide how definitions merge.** `types.str` cannot be
merged — two different definitions are an error — while `types.lines`
concatenates with newlines; `types.attrs` merges with a shallow `//` that
silently drops earlier nested definitions and is slated for deprecation; use
`types.attrsOf <type>` or a `submodule`
(https://github.com/NixOS/nixpkgs/blob/master/lib/types.nix). A new option
declared as `types.attrs` is a finding.

## home-manager files and activation

**[defect] `mkOutOfStoreSymlink` in a flake is given an absolute path string,
not a path literal.** The function runs `ln -s` on `toString path`
(https://github.com/nix-community/home-manager/blob/master/modules/files.nix);
in a flake a path literal such as `./nvim` refers to the flake's copy in the
store, so the link points into the store and edits in the checkout never
appear. Pass a string built from a known checkout location — community
reports agree (https://discourse.nixos.org/t/how-to-manage-dotfiles-with-home-manager/30576);
the home-manager source has no warning about it.

**[trade-off] Store copy vs out-of-store symlink.** A plain `home.file.<n>.source`
copies into the store: reproducible, rolled back with the generation, read-only.
`mkOutOfStoreSymlink` links to the working tree: edits apply without a switch,
but the target is outside the generation, is not rolled back, and breaks when
the checkout moves or is missing on another machine.

**[defect] `home.file.<n>.force = true` overwrites whatever is at the target.**
The source marks forced paths "Caveat emptor!" and skips the collision check
for them (files.nix). Prefer a backup extension; flag `force` on a target the
user may have edited.

**[defect] Activation entries are idempotent, write only after
`writeBoundary`, and honour `DRY_RUN`.** home-manager requires entries that
produce the same result when run twice, allows only verification before
`writeBoundary`, and requires side effects to come after it; commands go
through `run` so a dry run prints them
(https://github.com/nix-community/home-manager/blob/master/modules/home-environment.nix,
`home.activation`). The check: run the switch twice and diff the target;
look for `>>` appends, `mkdir` without `-p`, unguarded `git clone`, network
fetches with no existence check, and raw commands not wrapped in `run`.

**[defect] `home.stateVersion` is not bumped as part of an upgrade.** It
records the release the configuration is compatible with, and Home Manager is
updated without changing it
(https://github.com/nix-community/home-manager/blob/master/docs/manual/usage/configuration.md).
A bump must come with the release notes' state-version changes checked.

## nix-darwin activation

**[defect] nix-darwin activation runs as root.** Since 2025-01-30 all system
activation runs as `root`, `darwin-rebuild` must be run as root, user-scoped
options apply to `system.primaryUser`, and
`system.activationScripts.{extraUserActivation,preUserActivation,postUserActivation}`
were removed (https://github.com/nix-darwin/nix-darwin/blob/master/CHANGELOG).
A new activation script that writes into a home directory creates root-owned
files there; per-user state belongs in home-manager.

**[defect] Turning `homebrew.onActivation.cleanup` to `uninstall` or `zap` is
a finding until the change lists what it will remove.** Both remove every
package not in the generated Brewfile, and `zap` also removes casks'
associated files; `check` aborts the whole activation while extras exist; the
default `none` leaves them installed. `autoUpdate` and `upgrade` default to
`false`, which keeps repeated switches idempotent
(https://github.com/nix-darwin/nix-darwin/blob/master/modules/homebrew.nix).

## Flake inputs and lock bumps

**[defect] Every input that takes `nixpkgs` follows the top-level one unless
the diff says why not.** Without `follows`, each input evaluates its own
nixpkgs — roughly 100 MiB of memory and a second of evaluation each
(https://zimbatm.com/notes/1000-instances-of-nixpkgs) — and its packages are
built against a different revision than the rest of the system. `follows`
takes a `/`-separated input path
(https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake).

**[trade-off] `follows` vs the input's own nixpkgs.** Following shares one
evaluation and one set of library versions; it also builds the input against
a nixpkgs its authors did not test, which breaks inputs that track nixpkgs
package names closely (CUDA toolchains are a common case). Not following is
correct when the input's CI pins its own revision and binary cache.

**[silence] A `flake.lock` bump says which inputs moved and what that changed
in the result.** `nix store diff-closures <old> <new>` lists packages added,
removed or changed in version, with size changes above 8 KiB
(https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-store-diff-closures).
A nixpkgs bump that rides along with an unrelated change hides version jumps
in the closure. Hash and origin changes in the lock are
`supply-chain-review`'s `supply:lockfile-integrity-change`.

## Unfree and insecure packages

**[trade-off] Global `allowUnfree = true` vs naming packages.** The nixpkgs
manual's route for specific packages is a name list (`allowUnfreePackages`) or
`allowUnfreePredicate`
(https://github.com/NixOS/nixpkgs/blob/master/doc/using/configuration.chapter.md,
"Installing unfree packages"). A global flag is one line and never blocks a
build; a list makes every new unfree package a visible diff. Unfree packages
"cannot be included in the Nixpkgs channel"
(https://github.com/NixOS/nixpkgs/blob/master/doc/stdenv/meta.chapter.md), so
they are built locally rather than fetched from the binary cache — a cost
either way.

**[defect] `permittedInsecurePackages` and `allowInsecurePredicate` are not
both set.** The list "is only checked if `allowInsecurePredicate` is not
specified" (configuration chapter, "Installing insecure packages"). An entry
is a package marked insecure through `meta.knownVulnerabilities` (meta
chapter); each allowance names the exact `name-version`, the reason, and when
it is removed.

**[defect] Do not rely on `NIXPKGS_ALLOW_UNFREE` or `NIXPKGS_ALLOW_INSECURE`
in a flake.** Both are environment reads; in pure evaluation they read `""`
(the `getEnv` rule above), so the build works only for whoever passes
`--impure`. Put the allowance in the Nixpkgs `config`.

## Platform conditionals

**[defect] Use `stdenv.hostPlatform.is*`, not `stdenv.is*`.** nixpkgs
`master` wraps `stdenv.isDarwin`, `isLinux`, `isAarch64` and the rest in
"stdenv.${name} is deprecated, use stdenv.hostPlatform.${name} instead"
(added 2026-05-09,
https://github.com/NixOS/nixpkgs/blob/master/pkgs/stdenv/generic/default.nix).
The cross-compilation chapter defines `hostPlatform` as where the package will
run and `buildPlatform` as where it is built, and prefers the platform
predicates over the `stdenv` shorthands
(https://github.com/NixOS/nixpkgs/blob/master/doc/stdenv/cross-compilation.chapter.md).
A tool that runs during the build is conditioned on `buildPlatform`.

**[defect] Filter packages by `meta.platforms`, not by a hand-kept list.**
`lib.meta.availableOn` tests a package against a platform using
`meta.platforms` and `meta.badPlatforms` (meta chapter). A conditional that
names a system string duplicates what the package already declares and goes
stale when upstream adds a platform.

## Tool coverage

Run in this order and pass the output on; a rule a tool covers is read from
the tool's output, not re-derived by hand. The order is this skill's
reasoning, not a vendor rule: the first three only parse and are fast, and
nixfmt fails on a parse error, so it doubles as the syntax gate; formatting
goes first so a reformat does not mix with lint findings; evaluation comes
last because it is the slowest and needs the inputs.

| Order | Tool | Covers here |
|---|---|---|
| 1 | `nixfmt --check` (nixfmt 1.5.0, the RFC 166 standard format; `nixfmt-tree` wraps it in treefmt) | formatting. nixfmt is "the official formatter for Nix language code" (https://github.com/NixOS/nixfmt); RFC 166 has Nixpkgs CI enforce it (https://github.com/NixOS/rfcs/blob/master/rfcs/0166-nix-formatting.md) |
| 2 | `statix check` | W01 bool_comparison, W02 empty_let_in, W03 manual_inherit, W04 manual_inherit_from, W05 legacy_let_syntax, W06 collapsible_let_in, W07 eta_reduction, W08 useless_parens, W10 empty_pattern, W11 redundant_pattern_bind, W12 unquoted_uri, W14 empty_inherit, W17 deprecated_to_path, W18 bool_simplification, W19 useless_has_attr, W20 repeated_keys, W23 empty_list_concat (from `statix list`, statix 0.5.8-unstable-2026-07-17; the upstream README lists 15 and points to `statix list` and says the project is now hosted at tangled.org, https://github.com/oppiliappan/statix). Style only — none of this skill's defects |
| 3 | `deadnix --fail` | unused `let` bindings, lambda arguments and pattern names (https://github.com/astro/deadnix). Use `-L` so `callPackage` pattern names are not reported; overlay `final: prev:` arguments are reported when unused (seen on this run) — rename to `_final` or pass `-l` |
| 4 | `nix flake check` | evaluates every output and builds `checks` (https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-flake-check); catches `mkIf` recursion, option type conflicts, `imports` recursion, deprecation warnings, removed nix-darwin options, a fake hash (when the fetcher is in a built check) |
| 5 | `nix store diff-closures` on the built system | what a lock bump or override changed |
| — | none (reviewer) | `getEnv` without an empty check, hash not changed with url/rev, scope override that dependents miss, `name`/`src` drift, `rec` in overridable packages, top-level `with`, IFD, priority overrides, out-of-store path literals, non-idempotent activation, `follows`, unfree/insecure allowances |

## Related

- `supply-chain-review` — lock-file integrity, the origin of new flake inputs
  and fetcher sources, need for a new dependency.
- `shell-patterns` — the shell inside activation scripts and builders.
- `github-actions-patterns` — Nix steps in CI workflows.
