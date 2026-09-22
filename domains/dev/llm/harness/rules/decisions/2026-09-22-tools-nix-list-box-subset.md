# 道具と LSP の元は Nix の flake に置き、容れ物には Linux 向けに絞った一覧を同じ flake から焼く

Status: accepted — 道具の一覧は既に flake にあり、Linux でも動くことを実測し、mise では持てない道具がある（2026-09-22）

rule: Keep CLI/LSP tool sources in the Nix flake and runtimes in mise; never change this split. Build a separate, Linux-only packages.aarch64-linux.box list for containers (not the full host list) and bake it into sbx templates as a copied Nix closure, never by installing Nix itself inside the container; drop terraform from box (BSL, uncached).

## Problem

言語の処理系、LSP、CLI の道具を、ホスト(macOS)と容れ物(Docker Sandboxes の Linux arm64 microVM)の両方に、一つの定義から入れたい。ホストでは道具と LSP の約 100 個が Nix の flake(home-manager)にあり、処理系だけが mise にある。

## Decision

- 道具と LSP の元は Nix の flake のまま。処理系は mise のまま(いまの分け方を変えない)。
- flake の package の一覧を `{ pkgs }` の関数に切り出し、`cli`・`lsp`・`darwinOnly` に分ける。ホストはこれまでどおり全部を使う。
- 容れ物用には別の一覧(`box`)を Linux 向けに絞って作る。ホストの一覧をそのまま入れない(多すぎる)。出発点は実測した 38 個の組だが、箱で使わないもの(GUI や動画処理や DB 本体など)は外す。
- `packages.aarch64-linux.box` として出力し、sbx の template に焼く。形は `nixos/nix` の builder で closure を作り `docker/sandbox-templates:<agent>` の上にコピーする(Nix 本体を箱に残さない)。
- 処理系は同じ `mise.toml` を容れ物にコピーして `mise install` する。
- terraform は箱の一覧から外す(BSL のため cache に無く、毎回ビルドになる。必要なら opentofu)。
- PATH は image の `ENV` で通す(sandbox の entrypoint は shell の rc を読まない)。

## Alternatives considered

- **mise 一本にする**: 実践の実例(metabase、cosai の ADR)は Nix を使っていない環境の選択で、この環境には当たらない。mise の registry に nixd、zls、marksman の経路がなく、gopls や typescript-language-server は `go:`/`npm:` 経由で lock に URL が固定されない。作者自身が「Nix のモデルは壊れている」と述べ、Nix を backend にする案は終わっている。ホストの 73 個の道具を Nix から外す作業も増える。却下。
- **ホストの一覧をそのまま箱に入れる**: 全 70 個の closure は展開後 5.34GiB、箱に要らないもの(yazi 1.2GB、ffmpeg 1.1GB、docker、mysql、GUI 系)を含む。却下。
- **Nix 本体を箱の image に入れる(route A)**: 7.2GB で、closure コピー(6.79GB)より大きく、`nix` が root 専用の面を残す。エージェントが箱の中で道具を足す必要が出たら再考。
- **kit の install で毎回 Nix を入れる**: sbx にローカルの永続ボリュームがなく、作成のたびに 5 秒 + 47 秒と 0.8GB の download が再発し、`install.determinate.systems` と `cache.nixos.org` の許可が要る。却下。
- **箱には LSP を入れない(ベンダーの cloud と同じ)**: 測定では LSP の 13 個が箱で問題なく動くので、入れない理由がない。ただし Claude Code の LSP plugin が箱の中で server を起動するかは未確認。

## Consequences

- 実測: installer 5 秒、LSP 13 個 13〜35 秒、38 個の組 47 秒。72/73 が Linux arm64 で評価でき 70/72 が cache 済み。LSP は全部 `agent` ユーザーで無設定で動く。
- flake の改修が要る: per-system の出力、overlay の Linux 側への適用、`--impure` の username 依存を箱の出力から外す。
- 箱の `/nix/store` は Mac と共有されない。flake.lock を上げるたびに template の約 3GB の層を焼き直す。template は agent の基盤イメージごとに一つ。
- 前例なし: macOS ホストと Linux の箱を同じ flake から出す例は見つかっていない。6〜7GB の template での microVM の起動時間は未測定。

## Sources

- 実測と資料: `rules/research/2026-09-22-nix-vs-mise-agent-box.md`、`rules/research/2026-09-22-box-toolchain-provisioning.md`
- Determinate installer: https://github.com/DeterminateSystems/nix-installer
- closure コピーの前例: https://mitchellh.com/writing/nix-with-dockerfiles 、https://github.com/docker/labs-ai-tools-for-devs
- mise の作者の立場: https://news.ycombinator.com/item?id=42359686 、lock の制約: https://mise.jdx.dev/dev-tools/mise-lock.html
- metabase の `mise.toml` コピー: https://github.com/metabase/metabase/blob/master/dev/docker/claude-code/Dockerfile
- sbx template: https://docs.docker.com/ai/sandboxes/customize/templates/
