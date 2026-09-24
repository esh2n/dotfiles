# Platform × Role → Capabilities: dotfiles でのロール抽象化パターン調査

調査日: 2026-09-24。前提として再調査しない既存記録: `2026-09-23-multi-system-flake-layout.md`（ホスト単位キー付き共有 `mkSystem` 関数、macOS=nix-darwin+home-manager、Linux(Omarchy)=standalone `homeConfigurations`、`builtins.getEnv "USER"` は実践者ゼロ、という結論）と `2026-09-24-dotfiles-on-omarchy.md`（Omarchy は `~/.config` をユーザー領域と宣言しつつ `omarchy-refresh-config` の `cp -f`/`mv` がシンボリックリンクを破壊する未修正バグが複数 open、公式 Discussion では chezmoi が優勢、Stow が star 数で優勢、という食い違い）。本記録はこの2本の続き。**flake の出力をどうホストキーで分けるか」は既に決着済みなので再調査しない。今回の焦点は「ホストが増えたときに、パッケージ・サービス・configリンクの束をどう `role`（や `profile`/`class`/`suite`）として括り、その役割をリポジトリにハードコードせずにどう選ぶか」、および「bashの自前シンボリックリンクマネージャを home-manager 自身の機構に置き換えるべきか」の2点。**

## 方法・検証凡例

- `[直接]` — `curl`/`raw.githubusercontent.com`/`api.github.com`（`gh auth token` の値を `Authorization: Bearer` ヘッダで使用。`gh auth status` はキーチェーンの再ログインエラーを報告するが、このトークン自体は API 呼び出しには有効だった）で生データを取得し、本文をスクリプトで抽出したもの。明記なき引用はすべてこれ。
- `[要約経由]` — WebFetch/WebSearch の要約を経由したもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの。
  - `nix-community.github.io/home-manager/index.xhtml#sec-usage-mkoutofstoresymlink` — JS リダイレクトスクリプトのみでコンテンツ本体が無く、`[直接]` のソース読み（`modules/lib/file-type.nix`, `modules/files.nix`）で代替。
  - `chezmoi.io/user-guide/manage-different-types-of-machine/` — 404（該当ページ名は現在 `manage-machine-to-machine-differences/` に変更されており、sitemap.xml から正しい URL を特定して直接取得）。
  - `chezmoi.io/user-guide/manage-machines-to-which-you-dont-have-root-access/` — 404。
  - `www.foodogsquared.one/posts/2023-03-24-managing-mutable-files-in-nixos/` — 301 で `http://foodogsquared.one/`（トップページ）にリダイレクトされ、記事本文を取得できず。内容は放棄、代わりに WebSearch のスニペットのみ参照（`[要約経由]`、本文未確認として扱う）。
  - `raw.githubusercontent.com/nix-community/nh/master/README.md` — 404（正しいパス/組織名を特定できず、`nh` 公式ドキュメントの一次確認は今回できなかった）。
- GitHub code/commit search は GitHub 独自のサンプリングインデックスであり網羅的ではない。件数は「採用規模のおおまかな比較」としてのみ扱う。

---

## 問い

1. 「platform × role → capabilities」の業界標準パターンは何か。候補: Nix の `mkEnableOption` ベースのロール/プロファイル/"features"、chezmoi のテンプレート（`.chezmoi.os` + データ）、Ansible の roles + inventory groups、yadm の alternates/classes。それぞれ誰が使い、ホスト名をハードコードせずにどうロールを選んでいるか、何が失敗したか。
2. ホスト名をリポジトリに出さない実践者は、ビルド時の設定選択をどうしているか（`homeConfigurations.<x>` + `builtins.getEnv` + `--impure`、マシンローカルの追跡外ファイル、`nh`/`home-manager switch --flake .#role`、chezmoi のマシン別 config ファイル）。純粋性・`--impure` の欠点・CI 評価での失敗。
3. bash のシンボリックリンクマネージャとドメイン別 `install.sh` を home-manager 自身の機構（`home.file`、`mkOutOfStoreSymlink` 付き `xdg.configFile`、`home.activation`、`launchd.agents`/`systemd.user.services`）に置き換えるべきか。編集可能な設定（nvim/tmux）を home-manager 配下でどう扱っているか、何が壊れたか。OS ベンダーがファイルを書き換える機種（Omarchy のシンボリックリンク上書き）で home-manager の衝突処理（拒否・`-b backup`・`force`）は bash リンカより優れているか劣るか。
4. 否定側の証拠: ロール/プロファイル抽象化を採用してから過剰設計として撤去したリポジトリ、chezmoi↔Nix の乗り換えとその理由。

---

## 各レンズの所見

### 1. ベンダー

#### 1.1 Nix のモジュールシステム自体に「role」という一次語彙は無い

