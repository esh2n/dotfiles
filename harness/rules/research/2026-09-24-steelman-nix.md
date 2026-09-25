# Nix 擁護論（steelman）: nix-darwin + standalone home-manager 一本化は、この所有者の形にどこまで成り立つか

調査日: 2026-09-24。役割: Nix を最も強く弁護する側（chezmoi は使わない案）。ただし正当な批判は同じ熱量で記録する。並行して chezmoi 側の steelman が別エージェントにより作成されている。

既読・再調査しない3本: `2026-09-24-dotfiles-tool-choice.md`（結論: B/C を支持、A単独には強い反証）、`2026-09-24-role-based-dotfiles.md`（digga撤回、mkOutOfStoreSymlink未解決バグ2件、ayats.org離脱）、`2026-09-23-multi-system-flake-layout.md`（mkSystem共有関数、sanketsudake唯一の完全一致precedent、launchd.agents/systemd.user.services採用実例ゼロ）。これらの既知の弱点（secrets評価がopnixのみでsops-nix/agenix/`op run`未評価、chezmoiのcopyモードをOmarchy symlink破壊バグと比べた点でOmarchy所有ファイルの扱いをどちらの方式も管理すべきでない点を見落とし）を、本記録で埋める。

## 0. 方法・検証凡例

- `[直接]` — `curl`/`raw.githubusercontent.com`/`api.github.com`(`gh auth token`使用。`gh auth status`はkeyring再ログインエラーを出すが、トークン自体はAPI呼び出しに有効) で本文そのものを取得。
- `[要約経由]` — WebFetch/WebSearchの要約を経由。該当箇所に明記。
- `[未到達]` — 試みて失敗（elliotblackburn.comは1回目520エラー、2回目`[要約経由]`で取得成功。BigGoの記事は無関係コンテンツで空振り）。
- GitHub検索・star数はサンプリングであり網羅的ではない。「採用規模のおおまかな比較」としてのみ扱う。

---

## 問い

macOS(Apple Silicon, nix-darwin) + x86_64 Omarchy(Arch, standalone home-manager) の2機で、Nix だけでパッケージ・ファイル・サービスを統一する案（chezmoi不使用）は、この所有者の形（日次編集のnvim/zsh/tmux/terminal/git、外部TypeScript生成器が書く`~/.claude`等、1Password CLI経由のシークレット、launchd/systemd常駐サービス、単一冪等install/update、コンテナに同じパッケージリストから作ったLinuxクロージャを焼く）にどこまで支持されるか。

---

## Nix を選ぶ最も強い論拠

### 1. 再現性とバージョン固定は vendor 機能として実在し、実践者が実際に使っている

`flake.lock` によるピン留めと `darwin-rebuild --rollback`/`home-manager generations` は Nix/nix-darwin/home-manager の一次機能であり、これは既読3本がソース直読済みの `launchd.agents`/`systemd.user.services`（`pkgs.stdenv.hostPlatform.isDarwin`/`isLinux` から自動判定、誤用は評価時アサーション失敗）と同じ「vendorが実際に持っている宣言的な束」の一部。

実践者が数値でこれを裏付けている。`skippednote/dotfiles` PR #2（`[直接]`、`https://github.com/skippednote/dotfiles/pull/2`、chezmoiからnix-darwinへの直接移行）:

> "| Before | After |\n| --- | --- |\n| chezmoi applies `home/` | home-manager out-of-store symlinks |\n| `Brewfile` | `homebrew.{brews,casks,masApps}` |\n| `defaults.sh`, run-once | `system.defaults`, idempotent |\n| 57 mise + 15 uv tools | 58 nixpkgs packages |\n| 380-line Makefile | 4 targets |\n| `~/.dotfiles-backup` | generations + `darwin-rebuild --rollback` |"

380行のMakefileが4ターゲットに縮み、手動バックアップディレクトリが`generations + rollback`に置き換わった、という具体的な縮小幅。`evantravers.com`（`[直接]`、`https://evantravers.com/articles/2024/02/06/switching-to-nix-darwin-and-flakes/`、brew bundle/shell script/Makefile からの移行）も同じ理由を独立に述べる:

