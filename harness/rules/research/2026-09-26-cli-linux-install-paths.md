# Mac 専用の Homebrew 6 ツールを Omarchy (Linux) にどう届けるか — 各ツールの一次情報

調査日: 2026-09-26。前提（再調査しない）: CLI/LSP は Nix flake が単一情報源、mise はランタイムのみ（`2026-09-22-tools-nix-list-box-subset.md`）。Omarchy は Quattro (v4)、`~/.config` はユーザー領域だが `omarchy-refresh-config` 等が symlink を壊すバグが複数 open のまま（`2026-09-24-dotfiles-on-omarchy.md`）。この記事は同記事の「herdr は Omarchy の `config/` 配布対象に入っている」という既出情報の続きとして、Omarchy が herdr の**バイナリ自体**を入れるかを確定させ、他 5 ツール（wtp/thefuck/omp/codex/mo）を新規に調べる。

対象は現在 macOS のみ `system/darwin/homebrew.nix` の `brews`/`casks` にある 6 ツール（実ファイルを直接確認、`herdr`・`satococoa/tap/wtp`・`thefuck`・`k1LoW/tap/mo`・`can1357/tap/omp`・cask の `codex`）。

## 方法・検証凡例

- 直接取得: `curl -H "Authorization: Bearer $(gh auth token)"` で `api.github.com`/`raw.githubusercontent.com` を叩いた。`gh` 自体はこのサンドボックスで TLS が通らないため使わない（設問の指示どおり）。
- nixpkgs の確認は `nix eval` がサンドボックスで `/nix/var/nix/daemon-socket/socket` に `Operation not permitted` で繋がらず断念し、代わりに `NixOS/nixpkgs` リポジトリの `pkgs/by-name/<xx>/<name>/package.nix` を、このリポジトリの `flake.lock` が実際に固定している nixpkgs のコミット（`4975466d324710c576dc11ad614684e6bd8cad8e`、`nixpkgs-unstable` 追従）に対して直接取得して確認した。これは `nix eval` の代替であり、評価そのもの（依存解決やビルド可否）は検証していない。
- 未到達/未確認は都度明記。

---

## 0. herdr — Omarchy は「配布」ではなく「インストール」もする

`2026-09-24-dotfiles-on-omarchy.md` は Omarchy の `config/` ディレクトリに `herdr` が含まれる（＝設定ファイルの配布対象）ことまでは確認済みだった。今回 `install/omarchy-base.packages` を直接取得すると：

```
51-gvfs-nfs
52-gvfs-smb
53:herdr
54-hyprland
```

**`herdr` はベースパッケージ一覧そのものに載っている** — Omarchy は herdr を own のパッケージリポジトリからインストールする一次パッケージとして扱っている。裏付けとして migration `migrations/1786273938.sh`（直接取得、https://raw.githubusercontent.com/omacom/omarchy/quattro/migrations/1786273938.sh）の全文:

> "Install herdr from the Omarchy package repo and seed its config" / "# The package was briefly published as omarchy-herdr; herdr replaces it" / "omarchy-pkg-drop omarchy-herdr" / "omarchy-pkg-add herdr" / "# An earlier revision of this migration installed herdr through mise. Drop that install so a stale client can't shadow the packaged /usr/bin/herdr with an older wire protocol."

つまり Omarchy は herdr を①一度 `omarchy-herdr` という名前で出し、②今の `herdr` に改名し、③以前は mise 経由でインストールしていたのをやめて `/usr/bin/herdr` に一本化した、という履歴を migration が物語っている。`omarchy-pkg-add`/`omarchy-pkg-drop` は Omarchy 独自のパッケージ管理コマンド（Arch の `pacman`/`yay` ではなく Omarchy 自身のリポジトリ経由、実装の中身までは今回未確認）。Manual `manual/21-tuis.md`（直接取得）はさらに:

> "[Herdr](https://github.com/omacom-io/herdr) is a terminal workspace manager that gives you workspaces, tabs, and panes... You start it (or reattach to your existing session) with `Super + Ctrl + Return`. Omarchy ships a Herdr configuration that mirrors its Tmux config"

