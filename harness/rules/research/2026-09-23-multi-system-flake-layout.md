---
question: "一つの dotfiles リポジトリを macOS（nix-darwin + home-manager、Apple Silicon）と Linux（omarchy/Arch 系の別 PC、将来は NixOS の可能性も）の複数機で使うとき、2026 年の業界は Nix flake をどう構成しているか。この持ち主の flake（darwinConfigurations.<user>-mac 一つ、system = \"aarch64-darwin\" 固定、home-manager を darwin module として読み込み）から、どの形に移るのが業界標準か。"
date: 2026-09-23
verdict: "ホスト単位（hostname キー）で分岐する共有 mkSystem 関数へ移行し、Omarchy/Arch 機は home-manager を darwin module としてではなく standalone の homeConfigurations として追加する。forAllSystems/genAttrs は packages・devShells・formatter など per-system 出力にだけ使い、darwinConfigurations/nixosConfigurations/homeConfigurations をそれで生成しない。builtins.getEnv \"USER\" は業界のどの実例にも無く、ユーザー名は固定文字列にする。"
unverified:
  - "同じ dotfiles を 1 年以上 macOS + 実機 Arch/Omarchy で運用し続けている『枯れた』実例 — 見つかったのは 2 日前にマージされたばかりの実例 1 件のみ"
  - "この所有者と同じ「macOS が nix-darwin、Linux が standalone home-manager」の組み合わせを一度採用してから撤回した/元に戻した一次情報の実例"
  - "home-manager launchd.agents / systemd.user.services オプションを実際に個人 dotfiles で使っている実例（今回見つかった実践者はいずれも launchd.agents 未使用、独自の plist/systemd unit 手書きのまま）"
  - "Omarchy 実機上で home-manager を『フル移行』(home.nix 全ドメインを持ち込む)している実例 — 見つかった唯一の実例は明示的に部分適用（CLI パッケージのみ、Hyprland/git/btop は対象外）"
  - "x86_64-linux（この所有者の実機 Omarchy PC は Intel i9-12900K）向けの cache.nixos.org ヒット率やインストール時間の実測（2026-09-22 の box 裁定の実測は aarch64-linux の Docker サンドボックス向けで、実機 Omarchy PC のアーキテクチャとは別物）"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 複数機（macOS + Linux）で一つの Nix flake をどう構成するか (2026-09-23)

Question: 一つの dotfiles リポジトリを macOS（nix-darwin + home-manager、Apple Silicon）と Linux（omarchy/Arch 系の別 PC、将来は NixOS の可能性も）の複数機で使うとき、2026 年の業界は Nix flake をどう構成しているか（system ごと・host ごとの出力の分け方、共有 home-manager モジュール、OS 分岐、launchd/systemd の常駐サービスの書き分け）。この持ち主の flake（`core/nix/flake.nix`: `darwinConfigurations.<user>-mac` 一つ、`system = "aarch64-darwin"` 固定、home-manager を darwin module として読み込み、domain ごとの `home.nix`/`homebrew.nix`）から、どの形に移るのが業界標準か。

## 0. Method and verification legend

- `[direct]` — fetched and read verbatim via `curl`/raw GitHub content or the GitHub REST API (with `gh auth token`), not summarized by an LLM step.
- `[summarized]` — reached via the WebFetch tool, which runs the page through a small model before returning text; treated as lower-confidence, flagged inline.
- `[local]` — a fact read directly from this repository's own files (context, not evidence for what's "correct" per the four-lenses rule).
- `[unreachable]` — attempted and failed (403, JS-rendered redirect page, 404); listed explicitly, not silently dropped.
- Repo/session note: this research subagent runs inside the git worktree `harness-parity` (branch `feat/jig-harness`), which is 92 commits behind `main` and has **no** `rules/research/INDEX.md`, `README.md`, or `rules/decisions/` directory checked out yet (those files exist on `main`, read via their absolute path in the primary checkout). The write sandbox only allows writes under this worktree's cwd, so this record and its `INDEX.md` entry are written into the worktree tree; `INDEX.md` was reconstructed from `main`'s current content (read directly) plus this record's new line, not invented.
- WebSearch was unavailable for this task — the session's search budget (200/session) was already exhausted before this research began. All lookups below use WebFetch, `curl`, and `gh api`/`gh search` instead; this is noted, not hidden.