> "In my pursuit of treating my computer as cattle not as a pet I have had a series of increasingly complicated systems..." / "I wanted the reproducability of a flake for configuring a computer. Without flakes the configuration would be at the mercy of the host system's channel configuration… and I want to be a little more careful." / "[it] dodges so many headaches and simplifies rolling back changes."

2件とも実際にツールを乗り換えた人物の一次記述であり、「再現性・ロールバック」という主張は測定ではなく体験談レベルだが、独立した2人が同じ効用を報告している。

### 2. 編集可能設定を "out-of-store symlink" で扱う慣習は、所有者の状況と一字一句一致する先例を持つ

既読記録が確認済みの `mkOutOfStoreSymlink`（10,256件のコード検索ヒット、既読）に加え、今回新規に見つけた `skippednote/dotfiles` PR #2 の一文がこの所有者の核心的な懸念——**外部生成器が書き込むファイルをNixストアの読み取り専用コピーで壊さずに済ませられるか**——に直接答えている（`[直接]`）:

> "**Out-of-store symlinks** — six managed files are written by the tools that read them (`.zshrc`, `.gitconfig`, `.ssh/config`, `gh/config.yml`, `lazy-lock.json`, `.claude/settings.json`). Store copies are read-only and would break all six."

`.claude/settings.json` が名指しされている——コーディングエージェントが書き出す設定ファイルを `mkOutOfStoreSymlink` で扱う、という、この所有者のTypeScript生成器問題にほぼそのまま一致する実例。既読の `jpoissonnet/dotfiles`（chezmoi側、`~/.claude.json` を「管理対象に加えない」という解）とは異なる対処——**Nix側は「管理対象に加えた上でout-of-store symlinkにする」という、より踏み込んだ一次解を持つ**、という対比が今回新たに立つ。

### 3. secrets: sops-nix は nix-darwin 向けの一次モジュールを持ち、opnix よりも運用規模で大きく上回る（新規、secrets評価の空白を埋める）

`https://raw.githubusercontent.com/Mic92/sops-nix/master/README.md`（`[要約経由・本文引用]`）:

> "A module for `nix-darwin` is also available for global install with flakes" / "When using `nix-darwin` save the `age` key to `$HOME/Library/Application Support/sops/age/keys.txt`" / "sops-nix also provides a home-manager module. ... It will have to be manually set if home-manager is configured as stand-alone or on non NixOS systems."

対する agenix（`https://raw.githubusercontent.com/ryantm/agenix/main/README.md`、`[要約経由・本文引用]`）は home-manager モジュールの中でDarwinのパス規約（`$(getconf DARWIN_USER_TEMP_DIR)/agenix/<name>`）を示すのみで、**nix-darwin向けのシステムレベルモジュールの記載はREADMEに見当たらない**。

規模の数値（`[直接]`、`api.github.com/repos/...`、2026-09-24時点）:

| repo | star | pushed | open issues |
|---|---|---|---|
| Mic92/sops-nix | 3,176 | 2026-09-24（当日） | 111 |
| ryantm/agenix | 2,490 | 2026-02-04（約7.5ヶ月停止） | 115 |
| brizzbuzz/opnix | 188 | 2026-08-18 | 1 |

**sops-nixはagenixよりstar数で上回り、直近も活発に押されており、かつnix-darwin向け一次モジュールを明記している点で、既読記録が唯一評価していたopnix（サービスアカウントトークン前提、188★）よりこの所有者の形（対話的1Password CLI、macOS+standalone home-managerの両対応）に近い。** ただし opnix はsops-nix/agenixと違い1Password自体を鍵ストアにする点で唯一の直接一致——sops-nix/agenixはage/PGP鍵が別途必要で、1Passwordはその鍵の置き場所ではない、という構造上の違いは残る。

### 4. "Nix が config を置き、secretsは実行時に`op run`相当で取得する" は、実際に運用している名前つき実践者が存在する