**注意（未確認のまま記録）**: このリンク先は `github.com/omacom-io/herdr` であり、本調査で確認した実際の upstream `github.com/herdrdev/herdr` とは別の GitHub Organization を指している。ミラー/フォークなのか manual の誤記なのかは今回未確認 [unverified]。いずれにせよ Omarchy が実際に `omarchy-pkg-add herdr` で入れているのが `herdrdev/herdr` のビルドであることは `omarchy-base.packages` と migration スクリプトの記述（バージョン非依存、パッケージ名一致）から強く示唆される。

**結論**: Omarchy 機では herdr を dotfiles 側で新規に持ち込む必要がない。Omarchy 自身が base package として `/usr/bin/herdr` をインストールし、`~/.config/herdr` の既定値も配る。dotfiles 側でやることがあるとすれば「Omarchy 既定の `~/.config/herdr/config.toml` の上に、リポジトリ管理の override をどう重ねるか」だけで、これは 0.7.4 以上という最小要求（migration が確認した最新は後述のとおり 0.9.1 で条件を満たす）を考える必要すらない。

### herdr がそもそも nixpkgs にある(前提の訂正)

依頼文は「herdr は nixpkgs に無い」という前提だったが、これは**現在は誤り**。`pkgs/by-name/he/herdr/package.nix` をこのリポジトリの pin (`4975466d`) で直接取得すると:

```nix
pname = "herdr";
version = "0.9.1";
...
src = fetchFromGitHub {
  owner = "herdrdev";
  repo = "herdr";
  tag = "v${finalAttrs.version}";
  hash = "sha256-N6+kprfWRyh0AkAiopkGsNXUGGORyPVFHEaDHCpGQs8=";
};
cargoHash = "sha256-1VAmsDE3zeU0wMVQKleQcd/zq8/k/oor8tasrsRQfeY=";
zigDeps = zig_0_16.fetchDeps { ... };
```

`rustPlatform.buildRustPackage` によるソースからのビルド（`zig_0_16` はベンダーされた `vendor/libghostty-vt` を Zig でビルドするため）。バージョン `0.9.1` は upstream の最新安定版（`herdrdev/herdr` releases、直接取得、`v0.9.1` 公開 2026-09-16）と完全一致しており、dotfiles が要求する `>= 0.7.4` を満たす。macOS/Linux 両方が `meta.platforms` に想定されている構造（未検証: `nix eval` が使えないため実際のビルド成功は確認していない）。

Homebrew 側は herdr が **homebrew-core**（`can1357/tap` のような個人タップではない）にあることも確認: `raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/h/herdr.rb` に `arm64_linux`/`x86_64_linux` の bottle が並ぶ:

```ruby
bottle do
  sha256 cellar: :any_skip_relocation, arm64_golden_gate: "..."
  sha256 cellar: :any,                 arm64_linux:       "..."
  sha256 cellar: :any,                 x86_64_linux:      "..."
end
```

（Homebrew on Linux が使えるなら Mac と全く同じ `brew install herdr` が Omarchy でも通る、という傍証。ただしこの dotfiles は Homebrew を macOS 専用に位置づけているので採用対象ではない。）

---

## 1. wtp — satococoa/wtp