Context read `[local]` before researching: `core/nix/flake.nix` (single `darwinConfigurations.${hostname}`, `system = "aarch64-darwin"` hardcoded, `username = builtins.getEnv "USER"` requiring `--impure`, falls back to `"ci"`), `core/nix/darwin.nix` (`system.primaryUser`, `ids.gids.nixbld`, `homebrew.enable`), `core/nix/home.nix` (thin, `home.username = username`), `domains/{dev,workspace,infra,creative,system}/packages/home.nix` (five domain package lists, three of them use `pkgs.brewCasks` — a Darwin-only overlay from `brew-nix` — inline with cross-platform CLI packages, no `isDarwin`/`isLinux` gating anywhere), `domains/dev/packages/homebrew.nix` (entirely Darwin-only: Homebrew brews/casks, correctly has no Linux equivalent), `domains/dev/config/litellm/com.<user>.litellm-proxy.plist` + `litellm-up.sh` and `domains/dev/config/lmstudio/` (macOS `launchd` background services, deployed by hand-rolled shell templating — `core/config/manager.sh`'s `link_launch_agents()`/`install_expanded`, copying `.plist` files with `{{HOME}}` token substitution into `~/Library/LaunchAgents`, entirely outside home-manager). The prior ruling `rules/decisions/2026-09-22-tools-nix-list-box-subset.md` already commits to splitting the Nix package list into `{ pkgs }: { cli; lsp; darwinOnly; }` buckets and to a `packages.aarch64-linux.box` output for a **Docker Sandboxes** Linux **arm64** microVM — a different Linux target from the real Omarchy PC in this question, which per the user's own memory record (`omarchy-dual-boot-plan.md`) is an Intel i9-12900K machine, i.e. **x86_64-linux**, not aarch64-linux.

---

## 1. Vendors

### 1.1 nix-darwin: single-host example, no multi-host pattern in the README itself

`[summarized]` The nix-darwin README's flake.nix example is: `darwinConfigurations."Johns-MacBook" = nix-darwin.lib.darwinSystem { modules = [ ./configuration.nix ]; };` — one hardcoded hostname, one host. The README text (per the WebFetch summary) instructs replacing the hostname but does not itself show a second `darwinConfigurations` entry or a parameterized `system`. Source: https://github.com/nix-darwin/nix-darwin (README fetched via WebFetch; raw README fetch also returned the same single-example summary — `[unreachable]` for a fuller reading, the raw markdown fetch was likewise routed through the summarizer both times). **This means the "how do I add a second host" pattern is not vendor-documented in nix-darwin's own README — it is a practitioner convention (§2), not a vendor-blessed one.**

### 1.2 home-manager: launchd.agents and systemd.user.services are real, symmetrical, platform-gated options

`[direct]`, `https://raw.githubusercontent.com/nix-community/home-manager/master/modules/launchd/default.nix`:
```
inherit (pkgs.stdenv.hostPlatform) isDarwin;
...
      default = isDarwin;
      defaultText = lib.literalExpression "pkgs.stdenv.hostPlatform.isDarwin";
...
      assertions = [
        {
          assertion = (cfg.enable && agentPlists != { }) -> isDarwin;
          message = ... "Must use Darwin for modules that require Launchd: " + names;
        }
      ];
```
`launchd.enable` defaults to `isDarwin`; if you declare `launchd.agents.*` and `launchd.enable` ends up true on a non-Darwin system, the module hard-fails eval with an assertion, not a silent no-op. Agents write out under `~/Library/LaunchAgents` with label prefix `org.nix-community.home.` (same file, `dstDir = "${config.home.homeDirectory}/Library/LaunchAgents"`, `labelPrefix = "org.nix-community.home."`).

`[direct]`, `https://raw.githubusercontent.com/nix-community/home-manager/master/modules/systemd.nix`:
```
assertions = [
  (lib.hm.assertions.assertPlatform "systemd" pkgs lib.platforms.linux)
];
...
enable = mkEnableOption "the user systemd service manager" // {
  default = pkgs.stdenv.hostPlatform.isLinux;
  defaultText = literalExpression "pkgs.stdenv.hostPlatform.isLinux";
};
```
**This is the exact vendor answer to "how does home-manager tell you it's writing the wrong service manager for this OS": `lib.hm.assertions.assertPlatform` on the Linux side, a hard Darwin-only assertion on the launchd side, and both `enable` options default from `pkgs.stdenv.hostPlatform.isDarwin`/`isLinux` rather than needing to be set by hand per host.** Neither option is currently used anywhere in this repo — the litellm/lmstudio launchd services are hand-templated `.plist` + shell (`manager.sh link_launch_agents`), entirely outside Nix/home-manager.

### 1.3 flake-parts: `perSystem`, explicit multi-OS `systems` lists including `aarch64-darwin`

`[summarized]`, https://flake.parts/system: "Many things, such as packages, can exist on multiple systems. For these, use the `perSystem` submodule." Example systems list quoted from the page: `systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];` — i.e. flake-parts' own reference example lists a Darwin system alongside two Linux systems as an ordinary case, not a special one.

Adoption signal (§4): `gh search` for `flake-parts.lib.mkFlake` inside `flake.nix` files returns 15,808 hits vs 19,712 for the older `forAllSystems` idiom (§1.5) — flake-parts is a large, real, but still minority convention relative to hand-rolled `forAllSystems`.

### 1.4 nix-darwin/NixOS docs do not show `nixosConfigurations` + `darwinConfigurations` together

No nix-darwin or NixOS manual page found (attempts below) shows the *vendor* itself demonstrating a combined `darwinConfigurations` + `nixosConfigurations` flake — that combination is entirely a practitioner pattern (§2), never a documented "supported recipe" from either project. `[unreachable]`: https://nixos.org/manual/nixos/stable/index.html#sec-flake-config (fetched, contains no flake-output section in the crawled content) and https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake.html (fetched, confirms only the generic contract "`packages.x86_64-linux` must be an attribute set of derivations built for the `x86_64-linux` platform" — no `nixosConfigurations`/`darwinConfigurations` keying guidance at all). https://nixos.wiki/wiki/Flakes returned HTTP 403 `[unreachable]`.

### 1.5 flake-utils: `forAllSystems`/`eachDefaultSystem` is for *per-system* outputs; it explicitly must NOT be used for host configs

`[direct]`, https://raw.githubusercontent.com/numtide/flake-utils/master/README.md — the README's own example contrasts the two:
```
inputs.flake-utils.lib.eachDefaultSystem (system: {
  checks./*<SYSTEM>.*/"<CHECK>" = /* ... */;
  devShells./*<SYSTEM>.*/"<DEV_SHELL>" = /* ... */;
  packages./*<SYSTEM>.*/"<PACKAGE>" = /* ... */;
})
// inputs.flake-utils.lib.eachDefaultSystemPassThrough (system: {
  homeConfigurations."<HOME_CONFIGURATION>" = /* ... */;
  nixosConfigurations."<NIXOS_CONFIGURATION>" = /* ... */;
})
```
`eachSystemPassThrough`/`eachDefaultSystemPassThrough` exist specifically because `homeConfigurations`/`nixosConfigurations`/`darwinConfigurations` are keyed by **host or user@host name**, not by system string, and must not get a `.${system}` level injected. `defaultSystems` = `x86_64-linux`, `aarch64-linux`, `x86_64-darwin`, `aarch64-darwin` (same file). This is the single clearest piece of vendor-adjacent evidence against naively wrapping the top-level `darwinConfigurations`/`nixosConfigurations` attrset in a `forAllSystems`/`genAttrs`-over-systems call — every practitioner example in §2 that does key host configs by system string (dustinlyons, §2.2) does it because each of their hosts corresponds 1:1 to a system (one Mac per architecture).

### 1.6 Nix's own pure-eval design and why `builtins.getEnv "USER"` needs `--impure`

`[summarized]`, https://nix.dev/manual/nix/2.28/command-ref/conf-file.html#conf-pure-eval: "Pure evaluation mode ensures that the result of Nix expressions is fully determined by explicitly declared inputs, and not influenced by external state." Flakes evaluate under this pure-eval contract by default (hence this repo's own comment "Falls back to `\"ci\"` in pure evaluation (e.g., CI without `--impure`)" `[local]`). Background friction, not a fix: `https://github.com/NixOS/nix/issues/12493` (open, "More granular pure-eval" — a user wants selective impure-builtin allow-listing instead of the current all-or-nothing `--impure`) and `https://github.com/NixOS/nix/issues/6684` (closed, demonstrates `~`-paths silently pick up `$HOME` even under flakes' pure eval — the same class of "impurity leaks through a path/env read" problem `builtins.getEnv "USER"` has). Vendor position, in short: reading `$USER`/`$HOME` inside a flake is a known, still-imperfectly-closed impurity hole, not a supported pattern — which matches that **zero** of the four independent practitioner flakes read in §2 use `builtins.getEnv` for the username; all four hardcode it as a plain string.

---

## 2. Practitioners

### 2.1 Mitchell Hashimoto (`mitchellh/nixos-config`) — shared `mkSystem` function, hostname-keyed, boolean OS flag

`[direct]`, 3,109 stars, pushed 2026-09-05 (`https://api.github.com/repos/mitchellh/nixos-config`). `https://raw.githubusercontent.com/mitchellh/nixos-config/main/lib/mksystem.nix`:
```
name:
{ system, user, darwin ? false, wsl ? false }:
let
  isLinux = !darwin && !isWSL;
  systemFunc = if darwin then inputs.darwin.lib.darwinSystem else nixpkgs.lib.nixosSystem;
  home-manager = if darwin then inputs.home-manager.darwinModules else inputs.home-manager.nixosModules;
in systemFunc {
  ...
  modules = [ ... ] ++ optionals isLinux [ inputs.nix-snapd.nixosModules.default ]
    ++ [ machineConfig userOSConfig
         home-manager.home-manager { home-manager.users.${user} = import userHMConfig { ... }; } ];
}
```
Called as `darwinConfigurations.macbook-pro-m1 = mkSystem "macbook-pro-m1" { system = "aarch64-darwin"; user = "mitchellh"; darwin = true; };` `[summarized fetch of flake.nix outputs, cross-checked directly against mksystem.nix]`. **One function, one boolean flag, picks `darwinSystem` vs `nixosSystem` and `home-manager.darwinModules` vs `.nixosModules`, and imports the *same* `userHMConfig` home-manager file on both.** This is the closest single-file match to "how do I make my existing `home.nix` work on both OSes without duplicating it" in the entire survey. `user` is a plain string, never read from environment.

### 2.2 Dustin Lyons (`dustinlyons/nixos-config`) — host configs keyed by *system string*, not hostname

`[direct]`, 3,626 stars, pushed 2026-09-16. `https://raw.githubusercontent.com/dustinlyons/nixos-config/main/flake.nix`:
```
linuxSystems = [ "x86_64-linux" "aarch64-linux" ];
darwinSystems = [ "aarch64-darwin" "x86_64-darwin" ];
forAllSystems = f: nixpkgs.lib.genAttrs (linuxSystems ++ darwinSystems) f;
...
darwinConfigurations = nixpkgs.lib.genAttrs darwinSystems (system: darwin.lib.darwinSystem { inherit system; ... });
```
This is a real, popular counter-example to §1.5's warning: it keys `darwinConfigurations`/(similarly) `nixosConfigurations` directly by system string via `genAttrs`, which only works because this template assumes **one machine per architecture** (one Mac, one Linux box) and a single fixed `user = "dustin";` (hardcoded, top of the `let`). It would break the moment someone wants two Macs. Mixed evidence: it's the second-most-starred example found and demonstrates `forAllSystems` *can* be pushed onto host configs, at the cost of the one-host-per-arch constraint that §1.5's vendor guidance exists to avoid.

### 2.3 Misterio77 (`nix-starter-configs`, by a home-manager co-maintainer) — the "textbook" split: `forAllSystems` for packages only, hostname/`user@host` for configs

`[direct]`, 3,837 stars, pushed 2026-04-24 (`Misterio77/nix-starter-configs`; note `Misterio77/nix-config` does not exist under that name — the correct repo is `nix-starter-configs`, confirmed via `gh search repositories`). `https://raw.githubusercontent.com/Misterio77/nix-starter-configs/main/standard/flake.nix`:
```
systems = [ "aarch64-linux" "i686-linux" "x86_64-linux" "aarch64-darwin" "x86_64-darwin" ];
forAllSystems = nixpkgs.lib.genAttrs systems;
...
packages = forAllSystems (system: import ./pkgs nixpkgs.legacyPackages.${system});
formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.alejandra);
...
nixosConfigurations = {
  your-hostname = nixpkgs.lib.nixosSystem { ... modules = [ ./nixos/configuration.nix ]; };
};
homeConfigurations = {
  "your-username@your-hostname" = home-manager.lib.homeManagerConfiguration {
    pkgs = nixpkgs.legacyPackages.x86_64-linux; # FIXME replace x86_64-linux with your architecture
    modules = [ ./home-manager/home.nix ];
  };
};
```
This confirms §1.5 exactly, from a source close to home-manager's own maintainers: `forAllSystems` only ever touches `packages`/`formatter`; `nixosConfigurations`/`homeConfigurations` stay hostname/`user@hostname`-keyed with a literal `# FIXME replace with your hostname` comment, i.e. the vendor-adjacent expectation is that a human types the real hostname in, not that it's generated.

### 2.4 Ryan Yin (`ryan4yin/nix-config`) — `hosts/darwin-<name>` directory convention, per-system output directories, complex but consistent with §1.5/2.3

`[direct]`, 2,065 stars, pushed 2026-09-23 (today, actively maintained). Directory layout: `hosts/darwin-fern/`, `hosts/darwin-frieren/` for the two Macs, `hosts/12kingdoms-*`, `hosts/idols-*` for NixOS machines (`https://api.github.com/repos/ryan4yin/nix-config/contents/hosts`). `outputs/default.nix` `[direct]`:
```
nixosSystems = { x86_64-linux = import ./x86_64-linux (...); aarch64-linux = import ./aarch64-linux (...); };
darwinSystems = { aarch64-darwin = import ./aarch64-darwin (...); };
allSystems = nixosSystems // darwinSystems;
forAllSystems = func: (nixpkgs.lib.genAttrs (builtins.attrNames allSystems) func);
...
nixosConfigurations = lib.attrsets.mergeAttrsList (map (it: it.nixosConfigurations or { }) nixosSystemValues);
darwinConfigurations = lib.attrsets.mergeAttrsList (map (it: it.darwinConfigurations or { }) darwinSystemValues);
packages = forAllSystems (system: allSystems.${system}.packages or { });
devShells = forAllSystems (...);
formatter = forAllSystems (...);
```
Same shape as §2.3 at larger scale: `forAllSystems` drives `packages`/`devShells`/`checks`/`formatter`; `nixosConfigurations`/`darwinConfigurations` are built by merging per-system-directory host lists, never generated by iterating systems. `hosts/darwin-fern/default.nix` is a 12-line file that sets `networking.hostName`/`computerName` and nothing else — the heavy lifting is in shared modules. This repo uses `haumea` for auto-loading and `colmena` for remote deploy, both add real complexity beyond what a 2-host personal setup needs — flagged as a caveat, not a recommendation to copy wholesale.

### 2.5 sanketsudake/dotfiles — the one precedent that is *this exact* combination (macOS nix-darwin + real Omarchy/Arch box via standalone home-manager)

`[direct]`, PR merged 2026-09-21 (two days before this record), repo has 4 stars (`sanketsudake/dotfiles`), author is a named individual (Sanket Sudake, bio "Contributing to @fission", 125 followers) — not a large or long-lived project, and the PR body itself is machine-authored ("🤖 Generated with Claude Code"), so this is weighted as **in-the-wild evidence (§4)**, not an independent practitioner essay, but it is read in full here because no other source matches the exact shape of this question. `https://raw.githubusercontent.com/sanketsudake/dotfiles/main/flake.nix`:
```
mkDarwinHost = extraModules: nix-darwin.lib.darwinSystem {
  modules = [ ./nix/darwin inputs.home-manager.darwinModules.home-manager
    { home-manager = { useGlobalPkgs = true; useUserPackages = true; backupFileExtension = "hm-backup";
                        users.sanketsudake = import ./nix/home; }; } ] ++ extraModules;
};
# Non-NixOS Linux hosts: standalone home-manager over the distro (no system layer).
mkHomeHost = system: hostModule: inputs.home-manager.lib.homeManagerConfiguration {
  pkgs = nixpkgs.legacyPackages.${system};
  modules = [ ./nix/home hostModule ];
};
...
darwinConfigurations."Sankets-MacBook-Air" = mkDarwinHost [ ];
homeConfigurations."chronin@chronin" = mkHomeHost "x86_64-linux" ./nix/hosts/omarchy.nix;
packages.x86_64-linux.home-manager = inputs.home-manager.packages.x86_64-linux.default;
```
Load-bearing details from the PR body (`https://github.com/sanketsudake/dotfiles/pull/88`, merged):
- "Runs the same `nix/home` tree on an Omarchy (Arch Linux) laptop as a standalone home-manager config, with pacman/yay for system packages. The Mac setup stays the same."
- `packages.x86_64-linux.home-manager` pins the home-manager **CLI itself** through the flake, so the Linux box needs nothing separately installed beyond `nix` — this directly answers "how does home-manager get bootstrapped on Arch" without a system-wide channel/install step.
- Negative/caveat, verbatim: **"Omarchy-owned paths (`~/.config/hypr`, `~/.config/git/config`, `btop.conf`) are not managed."** — i.e. even in the one real precedent, home-manager is applied *narrowly* (CLI packages, a `dotfiles.omarchy` option-gated subset) specifically because Omarchy's own installer/updater already owns large parts of `~/.config`; fighting that ownership is called out as the one place they deliberately broke their own "never link over `~/.config/hypr`" rule, and only for a single OSD service.
- `nix/home/options.nix` defines a repo-local `dotfiles.omarchy` boolean option (`default = false`) rather than scattering `pkgs.stdenv.isDarwin`/`isLinux` checks through every module — an explicit, documented per-host knob pattern, with the comment "Defaults reproduce the Mac exactly; a host module ... overrides what differs."
- Makefile branches on `uname -s` for `nix-build`/`nix-switch`/`nix-rollback`; bootstrap script exits early on Linux; this is the same "wrapper script picks the right `nix` invocation per OS" pattern this repo already has in `core/config/manager.sh` `[local]`.

### 2.6 Negative/complicating practitioner signal: omarchy-nix (full NixOS reimplementation of Omarchy) is stale

`[direct]`, `henrysipp/omarchy-nix` — 802 stars, forks 68, **last pushed 2025-11-13**, over 10 months before this record — description "An opinionated NixOS config based on DHH's Omarchy." Discovered via a merged-but-not-yet-landed nix-darwin community docs PR (`https://github.com/omacom/omarchy/pull/11087`, open, not merged) which itself describes a *second*, newer competing NixOS port: "omarchy-nixos: a pure NixOS system configuration (no flakes, no home-manager) targeting NixOS 26.05" (`gaoqiaominfu/omarchy-nixos`). **Reading this together: the "replace Arch/Omarchy with a NixOS system that imitates its look" approach has two competing, both-young-or-stale community projects and no vendor backing from either the Omarchy or NixOS side — this is weaker ground than "keep Omarchy, layer standalone home-manager on top" (§2.5), which is the one approach with a from-scratch working, merged, current example.** This is directly relevant to the "将来は NixOS の可能性も" branch of the question: nothing found suggests that path is more mature or better-trodden than staying on Omarchy/Arch.

---

## 3. Measured / negative evidence

### 3.1 `home-manager install` failing on Arch Linux — real, but traced to a Nix core bug, not a home-manager/Arch design flaw

`[direct]`, `https://github.com/nix-community/home-manager/issues/4405` ("bug: home-manager install error on Arch Linux", closed). Reporter followed the documented standalone install exactly (`sudo pacman -S nix`, `nix-channel --add ... home-manager`, `nix-shell '<home-manager>' -A install`) and hit a build failure. Comment thread: "Can confirm" (a second reporter), then "relevant issue: NixOS/nix#8737, will be fixed in NixOS/nix#8936, so I guess just wait for the fix to be released on Arch." The issue was closed by stale-bot without a confirmed "fixed, works now" follow-up visible in the fetched comment thread — **this is genuinely negative evidence that the standalone install path has had real breakage on Arch specifically tied to the Arch-packaged Nix build**, not a hypothetical. `[unverified]`: whether the fix from `NixOS/nix#8936` has actually reached Arch's `nix` package as of 2026-09-23 — not checked, flagged as a gap, not asserted either way.

### 3.2 home-manager's own standalone-install doc has no Arch-specific caveat

`[summarized]`, https://nix-community.github.io/home-manager/installation/standalone.html: "Make sure you have a working Nix installation. Specifically, make sure that your user is able to build and install Nix packages" — the WebFetch summary explicitly states "The documentation does not mention any caveats specific to non-NixOS distributions like Arch." Read together with §3.1, the vendor doc is silent on a real, previously-reported distro-specific failure mode — a genuine documentation gap, stated plainly rather than inferred as malice or incompetence.

### 3.3 `builtins.getEnv "USER"` / impure username reads have open, unresolved upstream tension

Already covered in §1.6 (`NixOS/nix#12493` open, `#6684` closed-but-illustrative). No GitHub issue specifically titled around `builtins.getEnv "USER"` in a flake was found via `gh search issues` (`q="builtins.getEnv" "USER" flake.nix language:Nix` returned 42 results, none on-topic after inspection — mostly unrelated PRs matching individual keywords). **Absence, not presence, of a dedicated bug report is itself weak evidence: the practitioner convention of hardcoding the username (§2.1–2.5, 4-for-4) exists not because of one specific bug thread, but because pure evaluation is the documented default and `--impure` is a known, generally-avoided escape hatch** (§1.6).

### 3.4 Adoption-count comparison (measured via `gh search code`, GitHub's code-search index, 2026-09-23)

| Query (all `language:Nix filename:flake.nix`) | Hits |
|---|---|
| `darwinConfigurations nixosConfigurations` | 2,332 |
| `darwinConfigurations homeConfigurations` | 1,402 |
| `forAllSystems` | 19,712 |
| `flake-parts.lib.mkFlake` | 15,808 |
| `flake-parts darwinConfigurations` | 343 |

Caveats on these numbers: GitHub code search is not exhaustive (rate-limited sampling, no guaranteed completeness), and a flake.nix containing both keywords doesn't prove they're wired together correctly — this is a coarse adoption signal, not a correctness signal. Read plainly: combining Darwin + NixOS/home configs in one flake is a common, well-populated pattern (thousands of hits); pairing that combination specifically with flake-parts is a minority sub-pattern (343 of 2,332-ish, roughly 15%).

---

## 4. In the wild

### 4.1 Repo health snapshot (via `gh api repos/<owner>/<repo>`, 2026-09-23)

| Repo | Stars | Forks | Last push | Pattern |
|---|---|---|---|---|
| `mitchellh/nixos-config` | 3,109 | 249 | 2026-09-05 | shared `mkSystem`, hostname-keyed |
| `dustinlyons/nixos-config` | 3,626 | 202 | 2026-09-16 | `genAttrs` over systems, system-string-keyed |
| `Misterio77/nix-starter-configs` | 3,837 | (not captured) | 2026-04-24 | textbook `forAllSystems`-for-packages-only template, co-authored by a home-manager maintainer |
| `ryan4yin/nix-config` | 2,065 | 104 | 2026-09-23 (today) | `hosts/darwin-<name>/` dirs, per-system output dirs, haumea+colmena |
| `sanketsudake/dotfiles` | 4 | 0 | 2026-09-21 | exact match: nix-darwin Mac + standalone home-manager on real Omarchy/Arch, PR #88 merged |
| `henrysipp/omarchy-nix` | 802 | 68 | 2025-11-13 (stale, ~10 months) | full NixOS reimplementation of Omarchy's look — negative/stale signal |
| `gaoqiaominfu/omarchy-nixos` | not captured (found via an open, unmerged docs PR) | — | — | second, newer competing NixOS-native Omarchy port, "no flakes, no home-manager" |

`Misterio77/nix-config` (the name given in the task) does not exist as searched; the actual, correctly-named, more-starred repo is `Misterio77/nix-starter-configs`, confirmed via `gh search repositories?q=user:Misterio77+nix-config` returning `Misterio77/nix-starter-configs` (3,837★) and an unrelated 0-star `Misterio77/nixos-config-1`. Flagging the correction rather than silently substituting.

### 4.2 Issue-tracker skew, stated plainly

Issue trackers (used in §3.1) skew toward reported failures, not successes — the Arch install bug (§3.1) is real but a single multi-year-old thread with two "can confirm" voices, not a wave of reports; it should not be read as "home-manager on Arch is broadly broken today." Conversely, GitHub code search (§3.4) and repo stars (§4.1) skew toward *existence*, not toward *actually working long-term* — a starred, recently-pushed repo is evidence someone is actively maintaining it, not evidence it never broke along the way. No repo issue, discussion, or blog post was found in which a practitioner tried "one flake, macOS + real (non-NixOS) Linux box" and explicitly went back to separate configs — this negative-evidence category came back empty despite deliberate search (see the "no precedent found" list below), and that absence is reported as absence, not treated as proof no one has had that experience.

---

## 5. Summary table

| 観点 | 選択肢 | 数値/根拠 | 失敗モード/注意 |
|---|---|---|---|
| ホスト出力の分け方 | hostname キー（1機=1エントリ、共有関数で分岐） | mitchellh 3,109★・ryan4yin 2,065★・sanketsudake（唯一の完全一致例）が採用 | Misterio77 テンプレは "FIXME replace with your hostname" と明記 — 人が打つ前提 |
| ホスト出力の分け方（対抗） | system 文字列キー（`genAttrs` over systems） | dustinlyons 3,626★ | flake-utils 自身が `eachDefaultSystemPassThrough` を home/nixosConfigurations 用に別建てしている理由と矛盾する使い方。1アーキテクチャ=1台の制約下でのみ安全 |
| forAllSystems の適用範囲 | packages/devShells/formatter/checks のみ | flake-utils README 直接引用、Misterio77・ryan4yin とも一致 | darwinConfigurations/nixosConfigurations に適用した例は dustinlyons のみで例外的 |
| macOS 側の統合方法 | home-manager を darwin module として読み込み（現行どおり） | nix-darwin README・全実践者が採用、変更不要 | — |
| Linux(Arch/Omarchy) 側の統合方法 | standalone `homeConfigurations`（`homeManagerConfiguration`） | sanketsudake 唯一の実測例、`packages.x86_64-linux.home-manager` で CLI 自体を flake から供給 | home-manager がフル管理するのは CLI パッケージのみ — Omarchy 自身が持つ `~/.config/hypr` 等は意図的に対象外 |
| Linux 側の統合方法（対抗） | 実機を NixOS に置換し Omarchy の見た目だけ再現 | henrysipp/omarchy-nix 802★だが 2025-11-13 で停止、gaoqiaominfu/omarchy-nixos は未マージ PR 経由でしか確認できず | 両方とも vendor 非公認、成熟度が低い。この持ち主は既に Omarchy(Arch) を実機インストール済み（メモ記録） |
| OS 分岐の書き方 | `pkgs.stdenv.hostPlatform.isDarwin`/`isLinux` + `lib.mkIf`（home-manager 本体の慣習）／もしくはリポジトリ独自の bool option | home-manager の launchd/systemd モジュール自身がこの書式（`assertPlatform`, `default = isDarwin`）／sanketsudake は `dotfiles.omarchy` 独自 option | 現リポジトリはどちらも未使用（`brewCasks` を isDarwin ガード無しで直接埋め込み） |
| username の扱い | 固定文字列（`user = "mitchellh"` 等） | 読んだ4実践者全員が固定文字列、`builtins.getEnv` 使用例ゼロ | 現リポジトリの `builtins.getEnv "USER"` は `--impure` 必須、CI 用 `"ci"` フォールバックの自前ハックが既に存在 |
| launchd/systemd 常駐サービス | home-manager `launchd.agents`（darwin）/`systemd.user.services`（linux）のネイティブ option | vendor ソース直読（`modules/launchd/default.nix`, `modules/systemd.nix`）で確認、双方 `pkgs.stdenv.hostPlatform` から自動判定 | 実践者側の採用実例は今回見つからず。現リポジトリの litellm/lmstudio 常駐は home-manager 外の手書き plist + `manager.sh` シェルテンプレート |
| Linux 側の Nix 導入自体 | 標準インストーラ + standalone home-manager | home-manager 標準ドキュメントに Arch 固有の注意書きは無い | `home-manager/issues/4405`（Arch 上でインストール失敗、`NixOS/nix#8737` に起因、2026-09-23 時点で解消済みか未確認） |
| 採用規模（コード検索） | `darwinConfigurations`+`nixosConfigurations` 併存 | 2,332 件 | 網羅的な指標ではない（GitHub code search はサンプリング） |
| 採用規模（コード検索） | `forAllSystems` | 19,712 件 vs `flake-parts.lib.mkFlake` 15,808 件 | flake-parts はまだ少数派の書き方 |

---

## 6. What the evidence supports, plainly

**支持される: ホストごとに分岐する共有関数（hostname キー）へ移す。** 読んだ実践者例のうち唯一「macOS の nix-darwin」と「実機の Arch/Omarchy 上の standalone home-manager」を両方持つ例（sanketsudake、2026-09-21 マージ）は、`mkDarwinHost`/`mkHomeHost` という2つの小さな関数と、`darwinConfigurations."<mac-hostname>"` / `homeConfigurations."<user>@<linux-hostname>"` という hostname キーで書かれていた。mitchellh の `mkSystem`（3,109★）も同じ形（1関数、bool flag、hostname キー）。vendor 側（flake-utils README）も「host configs は system でキーしてはいけない」と明言している。**現行の `flake.nix` を「一つの `darwinConfigurations` エントリ」から「複数エントリを生成する共有関数」へ変えることに、業界の主流は同意している。**

**支持される: Omarchy/Arch 機は nix-darwin の代わりに standalone `homeConfigurations` を足す。** これは実機に Nix 自体（NixOS ではなく）だけを入れ、home-manager をその上に立てる形で、実例では `packages.x86_64-linux.home-manager` を flake 自身に持たせることで home-manager CLI のインストールすら flake.lock に固定していた。Omarchy を NixOS に置き換えて見た目だけ再現する方向（henrysipp/omarchy-nix, 802★)は10ヶ月止まっており、この持ち主が既に実機に Omarchy(Arch) を入れ終えている事実（メモ記録）とも噛み合わない。**「Omarchy はそのまま、その上に home-manager を薄く足す」方が、証拠の量でも、この持ち主の現状とも整合する。**