`https://blog.oftaylor.com/post/poor-mans-secret-management-in-nix/`（`[要約経由・本文引用]`、著者Taylor、home.activationで`op`CLIを叩く）:

> "I use 1Password and their very useful `op` CLI tool to manage my secrets." / （sops-nixを退けた理由）"managing yet another key and then committing those files to a repo, even though encrypted, wasn't really something I wanted to do."

これは所有者が既に使っている1Password CLIとそのまま一致するパターン。ただし著者自身が留保をつけている:

> "Please note that you do need to have 1Password desktop app installed and the CLI integration checkbox checked for this to work." / 自称"hacky, poor man's way"、"there are probably other, better ways to do this."

**1人の実践者の自認する「泥臭い解」であり、vendorが一次機能として示した方法ではない**——sops-nix/agenixのような宣言的機構と比べ、`home.activation`フックで命令的にスクリプトを実行するだけの、Nixモジュールシステムの外側にある回避策。

### 5. コンテナイメージを同じパッケージリストから焼く仕組みは、vendor機能として実在し実測値もある

`nlewo/nix2container`（`[直接]`、`api.github.com`、914★、pushed 2026-09-24当日、open issues 96）は `dockerTools.buildImage` のアーカイブレス実装。WebSearch要約経由（`[要約経由]`、flox.devブログ他複数ソースの合成）による性能比較:

> "Rebuild/repush times show nix2container.buildImage at ~1.8s compared to dockerTools.streamLayeredImage at ~7.5s and dockerTools.buildImage at ~10s."

**この数値は単一の直接ソースからの逐語引用ではなく複数のWebSearch結果の合成であり、`[要約経由・弱い証拠]`として扱う**——ただし「同じパッケージリストからコンテナクロージャを焼く」という設計そのものは、`dockerTools.buildLayeredImage`がnixpkgs本体の一次機能であることに揺るぎはない。これは所有者の「Docker Sandboxesに同じNixリストから焼いたLinuxパッケージセットを載せる」要件と直接一致する構造。

### 6. macOSのアップデートでNixが壊れる問題は、vendor(Determinate Systems)が自己修復機構として一次対応している

`https://lobste.rs/s/ydtdya/nix_survival_mode_macos_upgrades_won_t`（`[要約経由]`、2023-10-25発表）:

> "macOS regularly wipes out all the symlinks and dotfile customizations within the OS host volume."（コメント引用）/ "Nix Survival Mode" ... automatically repairs Nix after macOS upgrades ... a launch daemon that "runs `/nix/nix-installer repair`" to "re-add snippets added to zshrc, fish config, etc."

`DeterminateSystems/nix-installer`（GitHub reposディスクリプション、`[要約経由]`、WebSearch結果）: "over 7 million installs" ——採用規模として大きい。さらに`[要約経由]`のWebSearch要約:

> "When Determinate first released, nix-darwin users were required to add a special nix-darwin module to their configuration as a compatibility shim, but this module is no longer necessary as of February 2025."

**2023年に一次対応が出荷され、2025年2月にnix-darwinとの互換性摩擦も解消済み——「macOSアップデートでNixが壊れる」という古典的な負の評判に対し、vendorが具体的な自己修復インフラで応えている、という点は擁護材料になる。**

---

## Nix への正当な批判

（既読3本が既に集めた `mkOutOfStoreSymlink` 未解決バグ2件、digga撤回、ayats.orgのhome-manager離脱、Ben Mezgerのmac Nix断念は再掲のみ・再調査せず。以下は今回の新規確認。）

### A. `mkOutOfStoreSymlink` の未解決バグは「stale」の域に入っている（現在時点で再確認）

`[直接]`、`api.github.com/repos/nix-community/home-manager/issues/4692`・`/7187`（2026-09-24時点で再取得）:

| issue | state | comments | 最終更新 |
|---|---|---|---|
| #4692（マルチユーザーNixで`mkOutOfStoreSymlink`がpermission denied） | open | 25 | **2025-03-19**（本記録時点で約1年6ヶ月放置） |
| #7187（`recursive`オプションとの併用がinvalid optionになる） | open | 4 | 2026-04-14（約5ヶ月放置） |