- **リポジトリ**: `satococoa/wtp`（直接取得）— star 634、`pushed_at: 2026-03-30T03:14:39Z`、Go。
- **最新リリース**: `v2.10.3`（2026-03-08T17:18:48Z）。直近 10 件のタグを見ると 2025-12-16〜2026-03-08 の間はほぼ月 1〜2 回のペースだが、**2026-03-08 以降、今日(2026-09-26)まで約 6.5 か月新リリースが出ていない** — 開発が止まっている可能性がある停滞シグナル。
- **Linux 成果物**: リリースアセットに `wtp_2.10.3_Linux_arm64.tar.gz` / `wtp_2.10.3_Linux_x86_64.tar.gz` に加え `.deb`/`.rpm`/`.apk`（goreleaser 製、`checksums.txt` あり）。Arch 向け `.deb`/`.rpm` はあるが pacman 用の `.pkg.tar.zst` はない（Arch では使えない）。
- **nixpkgs**: `pkgs/by-name/wt/wtp/package.nix` が既に存在（pin 時点で確認）。`buildGoModule`、`version = "2.10.3"` — **upstream 最新と完全一致**。`fetchFromGitHub` でソースから `go build`。**依頼の前提「Nix にない」は誤り、既に足りている。**
- **community 一次登録**: `aquaproj/aqua-registry` の `pkgs/satococoa/wtp/`（`pkg.yaml`/`registry.yaml`）が存在 — mise の `aqua:satococoa/wtp` バックエンドで直接使える経路もある（curated `registry/wtp.toml` の別名は無いが generic aqua 経由で解決可能、[unverified: 実際に `mise use` で通るかは未実行]）。
- **Homebrew**: タップは `satococoa/homebrew-tap`（`brew install satococoa/tap/wtp` の慣習どおり `homebrew-<tap名>` の実体）。フォーマット確認（`wtp.rb`、直接取得）:
  ```ruby
  url "https://github.com/satococoa/wtp/archive/refs/tags/v2.10.3.tar.gz"
  depends_on "go" => :build
  def install
    system "go", "build", "-trimpath", ...
  ```
  ソースから `go build` する形で、nixpkgs の package.nix と実質同じビルド手順。

**Nix 導出の実用性**: 既に nixpkgs にあるので、`pkgs/wtp` を自作する動機は「nixpkgs 側が古くなった/壊れた場合の避難路」以外にはない。もし自作するなら `codebase-memory-mcp` と同型の `fetchurl` パターン（goreleaser の `Linux_x86_64.tar.gz`/`Linux_arm64.tar.gz` + `checksums.txt`）がそのまま使える形。

---

## 2. thefuck — nvbn/thefuck

- **リポジトリ**: `nvbn/thefuck` — star 97,883（この 6 ツール中最大）、`pushed_at: 2024-07-19T14:56:13Z`（**2 年以上更新なし**）、`archived: false`（アーカイブこそされていないが実質放棄）。
- **最新リリース**: `3.32`（2022-01-02T22:17:40Z）。それ以前も 3.31(2021-06)・3.30(2020-03)・3.29(2019-05) と、もともと年1回未満のペース。**約 3年9か月リリースなし。**
- **nixpkgs からの除去**: PR **#412191**「thefuck: drop」が 2025-05-30T20:44:23Z にマージ済み（直接取得）。本文の逐語:
  > "It was pinned to python311 last summer due to two uses of the removed module 'imp'. One of the uses are fixed on the upstream master branch but is unreleased, and the second use is fixed by two separate open PRs. The author is unresponsive and has been inactive since january 2024. Rather than rebase and apply the two fixes I feel it makes more sense to drop the package."
  除去前に build failure の issue が複数（#325799「Build failure: thefuck 3.32」、#298154 も同名）立っており、Python の `imp` モジュール撤去（Python 3.12+）に upstream が追従できていないことが直接原因。**依頼の前提どおり、除去は確定事実で理由も特定できた。**
- **Arch (公式 extra リポジトリ)**: 除去されていない。`archlinux.org/packages/search/json/?name=thefuck` を直接取得:
  ```json
  {"pkgname": "thefuck", "repo": "extra", "pkgver": "3.32", "pkgrel": "13",
   "maintainers": ["felixonmars"], "build_date": "2026-07-05T05:06:07Z", ...}
  ```
  **Arch は独自パッチ（`pkgrel 13`）で `imp` 問題等を吸収し、2026-07 時点でもビルド・配布を継続している** — nixpkgs とは対照的な判断。`pacman -S thefuck` がそのまま通る。
- **Homebrew**: `homebrew-core` の `Formula/t/thefuck.rb`（直接取得）は現存し、`arm64_linux`/`x86_64_linux` bottle 込みで生きている（`depends_on "python@3.14"` — Homebrew 側は独自に新しい Python でビルドを通しているらしい、パッチ内容までは未確認）。
- **後継としての言及**: AUR 検索で `pay-respects`（`iffse/pay-respects`、Rust 製）が "thefuck replacement" と明記されヒットする（NumVotes 5、`pay-respects`/`pay-respects-bin` の2パッケージ）。これは「thefuck の代替を探す動きが実在する」という否定側の状況証拠であり、この調査は代替への切り替えを検討する依頼ではないため深掘りしていない。