**支持されない、あるいは根拠が薄い: forAllSystems/genAttrs で `darwinConfigurations` 自体を生成すること。** dustinlyons(3,626★)はこれをやっているが、1アーキテクチャ=1台という制約に依存しており、flake-utils の vendor ドキュメントが明示的に警告している使い方と一致する。今回の持ち主は macOS 1台+Linux 1台(将来2台目もあり得る)なので、この制約に縛られる理由がない。**採用しない。**

**足りないもの、はっきりさせておくこと:**
- home-manager の `launchd.agents`/`systemd.user.services` ネイティブ option を実際に使っている個人 dotfiles の実例は、今回の調査では一件も見つからなかった。litellm/lmstudio の launchd 常駐を home-manager の `launchd.agents` に移すこと自体は vendor ソースから見て技術的に妥当（`isDarwin` で自動ガードされる）だが、「みんなやっている」根拠は無い — 前例なしとして扱う。
- 「一度 macOS+実機 Linux の単一 flake をやってみて、やめて分割リポジトリに戻した」という否定的な一次情報は、意図的に探したが見つからなかった。これは「そういう失敗が存在しない」ことの証明ではなく、「見つからなかった」という事実だけを記録する。
- x86_64-linux（実機 Omarchy PC のアーキテクチャ）でのキャッシュ命中率やインストール時間は未実測。2026-09-22 の box 裁定の実測値（aarch64-linux、Docker サンドボックス）はアーキテクチャが違うため転用できない。