home-manager・nix-darwin・NixOS のモジュールシステムが提供するのは `mkEnableOption`・`mkOption`・`lib.mkIf`・`imports` だけで、「role」「profile」「suite」という名前の付いた組み込みプリミティブは存在しない（前回記録 §1.2 で直接確認した `modules/launchd/default.nix`/`modules/systemd.nix` の `assertPlatform`/`isDarwin` パターンも、あくまで `mkEnableOption` の合成でしかない）。**つまり「ロールで束ねる」設計は 100% 実践者の慣習であり、vendor が正解を1つ示しているわけではない。** これは §1.2〜1.5 で見る通り、複数の異なる慣習が並立している理由でもある。

#### 1.2 divnix/digga — 「Modules, Profiles & Suites」を公式語彙として実装した唯一のプロジェクトは、メンテナ自身により非推奨化された

`https://raw.githubusercontent.com/divnix/digga/main/README.md`（`[直接]`）は今もこの語彙を説明している:

> "**Modules** are abstract configurations that, while holding the implementation, do not set any system state." / "**Profiles** are concrete configurations that set system state within the profile domain." / "**Suites** are a composable, clean and discoverable mechanism for profile aggregation."

しかし README の先頭には赤字級の告知がそのまま残っている:

> "# DEPRECATION NOTICE — This project is no longer maintained and not recommended for any sort of use case. Please see https://github.com/divnix/digga/issues/503 for better alternatives and the reasons behind this decision."

リポジトリ自体は `archived: false` だが `pushed_at: 2024-05-17T10:20:04Z`（本記録時点で2年4ヶ月停止）、star 1,017（`https://api.github.com/repos/divnix/digga`、`[直接]`）。Issue #503「Ending digga」（2023-04-29 作成、21コメント、`https://github.com/divnix/digga/issues/503`、`[直接]`）の本文（メンテナ本人）:

> "I would be hard pressed to recommend digga to anyone anymore. It has become increasingly difficult to maintain and has a number of bugs hidden behind its API. ... Digga's unique features are auto-exporting, building hosts and home configurations, and automatic host testing. Auto-exporting is riddled with bugs (ex: https://github.com/divnix/digga/issues/496) and in retrospect I think it was a mistake."

コメント欄（`[直接]`、同 issue の comments API）から:

> Pacman99 (2023-05-12): "I think one of the issues of digga is that we had so many ideas and wanted to implement all of them, but they all got implemented poorly. We spent time thinking about each idea and its implementation, but when we put them together it was hard to work out a good api to integrate them all. And maybe the reason is that such an api doesn't exist."
> tgunnoe (2023-06-15): "archive it. I moved to flake-parts."

これは Q4（否定側の証拠）に直結する一次資料であり、同時に Q1 への回答の一部でもある: **「Profiles/Suites」を名付きの一次抽象として実装する試みは既に一度行われ、メンテナ自身が撤回を提案し、コミュニティが flake-parts/std/手書き `nixosSystem` へ移行した。** これは「1台の macOS + 1〜2台の Linux」という本件の規模には最初から過剰であった可能性が高い、という文脈も comments から読み取れる（`btobolaski` のコメント: 16システムを管理していた大規模ユーザーでさえ「わからないまま使い続けていた」と述懐している）。

#### 1.3 chezmoi — 組み込み変数（`.chezmoi.os`/`.chezmoi.hostname`）とローカル未追跡データファイルの二層構造。「ロール」専用の一次機能は無い

`https://chezmoi.io/user-guide/manage-machine-to-machine-differences/`（`[直接]`、301経由で `www.chezmoi.io` の実ページから本文抽出）:

> "To handle this, on each machine create a configuration file called `~/.config/chezmoi/chezmoi.$FORMAT` defining variables that might vary from machine to machine." / "Templates are often used to capture machine-specific differences. For example, in your `~/.local/share/chezmoi/dot_bashrc.tmpl` you might have: ... `{{- if eq .chezmoi.hostname "work-laptop" }}` ..."

つまり **vendor の公式サンプル自体が、ホスト名を直接テンプレート条件式に埋め込んでいる**（この `dot_bashrc.tmpl` はリポジトリにコミットされる想定のファイル）。一方で、変わりやすい・ホスト固有のデータ（今回でいう「role」に相当し得るもの）は `~/.config/chezmoi/chezmoi.toml` というマシンローカルの追跡外ファイルに置く二段構えになっている。同ページはさらに OS 単位の完全な出し分けも示す:

> "`{{ if eq .chezmoi.os "darwin" -}}`... `{{ else if eq .chezmoi.os "linux" -}}`..." / "`chezmoi execute-template "{{ .chezmoi.os }}/{{ .chezmoi.arch }}"`"

`.chezmoi.os`/`.chezmoi.hostname`/`.chezmoi.osRelease` は組み込みの読み取り専用変数であり（`https://www.chezmoi.io/reference/templates/variables/`、`[要約経由]`）、ユーザー定義の「ロール」相当のフラグは公式には `promptBoolOnce` で初期化時に一度だけ尋ね、結果を `~/.config/chezmoi/chezmoi.toml`（**リポジトリの外**）にキャッシュする形が用意されている。`https://www.chezmoi.io/reference/templates/init-functions/promptBoolOnce/`（`[直接]`）:

> "promptBoolOnce map path prompt [default] — promptBoolOnce returns the value of map at path if it exists and is a boolean value, otherwise it prompts the user for a boolean value with prompt and an optional default using promptBool." 例: `{{ $hasGUI := promptBoolOnce . "hasGUI" "Does this machine have a GUI" }}`

`.chezmoidata/` は逆に**静的データのみ**で、動的な初期化質問はできない旨が明記されている（`https://www.chezmoi.io/reference/special-directories/chezmoidata/`、`[直接]`）:

> "Files in .chezmoidata directories cannot be templates because they must be present prior to the start of the template engine. Dynamic machine data should be set in the data section of `.chezmoi.$FORMAT.tmpl`."

**読み方**: chezmoi の vendor 推奨は「OS はビルトイン変数で判定してよい（ホスト名を出さない）、ロールのような人間が決める分類は `promptBoolOnce` で一度尋ねてローカル未追跡ファイルに焼く」という二層構造。ただし公式サンプル自体がホスト名の直書きも平気で示しており、「ホスト名を一切出さない」がchezmoi自身の絶対原則というわけではない。

#### 1.4 Ansible — roles はホスト名フリー、ホストとロールの対応づけは inventory の「group」が担う

`https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html`（`[直接]`）: role のディレクトリ構造（`roles/common/{tasks,handlers,templates,files}/...`）はホスト名に一切触れない、再利用可能な単位として設計されている。ホストをロールに紐づける機構は inventory 側にある。`https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html`（`[直接]`）:

> "[webservers]\nfoo.example.com\nbar.example.com\n[dbservers]\none.example.com\n..." / "The headings in brackets are group names. You can use group names to classify hosts and to decide which hosts you are controlling at what times and for what purpose." / "You can create groups that track the following criteria: What - An application, stack, or microservice... Where - A datacenter or region... When - The development stage..."

**この構造は「ロール定義自体はホスト名フリー、ホスト→ロールの対応づけだけが環境固有の inventory ファイルに書かれる」という点で、後述の yadm `class` や chezmoi のローカル `chezmoi.toml` と同じ設計思想に収束している。** ただし Ansible は「フリート（多数のサーバー群）を中央から冪等に構成する」ためのツールであり、本件のような「1〜2台の個人機を各自が手元で `switch`/`apply` する」規模とは前提が異なる（inventory ファイルという「もう1つの真実源」を管理する運用コストが常につきまとう）——規模の違いとして明記しておく。

#### 1.5 yadm — `class` はほぼそのまま「role」の実装。ローカル git config に保存され、リポジトリには出ない

`https://yadm.io/docs/alternates`（`[直接]`）は「role」という語は使わないが、機能としては最も直接的な一致:

> "`class`, `c` — Valid if the value matches the local.class configuration. Class must be manually set using `yadm config local.class <class>`." / "Class is a special value which is stored locally on each host (inside the local repository). To use alternate symlinks using `##class.<CLASS>`, you must set the value of class using the configuration `local.class`." / "`yadm config local.class Work`"

条件は `arch`/`class`/`distro`/`distro_family`/`hostname`/`os`/`user` の組み合わせをファイル名サフィックス（`##os.Darwin,hostname.host2` 等）で書き、最も条件数の多い一致が採用されるスコアリング方式:

> "Assume the following files are managed by yadm's repository: `$HOME/path/example.txt##default` ... `$HOME/path/example.txt##os.Darwin,hostname.host2` ... If running on a MacBook named host2, yadm will create a symbolic link which looks like this: `$HOME/path/example.txt → $HOME/path/example.txt##os.Darwin,hostname.host2` ... If running on another MacBook named host3 ... the more generic version is chosen."

**これが今回調べた4候補の中で唯一、「ロール（class）を選ぶ行為そのものが、リポジトリの外＝ローカルの `.git/config` 相当の場所に書き込まれる」ことを一次機能として持つツール。** `hostname` 条件も使えるが、それはあくまでファイル名サフィックスの一部であり、`class` を使えばホスト名を一切書かずに「Work」のようなロール名だけで出し分けられる。

#### 1.6 home-manager: `mkOutOfStoreSymlink` の実装と、衝突処理をソースから直接確認

`https://raw.githubusercontent.com/nix-community/home-manager/master/modules/files.nix`（`[直接]`）の `legacyLink` スクリプトを読むと、home-manager の activation 時リンク処理は2パスに分かれている:

**高速パス（分類ループ）**:
```
if [[ -L "''${targetPath%/*}" ]] ; then
  slowSources+=("$sourcePath")   # 親ディレクトリ自体がsymlinkなら低速パスへ
elif [[ -L "$targetPath" ]] ; then
  symlinkTargets+=("$targetPath"); symlinkSources+=("$sourcePath")  # 既存symlinkは再リンク候補
elif [[ -e "$targetPath" ]] ; then
  slowSources+=("$sourcePath")   # 実ファイル/ディレクトリは低速パスへ
else
  linkSources+=("$sourcePath"); linkDirs+=("''${targetPath%/*}")
fi
```
既存の symlink（自分の以前の世代であれ、外部ツールが張ったものであれ）は `readlink` で内容を比較し、新世代を指していなければ `ln -sfn` で**バックアップなしに黙って張り替える**（コメント曰く "-f -n together replace a stale symlink even when it points at a directory"）。

**低速パス（実ファイル・実ディレクトリが既にある場合）**:
```
if [[ -e "$targetPath" && ! -L "$targetPath" ]] ; then
  if [[ -n "$HOME_MANAGER_BACKUP_COMMAND" ]] ; then ... run $HOME_MANAGER_BACKUP_COMMAND ...
  elif [[ -n "$HOME_MANAGER_BACKUP_EXT" ]] ; then
    backup="$targetPath.$HOME_MANAGER_BACKUP_EXT"
    run mv $VERBOSE_ARG "$targetPath" "$backup" ...
  fi
fi
if [[ -e "$targetPath" && ! -L "$targetPath" ]] && cmp -s "$sourcePath" "$targetPath" ; then
  verboseEcho "Skipping ... as it is identical"
else
  run ln -Tsf $VERBOSE_ARG "$sourcePath" "$targetPath" || exit 1
fi
```
`HOME_MANAGER_BACKUP_EXT`（`home-manager switch -b <ext>` や `backupFileExtension` オプション）が設定されていれば実ファイルを `.ext` へ退避してから symlink を張る。内容が同一ならスキップ。**設定されていない場合にこのスクリプトが実際にどこで中断するのかは、このソース断片だけからは追い切れなかった**（`home-manager` CLI 側に別の事前チェックがある可能性が高いが、その箇所は今回未取得 — `[未確認]` として明記）。

`mkOutOfStoreSymlink` 自体の定義は `modules/lib/file-type.nix`（`[直接]`確認したが grep ではヒットせず、別ファイル `modules/lib/types.nix` にあると推定される場所を特定しきれなかった。**実装の正確な行は未確認**。ただし挙動と既知の不具合は §2/§3 の一次issueで裏取りできている）。

**Omarchy との対比（前回記録 §1 参照、再取得せず引用のみ）**: Omarchy の `omarchy-refresh-config` は「対象がシンボリックリンクかどうか」を検査せずに `cp -f`/`mv` する実装であり、前回記録が引用した issue #11096 の報告 "`mv` onto a symlink replaces the link itself." がその結果を説明している。対して home-manager の `legacyLink` は分類ループの最初の分岐で明示的に `-L` を検査しており、既存の symlink には `ln -sfn`（リンクそのものの張り替え）を行う一方、実ファイルには別処理（バックアップ or 拒否）を行う——**「symlink か実体か」を区別して扱うという設計そのものは Omarchy の実装より一段丁寧**。ただし home-manager も「既存の symlink を黙って（バックアップなしに）再リンクする」点は同じ穴を持つ：外部ツール（yadm/stow/chezmoi）が張った symlink を home-manager が検知なく上書きする可能性は残る——これは今回 issue としては見つからなかった（§4 の「前例なし」参照）。

---

### 2. 実践者

#### 2.1 ryan4yin/nix-config — ディレクトリ合成型「role」。ホスト設定は12行、role は `modules/nixos/<role>/` に住む

（前回記録 §2.4 でリポジトリの全体像・star数・push日は確認済みのため再掲しない。今回はロール粒度を深掘り。）`https://raw.githubusercontent.com/ryan4yin/nix-config/main/hosts/darwin-fern/default.nix`（`[直接]`）は全文がこれだけ:

```nix
_:
{
  networking.hostName = "fern";
  networking.computerName = "fern";
  system.defaults.smb.NetBIOSName = "fern";
}
```

ロールに相当する実体は `modules/nixos/` 配下のディレクトリそのもので、`https://api.github.com/repos/ryan4yin/nix-config/contents/modules/nixos`（`[直接]`）は `base/`・`desktop.nix`・`desktop/`・`server/` を持つ。`modules/nixos/desktop/`（`[直接]`）は `computer-use.nix`・`fonts.nix`・`gaming.nix`・`peripherals.nix`・`virtualisation.nix` 等、デスクトップ機に必要な設定ファイルの束。**つまりこのリポジトリの「role」は `mkEnableOption` フラグではなく「ディレクトリを import するかどうか」で表現されている**——host が `desktop` ロールを持つなら `modules/nixos/desktop` ディレクトリを丸ごと import する構成（`outputs/default.nix` の `nixosSystems`/`darwinSystems` 生成コードは前回記録 §2.4 で直読済み）。