**結論**: thefuck は Nix で自作導出しても無意味に近い ― upstream 自体が `imp` 撤去に追従しておらず、Python 3.12+ 環境でのビルドがそもそも壊れている（nixpkgs が投げた理由そのもの）。Arch の `extra` にあるのでパッケージとしては `pacman -S thefuck`（Arch 独自パッチ込み）が唯一の実用パスで、Nix 側で追いかける理由はない。

---

## 3. omp (oh-my-pi) — can1357/oh-my-pi

- **リポジトリ**: 依頼文にあった `can1357/tap`（`homebrew-tap`、"Homebrew tap for omp", 2 star, 今日作成）はタップに過ぎず、本体は **`can1357/oh-my-pi`**（直接取得で特定）— star 33,336、`pushed_at: 2026-09-25T23:39:52Z`、TypeScript（コアは Rust、README曰く「~80k lines of Rust core」）、`created_at: 2025-12-31`（9か月弱で3万超star、急成長中）。
- **リリース頻度**: ほぼ毎日。直接取得した直近5件: `v18.3.2`(2026-09-26 00:00, 今日)・`v18.3.1`(09-25)・`v18.3.0`(09-24)・`v18.2.11`(09-23)・`v18.2.10`(09-22) — **1日1リリース近いペース**。
- **Linux 配布**: 各リリースに生バイナリが直接付く（tar化なし、`SHA256SUMS.txt`付き）:
  ```
  omp-linux-x64, omp-linux-arm64, omp-linux-musl-x64, omp-linux-musl-arm64,
  omp-darwin-arm64, omp-darwin-x64, omp-windows-arm64.exe, omp-windows-x64.exe
  ```
  README（直接取得）は musl ビルドについて注記: "Alpine / musl: the prebuilt musl binary links libstdc++/libgcc dynamically, which stock Alpine does not ship. Install them first: apk add libstdc++ libgcc." — Arch (glibc) 環境なら該当しない。
- **upstream 自身が Nix flake を持つ**（依頼文にない発見）。README の Install 節、逐語:
  > "**Nix** ```nix run github:can1357/oh-my-pi``` ... Flake consumers can use `packages.<system>.omp`, `overlays.default`, `nixosModules.default`, or `homeManagerModules.default`. A Home Manager configuration can install OMP and own its settings declaratively: `inputs.omp.url = "github:can1357/oh-my-pi"; imports = [ inputs.omp.homeManagerModules.default ];`"
  `flake.nix`（直接取得）は `bun2nix` + `rust-overlay` でソースからビルドする本格的な flake で、`aarch64-darwin`/`aarch64-linux`/`x86_64-darwin`/`x86_64-linux` を `forAllSystems` で出力。**日次リリースのたびに flake input をピン留めし直す運用になる**ため、home-manager モジュールを直接使うと更新頻度が高すぎて `flake.lock` の diff が荒れる可能性がある[unverified: 実運用の摩擦は未測定]。
- **nixpkgs にも既に存在**: `pkgs/by-name/om/omp/package.nix`（pin時点で直接取得）— `version = "18.2.11"`、`stdenv.mkDerivation` + `bun`/`cargo`/`rustc`/`autoPatchelfHook`（Linux 用）+ `pipewireSupport ? stdenv.hostPlatform.isLinux` というオーディオ系ライブラリ依存（`libopus`/`alsa-lib`/`libpulseaudio`/`pipewire`）を持つ、upstream の flake とは別建てのビルドレシピ。**日次リリースの中の 1本(`18.2.11`、09-23公開分)を追いかけている**状態で、HEAD (`18.3.2`) より数日〜数バージョン遅れるのは構造上避けられない。
- **Homebrew** (`can1357/homebrew-tap`、直接取得): タップの実体は生バイナリの直接ダウンロード:
  ```ruby
  version "18.3.2"
  on_macos { on_arm { url ".../omp-darwin-arm64", using: :nounzip } ... }
  on_linux { on_arm { url ".../omp-linux-arm64", using: :nounzip } ... }
  ```
  このタップは**リリース当日中に最新版に追従**しており（`18.3.2` が今日公開されて今日タップも同期済み）、nixpkgs より鮮度で優位。

