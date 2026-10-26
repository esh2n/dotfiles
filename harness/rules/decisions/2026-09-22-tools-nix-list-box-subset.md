# 道具とLSPの元はNixのflakeに置き、容れ物にはLinux向けに絞った一覧を同じflakeから焼く

Status: accepted — 道具の一覧は既にflakeにあり、Linuxでも動くことを実測し、miseでは持てない道具がある（2026-09-22）

rule: Keep CLI/LSP tool sources in the Nix flake and runtimes in mise; never change this split. Build a separate, Linux-only packages.aarch64-linux.box list for containers (not the full host list) and bake it into sbx templates as a copied Nix closure, never by installing Nix itself inside the container; drop terraform from box (BSL, uncached).
scope: repo

## Problem

言語の処理系、LSP、CLIの道具を、ホスト(macOS)と容れ物(Docker SandboxesのLinux arm64 microVM)の両方に、一つの定義から入れたい。ホストでは道具とLSPの約100個がNixのflake(home-manager)にあり、処理系だけがmiseにある。

## Decision

- 道具とLSPの元はNixのflakeのまま。処理系はmiseのまま(いまの分け方を変えない)。
- flakeのpackageの一覧を`{ pkgs }`の関数に切り出し、`cli`・`lsp`・`darwinOnly`に分ける。ホストはこれまでどおり全部を使う。
- 容れ物用には別の一覧(`box`)をLinux向けに絞って作る。ホストの一覧をそのまま入れない(多すぎる)。出発点は実測した38個の組だが、箱で使わないもの(GUIや動画処理やDB本体など)は外す。
- `packages.aarch64-linux.box`として出力し、sbxのtemplateに焼く。形は`nixos/nix`のbuilderでclosureを作り`docker/sandbox-templates:<agent>`の上にコピーする(Nix本体を箱に残さない)。
- 処理系は同じ`mise.toml`を容れ物にコピーして`mise install`する。
- terraformは箱の一覧から外す(BSLのためcacheに無く、毎回ビルドになる。必要ならopentofu)。
- PATHはimageの`ENV`で通す(sandboxのentrypointはshellのrcを読まない)。

## Alternatives considered

- **mise一本にする**: 実践の実例(metabase、cosaiのADR)はNixを使っていない環境の選択で、この環境には当たらない。miseのregistryにnixd、zls、marksmanの経路がなく、goplsやtypescript-language-serverは`go:`/`npm:`経由でlockにURLが固定されない。作者自身が「Nixのモデルは壊れている」と述べ、Nixをbackendにする案は終わっている。ホストの73個の道具をNixから外す作業も増える。却下。
- **ホストの一覧をそのまま箱に入れる**: 全70個のclosureは展開後5.34GiB、箱に要らないもの(yazi 1.2GB、ffmpeg 1.1GB、docker、mysql、GUI系)を含む。却下。
- **Nix本体を箱のimageに入れる(route A)**: 7.2GBで、closureコピー(6.79GB)より大きく、`nix`がroot専用の面を残す。エージェントが箱の中で道具を足す必要が出たら再考。
- **kitのinstallで毎回Nixを入れる**: sbxにローカルの永続ボリュームがなく、作成のたびに5秒 + 47秒と0.8GBのdownloadが再発し、`install.determinate.systems`と`cache.nixos.org`の許可が要る。却下。
- **箱にはLSPを入れない(ベンダーのcloudと同じ)**: 測定ではLSPの13個が箱で問題なく動くので、入れない理由がない。ただしClaude CodeのLSP pluginが箱の中でserverを起動するかは未確認。

## Consequences

- 実測: installer 5秒、LSP 13個13〜35秒、38個の組47秒。72/73がLinux arm64で評価でき70/72がcache済み。LSPは全部`agent`ユーザーで無設定で動く。
- flakeの改修が要る: per-systemの出力、overlayのLinux側への適用、`--impure`のusername依存を箱の出力から外す。
- 箱の`/nix/store`はMacと共有されない。flake.lockを上げるたびにtemplateの約3GBの層を焼き直す。templateはagentの基盤イメージごとに一つ。
- 前例なし: macOSホストとLinuxの箱を同じflakeから出す例は見つかっていない。6〜7GBのtemplateでのmicroVMの起動時間は未測定。

## Sources

- cosaiのADR（miseを採用しNix/devboxを学習コストで却下した実例）: https://github.com/cosai-oasis/secure-ai-tooling/blob/main/docs/adr/003-devcontainer-mise-architecture.md
- Determinate installer: https://github.com/DeterminateSystems/nix-installer
- closureコピーの前例: https://mitchellh.com/writing/nix-with-dockerfiles 、https://github.com/docker/labs-ai-tools-for-devs
- miseの作者の立場: https://news.ycombinator.com/item?id=42359686 、lockの制約: https://mise.jdx.dev/dev-tools/mise-lock.html
- metabaseの`mise.toml`コピー: https://github.com/metabase/metabase/blob/master/dev/docker/claude-code/Dockerfile
- sbx template: https://docs.docker.com/ai/sandboxes/customize/templates/