既読記録（role-based記録）は両方を「open」と報告していたが、今回の再確認で #4692 が**1年半近く動きがない**という stale の度合いが新たに判明した。この所有者の要件の核（編集可能設定＋外部生成器の共存）を直撃する機能の主要バグが、事実上放置されている。

### B. macOS 27 (Golden Gate) で nix-darwin が新規に壊れた——2026年9月、極めて最近

`https://github.com/nix-darwin/nix-darwin/issues/1866`・`https://amreis.github.io/misc/2026/09/15/macos27-nix-darwin.html`（`[要約経由]`、2026-09-15付）:

> `darwin-rebuild switch --flake .` failed with "failed to allocate 1048576 bytes at 0x300100000" ... "the issue was coming from mac-app-util"（不整合なSBCLバージョン）... fix: `inputs.nixpkgs.follows = "nixpkgs";` を mac-app-util の入力に追加。

**これは「解決済みの過去の問題」ではなく、この記録の9日前（2026-09-15）に発生した現在進行形のmacOS新バージョン対応の摩擦**——Nix Survival Modeがカバーするのは `/etc/zshrc` のようなシェル統合ファイルの復旧であり、依存関係の評価不整合という**別種の壊れ方**はカバーしない。macOSの大型アップデートのたびに、この種の摩擦が形を変えて再発する構造的パターンがあることを示す最新の実例。

### C. Home Manager の衝突処理は「バックアップなしで既存symlinkを黙って張り替える」という穴を持つ（既読記録で直読済み、再掲）

既読 role-based記録が `modules/files.nix` を直読して確認済みの通り、`legacyLink`は既存のsymlinkに対して`ln -sfn`で**検知なく**張り替える。実ファイルには`backupFileExtension`/`backupCommand`経由の退避があるが、symlinkにはそれがない。Omarchyの`cp -f`よりは「symlinkかどうかを区別する」点で丁寧だが、「外部ツールが張ったsymlinkを検知して stand down する」機能は無い、という限界は解消されていない。

### D. 学習コストと評価待ちのループは、複数の独立した実践者が同じ言葉で報告している

`seroperson.me`（`[要約経由・本文引用]`、chezmoiを含む複数ツールを経験した末にNixへ）:

> "you'll need to rebuild home-manager (run the command above) after each edit. This process removes the convenience of hot-reloads" / "Nix can be challenging to learn and use. Coding and debugging can be frustrating." / "it is not so comfortable to edit `.nix` file with bundled configuration comparing to plain `tmux.conf`."

`elliotblackburn.com`（`[要約経由]`、2回目のWebFetchで取得。1回目はHTTP 520で`[未到達]`）:

> "It's less convenient for things you want to tweak rapidly, test, and iterate on without a full rebuild."（回避策として shell functions と `~/.localrc` エスケープハッチを自作）

`evantravers.com`（既出、§1で好意的に引用した同じ記事内の否定側）:

> "home-manager isn't standalone anymore. I can't run it without running a `darwin-rebuild switch` or `nixos-rebuild switch` command." / "it does seem kind of weird that the only way to get a new tmux plugin is to rebuild the universe from first principles."

**独立した3人が同じ摩擦（rebuild-to-editループ、学習曲線）を別々の言葉で報告しており、これは1件の体験談ではなく収束したパターンとして扱ってよい。** いずれも「だから使うのをやめた」ではなく「回避策を自作して使い続けている」という着地点だが、回避策(`~/.localrc`、shell functions、out-of-store symlink)を自作しなければ素のNixだけでは日次編集ループが成立しない、という点は明確な負の証拠。

### E. 1Password統合の「正しい」やり方が定まっていない——3つの異なる一次解が並立し、どれも部分的

opnix(1Passwordを鍵ストア自体にする、サービスアカウント前提)・sops-nix/agenix(age/PGP鍵が別途必要、1Passwordとは無関係)・`op run`/`home.activation`手書き(§4のTaylor、自称"hacky")の3つが並立し、vendor間で統一された推奨は無い。§3.4で見た通りopnixの前身(mrjones2014/opnix)はハッカソン産でarchived済み——**「1Passwordを使いながらNixで完結させる」という一点だけでも、成熟した単一の答えがまだ無い**。