#### 2.2 dejanr/dotfiles — `mkEnableOption` ベースの `roles.<name>.enable` パターンの実例

GitHub code search（`[直接]`、`q="roles.desktop.enable" extension:nix"`）で29件ヒットした中の1つ、`https://raw.githubusercontent.com/dejanr/dotfiles/master/hosts/atlas/configuration.nix`（`[直接]`）:

```nix
  modules.nixos.roles.desktop.enable = true;
  modules.nixos.roles.dev.enable = true;
```

リポジトリは15 star、`pushed_at: 2026-09-17`（`[直接]`、`api.github.com/repos/dejanr/dotfiles`）——小規模だが直近1週間以内にpushされている現役リポジトリで、設問が候補に挙げた「`mkEnableOption`-based roles」パターンの実在確認になる。同じ検索ヒットには `rake5k/nixcfg`、`EcmaXp/nx-public`（`modules/home/desktop/default.nix`）、`youturn45/nix-personal-config` も含まれる——星数の大きい有名リポジトリではないが、パターン自体は孤立事例ではない。

#### 2.3 flyingcircusio/fc-nixos・dolphin-emu/sadm・delroth/infra.delroth.net — 本番インフラでの `roles/` ディレクトリ（参考データ、規模が違う）

`https://api.github.com/repos/flyingcircusio/fc-nixos/contents/nixos/roles`（`[直接]`）は49エントリ（`ai-api-gateway.nix`・`antivirus.nix`・`elasticsearch.nix`・`ceph/`・`consul/` 等）——ホスティング事業者 Flying Circus 社の本番 NixOS 構成で、1ファイル=1ロールという命名慣習が業界で使われていることの確認にはなるが、**これは多数のサーバーを抱える会社のインフラコードであり、個人 dotfiles の規模・目的とは前提が違う**、参考データとして扱う。`dolphin-emu/sadm`（`roles/central/`, `roles/mastodon/`, `roles/etherpad/`）、個人の `delroth/infra.delroth.net`（`roles/s3.nix`, `roles/nas.nix`）も同じ命名慣習の個人インフラ版。

#### 2.4 Misterio77 の訂正（前回記録 §4.1 を再確認、新規事実として "features" の不存在を明記）

設問が候補に挙げた「Misterio77's nix-config `features`」について、`https://raw.githubusercontent.com/Misterio77/nix-starter-configs/main/standard/flake.nix` を `[直接]` grep したが `feature`/`role`/`profile` のいずれの語も出現せず、`https://api.github.com/repos/Misterio77/nix-starter-configs/contents/standard/home-manager` は `home.nix` 1ファイルのみ。**「features」という名前のロール抽象化はこのリポジトリには存在しない**（前回記録が既に指摘した「`Misterio77/nix-config` というリポジトリ自体が存在しない」訂正の続き）。設問の前提情報が誤っている、と明記する。

#### 2.5 sanketsudake, mitchellh 等（前回記録を参照、再取得せず）

「macOS(nix-darwin) + 実機Omarchy(standalone home-manager)」の唯一の完全一致例である `sanketsudake/dotfiles` の `dotfiles.omarchy` という repo-local boolean option（前回記録 §2.5 で直読済み）は、まさに「role相当のフラグをリポジトリ内の変数として持つ」パターンの実例——ホスト名ではなく `dotfiles.omarchy = true/false` という **capability の有無**をキーにしている点で、今回の `roles.desktop.enable`（§2.2）や yadm の `class`（§1.5）と同じ思想。前回記録の引用: "Defaults reproduce the Mac exactly; a host module ... overrides what differs." — これはこの持ち主の「platform × role → capabilities」という発想そのものと最も近い、既に発見済みの実例。

---

### 3. 測定・実態（数値付き）

| 対象 | 数値 | 出典 |
|---|---|---|
| `"roles.desktop.enable" extension:nix`（GitHub code search） | 29件 | `[直接]` api.github.com/search/code |
| `mkEnableOption + "roles." extension:nix` | 1,060件 | `[直接]` 同上（粗いノイズ込みの上限値） |
| `"profiles/" mkEnableOption path:hosts extension:nix` | 67件 | `[直接]` 同上 |
| `flake.modules language:Nix filename:flake.nix`（flake-parts の新モジュールシステム） | 65件 | `[直接]` 同上——前回記録が確認した `flake-parts.lib.mkFlake` 15,808件と比べ、`flake.modules` の採用はまだ極小 |
| `mkOutOfStoreSymlink extension:nix` | 10,256件 | `[直接]` 同上——大規模採用、home-manager ユーザーの間で広く使われている慣習であることの裏付け |
| digga (`divnix/digga`) star / 最終push / archived | 1,017 / 2024-05-17 / `false`（ただしREADME内に非推奨告知） | `[直接]` api.github.com/repos/divnix/digga |
| digga「Ending digga」issue #503 | 2023-04-29作成、コメント21件、今も open | `[直接]` api.github.com/repos/divnix/digga/issues/503 |
| home-manager issue #4692（`mkOutOfStoreSymlink` + 多ユーザーNixで permission denied） | open、コメント4件以上、原因は `NixOS/nix#8965`（Nix 2.19.0で導入された挙動変更）に遡ると指摘 | `[直接]` api.github.com |
| home-manager issue #7187（`recursive` オプションと `mkOutOfStoreSymlink` の併用が invalid option になる） | open | `[直接]` api.github.com |
| home-manager issue #6370（同根） | issue #7187 内で言及（本体は未取得、参照のみ） | `[直接]`（issue本文内の言及） |