**Nix 導出の実用性**: 3つの選択肢がある。①upstream 自身の flake を input にする（`homeManagerModules.default` まで公式提供、最も「正しい」形だが日次更新に追従するコストが要る）。②nixpkgs の `omp` パッケージをそのまま使う（数日遅れるがメンテ不要、追加の flake input が要らない）。③`codebase-memory-mcp` 型の `fetchurl` 自前導出（Homebrew タップと同じ生バイナリ URL、`SHA256SUMS.txt` があるので実装は容易）。**①は「一次に一番近い」を追求するなら妥当だが、日次リリースという点で運用コストが③や②と非対称に高い**、という比較材料をここに残す。

---

## 4. codex (OpenAI Codex CLI) — openai/codex

- **リリース頻度**: 通常安定版タグ (`rust-vX.Y.Z`) に加え無数の `-alpha.N` タグが出る。直接取得した直近15件の中に安定版は `rust-v0.157.1`(2026-09-26)・`rust-v0.157.0`(2026-09-25) の2つのみで、残り13件は同日中に出た alpha。
- **nixpkgs の追従速度**: `pkgs/by-name/co/codex/package.nix` のコミット履歴（直接取得、直近10件）:
  ```
  2026-09-25  codex: 0.156.1 -> 0.157.0   (upstream rust-v0.157.0 公開: 2026-09-25T02:31, nixpkgs反映: 同日11:45 ≈ 9時間後)
  2026-09-22  codex: 0.155.1 -> 0.156.1
  2026-09-18  codex: 0.154.0 -> 0.155.1
  2026-09-10  codex: 0.153.4 -> 0.154.0
  2026-09-04  codex: 0.151.0 -> 0.153.4
  2026-08-29  codex: 0.149.0 -> 0.151.0
  2026-08-21  codex: 0.147.0 -> 0.149.0
  2026-08-08  codex: 0.146.0 -> 0.147.0
  ```
  安定版が出るたびだいたい同日〜数日で nixpkgs が追従している。**このリポジトリの `flake.lock` が実際に固定している rev (`4975466d`) では `codex` は `version = "0.157.0"`**（直接取得で確認済み）。
- **依頼文の前提の訂正**: 依頼は「nixpkgs には 0.118.0 しかないが dotfiles は >= 0.147.0 が要る」という前提だったが、**これは古い。現状の nixpkgs-unstable pin は 0.157.0 で、要求の 0.147.0 を大幅に超えている。** `system/darwin/homebrew.nix` のコメント（このリポジトリ自身、直接読み取り）は「codex ships as a cask only — there is no `codex` formula ... Minimum 0.147.0 ... recommended 0.150.0+」と書いており、この記述は Homebrew cask 経由のインストールについての注記であって、nixpkgs 経由の話ではない。**Homebrew (cask) と nixpkgs (ソースからの Rust ビルド) は完全に別系統**で、cask には formula が無い一方、nixpkgs にはちゃんと `rustPlatform.buildRustPackage` の `codex` package がある。
- **ビルド構成**: nixpkgs の `codex` package.nix は `librusty_v8.nix`/`librusty_v8_src_binding.nix`/`fetchers.nix` という専用ヘルパー付きで rusty_v8 (Deno の V8 バインディング) をベンダーする作り。openai/codex が内部で Deno系ランタイムコンポーネントを使っている構造を反映しており、ソースからのビルドは重い可能性がある[未検証: ビルド時間は測っていない]。
- **community flake**: `sadjow/codex-cli-nix`（156 star、今日プッシュ）が存在するが、nixpkgs 自体が数時間〜1日遅れで追従している以上、**この flake を別途 input にする実用上の理由は薄い**（nixpkgs だけで足りる）。他に `secbear/codex-nix`・`tttol/nix-codex`・`rbright/nix-codex` 等の類似 flake も同日中に更新された形跡があり(検索結果、詳細未読)、この種の「追いかけ flake」は乱立気味 [unverified: 個々の存在理由や差分は未調査]。