---

## 7. 前例なし (no precedent found)

- 同じ所有者が「macOS が nix-darwin、Linux が standalone home-manager」を1年以上運用し続けている実例（見つかったのは2日前にマージされたばかりの1件のみ）。
- 「一度この組み合わせを採用してからやめた」一次情報（否定側の証拠を意図的に探したが空振り）。
- home-manager `launchd.agents`/`systemd.user.services` を実際に採用している個人 dotfiles の実例。
- Omarchy 実機で home-manager が `home.nix` の全ドメインをフル管理している実例（唯一の実例は明示的に部分適用のみ）。
- x86_64-linux（実機アーキテクチャ）向けの cache.nixos.org ヒット率・インストール時間の実測。
- nix-darwin または NixOS 公式マニュアルが自ら「複数ホストを一つの flake で」を実演しているページ（README/マニュアルはいずれも単一ホスト例のみ、複数ホストは実践者の慣習として広まっているだけ）。

## Unreachable URLs

- https://nixos.wiki/wiki/Flakes — HTTP 403
- https://nixos.org/manual/nixos/stable/index.html#sec-flake-config — fetched but crawled content had no flake-output section
- https://discourse.nixos.org/search?q=... — JS-rendered placeholder page, no content returned
- https://home-manager-options.extranix.com/?query=... (both launchd.agents and systemd.user.services searches) — JS-rendered "Loading option data..." placeholder, no content; substituted with direct raw-source reads of the option modules instead (§1.2), which is stronger evidence than the rendered search page would have been anyway.