---

### Q2 への回答: ホスト名をリポジトリに出さずに「どのconfigを使うか」を選ぶ実践

前回記録 §1.5〜1.6・§2 で既に確認済みの事実（再掲のみ、再調査なし）: 読んだ4実践者（mitchellh・dustinlyons・Misterio77・ryan4yin）は全員ユーザー名を固定文字列にしており `builtins.getEnv` の使用例はゼロ。`homeConfigurations`/`darwinConfigurations` のキーは `<user>@<hostname>` という文字列そのものであり、そのキーは **リポジトリのコードが計算するのではなく、`home-manager switch --flake .#<user>@<hostname>` を打つ操作者が毎回コマンドラインで指定する**（Misterio77 テンプレートの `# FIXME replace x86_64-linux with your architecture` というコメントも同じ姿勢——「機械が自動判定する」のではなく「人間が選ぶ」）。**これが実践者の答えの本質**: `builtins.getEnv "USER"` のような「ビルド時に環境から読む」やり方は避けられているが、「ホスト名という概念自体を消す」わけでもない——ホスト名/ユーザー名は「flake.nix が計算する変数」ではなく「呼び出しコマンドの引数」という位置に押し出されている。chezmoi の `~/.config/chezmoi/chezmoi.toml`（§1.3）、yadm の `local.class`（§1.5）も同じ構造：**「どのロールか」を決める情報は常にリポジトリの外側（コマンドライン引数か、追跡されないローカルファイル）に置かれる。**

`--impure` の欠点（`builtins.getEnv`）は前回記録 §1.6・§3.3 で既に vendor 一次資料（`nix.dev` の pure-eval 説明、`NixOS/nix#12493`/`#6684`）から確認済みのため再調査しない。

---

### Q3 への回答: bash symlink manager を home-manager 機構に置き換えるべきか

**証拠が支持する範囲**: `mkOutOfStoreSymlink`（§1.6, §3）は10,256件のコード検索ヒットという規模で広く使われている実在の慣習であり、編集可能な nvim/tmux 設定を home-manager 配下に置く標準手法として確立している（WebSearch 経由で見つかった実例群——nekomangini/nix-server の PR、haseebmajid.dev のブログ、seroperson.me のブログ——はいずれも `[要約経由]` かつ本記録では本文を直接取得していないため、"広く使われている" という規模の主張は §3 のコード検索件数に、個別の実装コツはこれらの二次的な言及に依拠していると明記する）。

**証拠が反対する範囲、はっきりと**: `mkOutOfStoreSymlink` には未修正の既知バグが少なくとも2件、issue tracker 上に open のまま残っている（§3 の #4692: マルチユーザーNixインストールで `Permission denied`、原因は `NixOS/nix#8965` 由来と特定済みだが2026-09-24時点で未解決。#7187: `recursive` オプションとの併用が壊れる）。さらに、home-manager そのものを完全に手放した実践者の一次資料がある: `https://ayats.org/blog/no-home-manager`（Fernando Ayats、2024-09-10、`[直接]`）の "Dropping Home-Manager" は、`mkOutOfStoreSymlink` を名指しで最初の技術的不満に挙げている:

> "`mkOutOfStoreSymlink`: I hate it. It should not exist. But it exists just to 'not break compatibility'. ... Home Manager just disregards this, and will try to intern string types, meaning you can't refer to absolute paths if you use flakes. This function, `mkOutOfStoreSymlink` does some hack to get around this. The stale issue is here: #3032."

同じ記事はさらにファイルバックアップの無制限蓄積についても具体的に書いている:

> "Home Manager has two behaviors that you can choose: aborting, or backing up the file in question. For the second option, Home Manager will create backups indefinitely, you can't limit them. I failed trying to push for a file-deleting solution, please read and make your own conclusions: #4971. Myself from the future: as I was writing this, I discovered there is an undocumented `.force` option, which predates my PR. Too many mixed signals..."

そして本件の問い（configファイルが本当にread-onlyのNixストアの保証を破る）そのものを名指ししている:

> "Using configuration files that live in a regular directory like `~/.config`, starts to break the guarantees that Nix brings. I'm certainly more confident that a regular program might overwrite the symlinks that Home-Manager placed at activation-time."