**結論**: codex は現状の flake pin だけで既に要求バージョンを満たしている。追加の Nix 導出作業は不要 — Homebrew cask の運用注記（「no `codex` formula」）が nixpkgs 側にも当てはまるという誤解が前提に混入していたので、これを明示的に訂正する。

---

## 5. mo (Markdown viewer, k1LoW/mo)

- **リポジトリ**: `k1LoW/mo` — star 1,067、`pushed_at: 2026-09-24T23:07:45Z`（2日前、活発）、Go、説明「mo is a Markdown viewer that opens .md files in a browser.」
- **最新リリース**: `v1.6.8`（2026-09-07T06:01:53Z）。直近10件のタグは 2026-06-04〜09-07 の間にほぼ月1回ペース — 健全な継続的リリース。
- **Linux 成果物**: `mo_v1.6.8_linux_amd64.tar.gz` / `mo_v1.6.8_linux_arm64.tar.gz`（goreleaser、`checksums.txt`あり）。pacman向け `.pkg.tar.zst` は無いが `.deb`/`.rpm`/`.apk` はある（`mo_1.6.8-1_amd64.deb` 等）。
- **nixpkgs は名前衝突で使えない**: `pkgs/by-name/mo/mo/package.nix` は**確かに存在するが、別のツール**:
  ```nix
  pname = "mo";
  version = "3.0.5";
  src = fetchFromGitHub { owner = "tests-always-included"; repo = "mo"; ... };
  meta.description = "Moustache templates for Bash";
  ```
  `tests-always-included/mo`（Bash用 Moustache テンプレートエンジン）であり、k1LoW/mo（Markdown ビューア）とは無関係の同名ツール。**`pkgs.mo` という属性名は既に nixpkgs 内で先取りされている** — dotfiles 側で k1LoW/mo を Nix パッケージ化する場合、`pkgs.mo` を上書きするオーバーレイにするか、別名（例: `md-mo`、`k1low-mo`）で `pkgs/` に自作する必要がある。この名前衝突は依頼文にはなかった発見で、実装上いちばん重要な落とし穴。
- **Homebrew**: タップは `k1LoW/homebrew-tap`（`brew install k1LoW/tap/mo` の実体）。フォーマットは `Formula/` 配下ではなくリポジトリ直下に `mo.rb` が置かれる構成（同タップは k1LoW 作の60以上の小ツールを1つのリポジトリで束ねている）。中身（直接取得）は生バイナリの直接参照:
  ```ruby
  version '1.6.8'
  on_macos { if Hardware::CPU.arm? then url '.../mo_v1.6.8_darwin_arm64.zip' ... end }
  on_linux { if Hardware::CPU.arm? && Hardware::CPU.is_64_bit? then url '.../mo_v1.6.8_linux_arm64.tar.gz' ... end }
  ```
- **community 一次登録**: `aquaproj/aqua-registry` に `pkgs/k1LoW/mo/`（`pkg.yaml`/`registry.yaml`）が存在 — mise の `aqua:k1LoW/mo` バックエンドで直接使える経路がある。mise の curated `registry/mo.toml` は無い（`registry/herdr.toml`・`registry/codex.toml` は存在するが `wtp.toml`/`thefuck.toml`/`mo.toml`/`omp.toml` は無い、直接確認）。

**Nix 導出の実用性**: `codebase-memory-mcp` と全く同じ形（`fetchurl` + `tar.gz` 展開 + `install -Dm755`）がそのまま使える。goreleaser 製の Linux tarball + `checksums.txt` は codebase-memory-mcp の darwin/linux 分岐パターンと同型。**唯一の追加考慮点は名前衝突の回避** — `pkgs/mo/default.nix` を作っても home-manager の `home.packages` にそのまま積むと nixpkgs 側の同名 `mo`（Moustache）と衝突するため、`pkgs/` 側で別名にするか、home-manager の package list で明示的にどちらの `mo` かを一段オーバーライドする配線が要る。