### F. Home Manager本体の課題規模——977件のopen issue

`[直接]`、`api.github.com/repos/nix-community/home-manager`: star 10,380、pushed 2026-09-24当日、**open issues 977**。活発なプロジェクトであることの裏返しとして、これだけの規模の未解決課題が積み上がっている——個人のdotfilesが依存するエコシステムとしては、issueの絶対数だけを見ても軽くはない。

---

## 両方を使った人の声

既読chezmoi-topic記録・role-based記録が既に発掘した Ben Mezger（Bash→Ansible→Stow→Make→chezmoi→NixOS+home-manager、最終形はハイブリッドで**macOSではNixを断念**）と ayats.org（home-manager完全離脱、ただしNix自体は継続）を再掲した上で、今回新規に見つかった2件を追加する。

### skippednote/dotfiles — chezmoi → nix-darwin へ完全移行し、今のところ後戻りの記述なし

§1で引用したPR #2は「Before/After」表とVerified節を持つ実測レポートで、chezmoiから完全に離脱した。ただし正直な留保も記録されている(`[直接]`):

> "**Known gaps** ... `bootstrap.sh` has never run on a bare Mac."

**既存マシンでの移行検証は済んでいるが、ゼロからの新規マシンでの「単一コマンドで立ち上げ」は本人自身、まだ検証していないと明言している**——これは「移行して満足」という主張に対する、著者自身による誠実な留保。

### kadokusei/dotfiles — chezmoi → Lix+nix-darwin+Home Manager、理由の記述なし（弱い証拠）

`[要約経由]`、PR #1: "chezmoi + Homebrew-for-CLIs + sheldon replaced by Lix + nix-darwin + Home Manager + mise"、26個のchezmoiファイル+「live drift」を移植。**PRの説明文に「なぜ」の記述が一切ない**——「何を」やったかのみが書かれ、chezmoiへの不満もNixへの期待も明記されていない。移行の実在は確認できるが、動機についての一次証言としては使えない、と明記する。

### 逆方向（Nix→chezmoi）は既読記録の通り、理由付きの一次資料が引き続き見つからない

既読記録が既に「htdocs.devの記事はハウツーであって理由の記述がない」と結論済みで、本記録の新規検索でもこれを覆す資料は見つからなかった。**「両方を使ってNixからchezmoiに戻った」という、理由まで書かれた一次の体験談は、この所有者の規模（1〜2台の個人機）では見つからない**——唯一の反例はBen Mezgerだが、これは「chezmoiに戻った」のではなく「macOS側でNixを断念してHomebrew手動+chezmoiのハイブリッドに落ち着いた」という部分的撤退。

---

## 確認できなかったこと（前例なし）

- home-manager `launchd.agents`/`systemd.user.services` を実際の個人dotfilesで採用している実例——既読記録が「前例なし」と結論済みで、本記録の新規検索でも反証は見つからなかった。**Nixが持つ最も強い一次機能(サービス管理の宣言的な対称オプション)が、実践者コミュニティでほとんど使われていない、という空白は今回も埋まらなかった。**
- opnixを実際に日々使っている個人の運用報告(ブログ・体験談)——vendor一次資料(README)以外の第三者の一次資料は見つからなかった。
- sops-nix/agenixをmacOS+Arch両機で実際に併用している個人dotfilesの実例——星数・活発さは確認できたが、「この所有者の2機構成でどちらかを実際に使い切った」個人の一次資料は今回見つからなかった。
- nix2container/dockerTools.buildLayeredImageの性能数値(1.8s/7.5s/10s)の一次ソース直接確認——WebSearch要約の合成のみで、単一の直接引用元ページを特定できていない。
- 「1年以上、macOS+実機Omarchyの両方でNix一本を運用し続けている」実例——既読記録の結論(sanketsudakeが唯一で2週間運用)から更新なし。
- Nixで完全に統一してから、chezmoiや他のツールに**理由付きで**明示的に戻った、この規模の個人の一次資料——見つからなかった(Ben MezgerのmacOS部分撤退が最も近いが、「chezmoiに戻った」全面的な事例ではない)。