Ayats の対案は「home-manager をやめて `wrapProgram`/`symlinkJoin` でラッパーバイナリを作る（`~/.config` に触らせない）」であり、この持ち主が今リポジトリで使っている「bash symlink manager + `~/.config` へのリンク」という発想そのものとは方向性が異なる別解——ただし **これ1件で結論とはしない**（Q4の四方向証拠収集の原則通り、1つの体験談だけでは反証にならない）。

**launchd.agents / systemd.user.services の実践者採用**: 前回記録 §7 が既に確認した通り、これらのネイティブオプションを実際に使っている個人 dotfiles の実例は今回も見つからなかった（新規検索でも追加の実例は発見できず、前例なしのまま）。

**Omarchy 衝突処理との比較（Q3後半）**: §1.6 で直読した home-manager の `legacyLink` は「対象が symlink かどうか」を明示的に分岐しており、実ファイルには `backupFileExtension`/`backupCommand` 経由の退避か、内容が同一ならスキップという扱いをする。前回記録が引用した Omarchy の `omarchy-refresh-config`/`omarchy-shell-config` の `cp -f`/`mv` はこの区別をせず、symlink の中身（リンク先の実ファイル）を直接上書きするか、`mv` でリンクそのものを消して実体コピーに置き換える（前回記録引用: issue #11096 "`mv` onto a symlink replaces the link itself."）。**この一点に限って言えば、home-manager の衝突処理の方が Omarchy の自前スクリプトより技術的に丁寧**——ただし home-manager 側も「既存の symlink を検知なく黙って再リンクする」という同種の穴を持っており（§1.6 末尾）、「Omarchy の上に home-manager を置けば symlink 破壊問題が完全に解決する」という主張はできない。両者とも「外部ツールが張った symlink を検知して stand down する」機能は持たない（Omarchy 自身の `plans/dots.md` が将来実装として掲げている "stand down, don't fight" は前回記録の通り未出荷）。

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **digga の「Modules, Profiles & Suites」自体が撤回された** — メンテナ本人が2023-04-29に "I would be hard pressed to recommend digga to anyone anymore" と書き、21件のコメントの多くが flake-parts・std・手書き `nixosSystem` への移行を報告している（§1.2）。これは設問が候補に挙げた「digga の profiles/suites」パターンそのものへの直接の反証。
- **`mkOutOfStoreSymlink` の未解決バグ2件** — #4692（マルチユーザーNixで permission denied、`NixOS/nix#8965` 由来と特定済みだが2026-09-24時点で放置）、#7187（`recursive` オプションとの併用が invalid option）。いずれも open のまま。
- **home-manager を完全に手放した一次資料** — ayats.org "Dropping Home-Manager"（2024-09-10）。`mkOutOfStoreSymlink` への名指しの拒否感、無制限に溜まるバックアップファイル、symlink が Nix の保証を破るという設計批判。ただし著者は NixOS 上でパッケージラッパー方式に切り替えただけで「Nix 自体をやめた」わけではない——「configを`~/.config`にsymlinkで置く」という発想全般への懐疑であり、chezmoi/yadm等への乗り換えではない点に注意。
- **htdocs.dev の Nix→chezmoi 移行記事は「理由」を書いていない** — `https://htdocs.dev/posts/migrating-from-nix-and-home-manager-to-homebrew-and-chezmoi/`（2025-04-03、`[直接]`）は移行手順のハウツーガイドであり、個人の体験に基づく不満の記述が本文に見当たらなかった。"migrate ... from the declarative world of Nix/Home-Manager/Flakes to the more imperative (but organisable) world of Homebrew and Chezmoi" という一文があるのみで、これを「Nixをやめた理由」の一次証言として使うのは無理がある——**弱い証拠として明記し、強い主張には使わない**。
- **Omarchy の symlink 破壊バグ**（前回記録から引用のみ、再取得せず）— `omarchy-refresh-config`/`omarchy-shell-config` の実装は stow/chezmoi/yadm いずれの symlink 管理とも構造的に衝突する。

---

## 確認できなかったこと

- home-manager の `legacyLink` スクリプトで `HOME_MANAGER_BACKUP_EXT`/`HOME_MANAGER_BACKUP_COMMAND` の両方が未設定の場合に、実際に何が起きるか（古典的な "existing file already in place" エラーがどのスクリプトから出るのか）——`modules/files.nix` の該当断片だけからは追い切れず、home-manager CLI 側の別の事前チェックスクリプトは今回取得していない。
- `nh`（nix helper CLI）の公式ドキュメント一次確認——リポジトリの正確なパスを特定できず、README取得は404。「`nh os switch -H <hostname>` でホスト名をCLI引数として渡す」という記述は WebSearch の要約経由のみで、一次資料での裏取りはできていない。
- foodogsquared.one の "Managing mutable files in NixOS" 記事本文——301リダイレクトでトップページしか取得できず、`mkOutOfStoreSymlink` に関する著者の具体的な記述は未確認のまま。
- Ansible の roles + inventory groups パターンを個人の少数機（1〜2台）dotfiles に転用した実例——今回探した範囲では、Ansible を「サーバーではなく自分の macOS/Linux 機の個人設定」に使っている dotfiles リポジトリの実例は見つからなかった。Ansible自体は多数ホストの中央管理という別の問題規模のツールである可能性が高い、という所見にとどまる。
- 「ロール/プロファイル抽象化を採用してから、1台〜数台規模の個人 dotfiles で『過剰設計だった』と明言して撤去した」一次資料——digga（§1.2）は見つかったが、これは共有ライブラリ（多数のユーザーが依存する外部プロジェクト）の話であり、「自分の個人 dotfiles の中だけで作った role 抽象化を自分で剥がした」というピンポイントな一次資料は見つからなかった。GitHub commit search（`q="simplify flake.nix remove roles"`）は83件ヒットしたが、個別のコミット内容までは検証時間の制約で追えておらず、件数のみの弱い手がかりとして記録する。