### mo と比較可能なターミナル/ブラウザ系 Markdown プレビューツール

| ツール | star | 直近 push | 状態 | nixpkgs |
|---|---|---|---|---|
| `charmbracelet/glow`（TUI/CLIレンダラ） | 27,474 | 2026-09-22（4日前） | 活発 | あり（`pkgs/by-name/gl/glow`、pin時点で `version = "3.0.0"`、upstream最新と一致） |
| `swsnr/mdcat`（cat風ターミナル出力） | 2,412 | 2026-06-19 | **`archived: true`** | 無し（by-name確認） |
| `joeyespo/grip`（GitHub風レンダリングをブラウザで） | 6,832 | 2024-07-10（2年超前） | 停滞 | 無し（by-name確認） |
| `Textualize/frogmouth`（TUI、ブラウザではない） | 3,297 | 2024-08-01（2年超前） | 停滞 | あり（`pkgs/by-name/fr/frogmouth`、内容は今回未読） |
| `markserv/markserv`（Node、ブラウザ+ライブリロード、mo と機能的に最も近い） | 626 | 2026-09-25（1日前） | 活発 | 無し（by-name確認） |
| `k1LoW/mo`（対象、ブラウザ+ライブリロード、Go単一バイナリ） | 1,067 | 2026-09-24 | 活発 | 名前衝突（上記） |

「ブラウザで開いてライブリロードする」という mo と同じ設計のツールの中では `markserv` が唯一活発に更新され続けている同型競合だが、star数は mo の 6割弱でありエコシステムの合意という強さの証拠はない。`glow` は圧倒的に最大の star 数・最速の更新頻度を持つ**業界の事実上の標準**だが、UI がターミナル内レンダリングであり、mo が謳う「ブラウザで開く」設計とは根本的に別カテゴリ（エージェントが書いた長文 Markdown をブラウザでプレビューする用途には mo/markserv の系統の方が適合、ターミナル内で素早く読む用途には glow が適合、という役割分担）。**「mo が業界の既定の選択肢である」という主張を裏付ける一次情報（ブログ・Discussion・比較記事）は見つからなかった** — 見つかったのは「同種ツールの中で相対的に活発」という消極的な支持のみ。`grip`（GitHub 公式スタイルレンダリング、Python2/3世代のツール）と `frogmouth`（Textualize製 TUI）は共に 2年以上更新なしで、この分野全体がここ数年で新陳代謝している最中に見える。

---

## 否定側の証拠（同じ熱量で収集）

- **wtp は約6.5か月リリースが止まっている**（最新 v2.10.3 は 2026-03-08、今日は 2026-09-26）— 依頼文の「Homebrew に無い」という前提には無関係だが、nixpkgs 側の追従を心配する必要が薄いのと同時に、upstream 自体の勢いが落ちている可能性を示す。
- **thefuck は nixpkgs から明確な技術的理由（Python `imp` モジュール廃止 + 作者不応答）で削除済み**、upstream は3年9か月リリースなし。Arch の `extra` だけが独自パッチで生かしている状態で、「Nix で追いかける」選択肢自体が既に nixpkgs コミュニティによって「見送るべき」と判定されている。
- **mdcat は `archived: true`**（swsnr/mdcat）— mo の比較対象として調べた中で唯一 GitHub 上でアーカイブ済みと明記されたツール。
- **grip・frogmouth は2年以上 push が無い** — mo 系のブラウザプレビューという設計だけで見ても、活発なのは mo と markserv の2つだけ。
- **omp の nixpkgs パッケージは構造的に upstream の日次リリースに追いつけない** — 09-23時点の `18.2.11` を追っており、今日時点の HEAD (`18.3.2`) との差は09-24/25/26の3リリース分。日次更新というリリース速度そのものが、パッケージマネージャ経由の追従を原理的に不利にする。
- **omp・codex を追いかける community flake が複数乱立**（`sadjow/codex-cli-nix`、`secbear/codex-nix` 等）していること自体、「1つの決定版」が業界に無いことの状況証拠。

---

## 確認できなかったこと