---

## 結論

**この形にとって、Nix一本(chezmoi不使用)がどこまで成り立つか、率直に言うと: 「動く」ことは複数の独立した一次資料で示せるが、「摩擦なく回る」ことは示せない。**

**擁護できる最強の論点は3つ、いずれも今回の新規調査で具体的な数値・一次引用が取れた**: (1) `skippednote/dotfiles`のBefore/After表が示す通り、chezmoiからnix-darwinへの移行は実際に行われており、380行のMakefileが4ターゲットに縮み、手動バックアップが`generations + rollback`に置き換わるという具体的な縮小が起きている。(2) その同じリポジトリが、この所有者の核心的な懸念(`~/.claude`のような外部生成器が書くファイル)への答えを`mkOutOfStoreSymlink`+`.claude/settings.json`という名指しの実例で示している——chezmoi側の答え(`jpoissonnet/dotfiles`の「管理対象に加えない」)より踏み込んだ一次解。(3) 1Password統合はopnix一本ではなく、sops-nix(nix-darwin向け一次モジュール明記、3,176★、当日push)・`op run`+`home.activation`(Taylor、実際に運用中だが自称"hacky")という複数の実在する経路がある——既読記録が見落としていたsops-nix/agenixの評価を埋めたことで、「Nix側は1Password統合が弱い」という既読の印象はやや修正される。

**しかし、これらの強みはどれも無傷ではない。** `mkOutOfStoreSymlink`の主要バグ(#4692)は1年半近く放置されたままで、この所有者が最も頼ることになる機能そのものが安定していない。macOS 27での新規の壊れ方(2026-09-15、この記録のわずか9日前)は、「Nix Survival ModeでmacOSアップデート問題は解決した」という主張が部分的にしか正しくないことを示す——シェル統合の復旧は自動化されたが、依存関係評価の不整合という**別の壊れ方**は毎回のOSメジャーアップデートで形を変えて再発しうる構造がある。学習コストとrebuild-to-editの摩擦は、chezmoiを含む複数ツールを経た実践者(seroperson.me)、Nix単独で始めた実践者(elliotblackburn.com)、nix-darwinへの移行に満足している実践者(evantravers.com)の3人が、互いに独立して同じ言葉で報告している——「回避策を自作すれば使える」という着地点は共通だが、**素のNixだけでは日次編集ループが完結しない**という事実は動かない。1Passwordについても、sops-nix/agenix/opnix/`op run`という4つの異なる経路が並立しているという事実そのものが、「1つの定まった正解が無い」ことの証拠でもある。

**支持されない主張**: 「Nixだけで両機を隙間なく、摩擦なく統一できる」——`mkOutOfStoreSymlink`の未解決バグ、977件のhome-manager open issue、macOS 27での新規破損が同時に存在する状態でこの主張はできない。「Nix Survival Modeでmacアップデート問題はもう起きない」——2026-09-15の実例がこれを直接反証する。「1Password統合はopnixで完結する」——sops-nixの方がnix-darwin一次モジュールを持ち規模も大きく、`op run`パターンも実在するが、いずれも部分的な解であり統一見解ではない。

**平易に言うと**: Nixで両機を統一するのは、やってできないことではない——実際にやって満足していると書いている人(skippednote、evantravers)がいる。だが「declarative・reproducibleだから摩擦が消える」わけではなく、その摩擦を自分で回避策を書いて埋めている人ばかりで、その回避策自体(out-of-store symlink、`~/.localrc`、`home.activation`での`op`呼び出し)がすでに「素のNixモジュールシステムの外側にある手作りの継ぎ目」である、という点は正直に見ておく必要がある。chezmoi側のsteelmanが同じ重さで検証されるべきなのは、まさにこの「継ぎ目の数と性質」の比較になるはずである。