---

## 結論

**Q1（platform × role → capabilities の業界標準）**: 単一の業界標準は無い。4つの異なる、いずれも実在する慣習が並立している——
(a) **ディレクトリ合成型**（ryan4yin、2,065★、`modules/nixos/desktop/` を丸ごと import）、
(b) **`mkEnableOption` ベースの `roles.<name>.enable`**（dejanr/dotfiles ほか、GitHub code search で少なくとも29件、いずれも小〜中規模）、
(c) **共有ライブラリとして一次機能化する試み**（digga の Modules/Profiles/Suites）は**撤回済み**——メンテナ自身が2023年に「複雑さに見合う価値がなかった」と明言し、コミュニティは flake-parts や手書き `nixosSystem` に移行した。この撤回は、1〜2台規模の個人 dotfiles にとって「共有ライブラリレベルのロール抽象化」は過剰である可能性を示す強い状況証拠であり、この持ち主の規模（macOS 1台＋Linux 1台）には (a) か (b) の軽量な自作パターンの方が、実際に生き残っている前例と一致する。
(d) **yadm の `class`・chezmoi の `promptBoolOnce`+ローカル `chezmoi.toml`・Ansible の inventory group** は思想として収束している: **「ロールの選択」は常にリポジトリの外（ローカル未追跡ファイル、または明示的なCLI引数）に置かれ、ロールの中身（何を capabilities として束ねるか）だけがリポジトリにコミットされる。**

**Q2（ホスト名を出さない選択方法）**: どのツールも「ホスト名という概念そのもの」を消してはいない。消えているのは「flake.nix/chezmoi のテンプレートが実行時に環境から自動的にホスト名を読み取る」という発想（`builtins.getEnv`、前回記録で実践者4/4がゼロ採用と確認済み）であり、代わりにホスト名/ロール名は「操作者が `home-manager switch --flake .#<user>@<host>` のように毎回タイプするコマンドライン引数」か「`~/.config/chezmoi/chezmoi.toml`・yadm の `local.class` のようなローカル未追跡ファイル」のどちらかに押し出されている。

**Q3（bash symlink manager を home-manager 機構に置き換えるべきか）**: `mkOutOfStoreSymlink` は10,256件規模で広く使われている確立した慣習だが、**無傷ではない**——マルチユーザーNixでの permission denied（#4692、未解決）、`recursive` オプションとの非互換（#7187、未解決）という具体的な既知の不具合があり、home-manager 自体を編集可能configとの相性を理由に手放した実例（ayats.org、2024-09-10）も実在する。「置き換えるべきかどうか」について、この調査が支持する結論は「置き換えて良いという十分な採用実績はあるが、無条件に安全という保証は無い」という中間的なもの——**全面移行の根拠にも、現状維持の根拠にも一方的には使えない**。symlink 衝突処理については、home-manager のソースコードを直読した限り、Omarchy の `cp -f` 実装より「symlinkかどうかを区別する」という一点で技術的に丁寧だが、home-manager 自身も「外部ツールが張った symlink を検知なく再リンクする」という同種の弱さを持つ——**「home-manager に任せれば Omarchy の symlink 破壊問題が根本的に解決する」という主張はできない。**

**Q4（否定側の証拠）**: digga のケース（§1.2）は「ロール/プロファイル抽象化を共有ライブラリとして一次機能化する」という設計判断が撤回された、質の高い一次資料。ただし「1台〜数台規模の個人 dotfiles の中だけで作ったロール抽象化を自分で剥がした」というよりピンポイントな否定的一次資料は見つからず、「前例なし」として扱う。chezmoi→Nix、Nix→chezmoi のどちらの移行についても、**理由が明記された一次の体験談は見つからなかった**（htdocs.dev はハウツーであって理由の記述がない、ayats.org は home-manager 批判ではあるがchezmoi/yadmへの乗り換えではない）——この特定の乗り換え理由という切り口では証拠が薄いことを、はっきり「見つからなかった」と記録する。