- **`manual/21-tuis.md` の `github.com/omacom-io/herdr` リンクが何を指すか** — 実際の upstream (`herdrdev/herdr`) との関係（フォーク/ミラー/誤記）は未確認 [unverified]。
- **`omarchy-pkg-add`/`omarchy-pkg-drop` の実装の中身**（Omarchy 独自パッケージリポジトリの実体、pacman との関係）は未読。
- **nixpkgs の `herdr`/`wtp`/`omp`/`codex` package.nix が実際にビルドに成功するか** — サンドボックスの nix daemon 接続不可のため `nix build` を一切実行できておらず、ソースの内容確認のみ（評価・ビルドは机上）。
- **omp の nixpkgs 版に Linux 固有の `pipewireSupport`/`autoPatchelfHook` 依存が実運用で問題なく動くか** — package.nix の宣言を読んだのみで実機検証なし。
- **codex の nixpkgs ビルドの実測ビルド時間**（`librusty_v8` のベンダリングを含む）は未計測。
- **`mise use -g aqua:satococoa/wtp` / `aqua:k1LoW/mo` が実際に解決してインストールできるか** — aqua-registry にエントリがあることは確認したが、mise 側から実行して確かめてはいない。
- **mo が「業界の既定の選択肢」だと主張する一次情報** — ブログ記事・Discussion・比較表のいずれも見つからず、"確認できなかった"というより"支持する情報が存在しない"という消極的な結果として記録する。
- **Homebrew on Linux (Linuxbrew) が Omarchy で実際に動くか** — herdr/thefuck の bottle に `arm64_linux`/`x86_64_linux` があることは確認したが、Omarchy 上で `brew` コマンド自体をセットアップして検証してはいない。

---

## 結論

**6ツールの現状は、依頼文が前提としていたより大幅に「Nix で足りている」側に寄っている。**

- **herdr**: Omarchy が base package として自前で入れる（`omarchy-pkg-add herdr`）。nixpkgs にも既に `0.9.1`（upstream最新、要求 `>=0.7.4` を満たす）がある。**dotfiles 側で何も作る必要がない。**
- **wtp**: nixpkgs に `2.10.3`（upstream最新と一致）が既にある。**何も作る必要がない**が、upstream 自体が半年停滞気味なので今後の動向だけ注視。
- **thefuck**: nixpkgs から意図的に削除済み（upstream の `imp` 撤去未対応 + 開発停止）で、これを Nix で追う理由はない。Linux で使いたいなら Arch `extra`（独自パッチで生存）の `pacman -S thefuck` が唯一の現実的な経路。
- **omp**: 依頼文にあった Homebrew タップの奥に `can1357/oh-my-pi` という急成長中（33k star、日次リリース）の本体があり、①upstream 自身の Nix flake（`homeManagerModules.default` まで提供）、②nixpkgs の同名パッケージ（数日遅れ）、③Homebrew タップと同型の `fetchurl` 自前導出、の3経路がすべて実在する。どれを採るかは「鮮度」対「運用コスト」のトレードオフで、この記録は選択の根拠となる事実だけを残す。
- **codex**: 依頼文の「nixpkgs は 0.118.0」は古い情報で、このリポジトリが実際に固定している nixpkgs pin は既に `0.157.0`（要求 `>=0.147.0` を大幅に超過）。nixpkgs は openai/codex の安定版リリースに数時間〜1日で追従しており、追加の community flake（`sadjow/codex-cli-nix` 等）を導入する実用上の理由は薄い。
- **mo**: 唯一、素直な Nix 導出が要るツール。upstream (`k1LoW/mo`) は活発だが nixpkgs の `pkgs.mo` は別ツール（`tests-always-included/mo`, Moustache テンプレート）が先取りしており**名前衝突**がある。goreleaser 製の Linux tarball + checksums はそのまま `codebase-memory-mcp` と同型の `fetchurl` 導出に使えるが、パッケージ名は `pkgs.mo` を避けて別名にする必要がある。比較対象のブラウザ系プレビューツールの中では `markserv` だけが同じ活発さを保っているが、「mo が業界の既定」と言える一次情報は無く、支持できるのは「mo は同分野で今も更新され続けている数少ないツールの一つ」という消極的な事実にとどまる。
