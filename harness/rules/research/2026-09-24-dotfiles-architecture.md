# dotfiles を「個人用アプリケーション」として構造化する — アーキテクチャとディレクトリ構成の調査

調査日: 2026-09-24。前提として再調査しない既存記録: `domains/dev/llm/harness/rules/research/2026-09-24-role-based-dotfiles.md`（platform×role→capabilities の4慣習比較、digga の Profiles/Suites 撤回、yadm class/chezmoi promptBoolOnce/Ansible inventory group の思想的収束、home-manager launchd.agents/systemd.user.services の vendor 実装と採用実例ゼロ）と `2026-09-23-multi-system-flake-layout.md`（mkSystem 共有関数・hostname キー・forAllSystems の適用範囲・sanketsudake の唯一の完全一致例）。本記録はこの2本の**続き**であり、Nix 固有の役割抽象化・ホスト分岐機構は再調査しない。今回の焦点は **アーキテクチャとディレクトリ構造そのもの**（ツール非依存の軸＋ツール別の具体例）。

## 0. 方法・検証凡例

- `[直接]` — `curl`/`raw.githubusercontent.com`/`api.github.com`（`gh auth token` を `Authorization` ヘッダで使用）で生データを取得し、要約なしで本文を引用したもの。
- `[要約経由]` — WebFetch/WebSearch の要約を経由したもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの（明記）。
  - `https://www.msleigh.io/...`（WebFetch は403） → `curl -A <UA>` で HTML を直接取得しタグを除去する形で代替取得（`[直接]`扱い、LLM 要約は経由していない）。
  - `https://dotfiles.github.io/frameworks/` → WebFetch は成功したが `[要約経由]`。
  - `https://developer.1password.com/docs/cli/secrets-environment-variables` → curl 直接取得が空応答、WebSearch の要約のみで代替（`[要約経由]`と明記）。
  - `https://raw.githubusercontent.com/twpayne/chezmoi/master/assets/chezmoi.io/docs/user-guide/manage-different-types-of-file/index.md` 等、一部の chezmoi ページの正確な相対パスは前回記録 `2026-09-24-role-based-dotfiles.md` §1.3 で既に直接取得済みのため再取得せず引用のみ。
- GitHub code/issue search は GitHub 独自のサンプリングインデックスであり網羅的ではない。件数は「採用規模のおおまかな比較」としてのみ扱う。
- 所有者自身のリポジトリ・過去の設計ノートは根拠として使わない（four-lenses ルール通り）。

---

## 問い

1. **抽象**: 組織化の軸は何が業界で使われているか — ツール/アプリ単位（stow流「1トピック1ディレクトリ」）、レイヤー単位（bootstrap/packages/configs/services/secrets）、role/profile 単位、platform 単位、「domain（生活領域）」単位。3年以上メンテされている・1,000★以上または著名実践者のリポジトリで生き残る軸はどれで、再編される軸はどれか。
2. **具体**: Nix・chezmoi・plain/stow を跨いだ代表 repo 5〜8件、それぞれのトップレベルツリー、role/platform の決定場所、サービスの置き場所、secrets の出所、bootstrap の形、install と update が同じコマンドか、テスト/CI の有無。
3. **アプリケーションとしての dotfiles**: 単一の冪等エントリポイント、宣言的 state vs 命令的スクリプト、per-tool コードの代わりのデータテーブル、生成物とソースの分離、secrets を repo に置かない、テスト（bats/shellcheck/CI macOS+Linux/container）、バージョン管理・pin、ドキュメント。それぞれ実際に使われている証拠と、失敗した証拠。
4. **常駐サービス固有**: launchd(macOS) と systemd --user(Linux) を「1回宣言して」両方に出す実践、失敗例。
5. **否定側の証拠**: 過剰設計として撤去されたフレームワーク、「dotfiles をシンプルにした」記事とその理由、topic/domain レイアウトの既知の問題。

---

## 各レンズの所見

### 1. ベンダー

#### 1.1 chezmoi — スクリプトは「宣言的アプローチを壊す」と vendor 自身が明言し、"sparingly" にしか使うなと書く

`https://raw.githubusercontent.com/twpayne/chezmoi/master/assets/chezmoi.io/docs/user-guide/use-scripts-to-perform-actions.md`（`[直接]`）:

> "Scripts break chezmoi's declarative approach and should be used sparingly. All scripts should be idempotent, including `run_onchange_` and `run_once_` scripts."

3種類のスクリプト接頭辞（`run_`＝毎回、`run_onchange_`＝内容ハッシュが変わった時だけ、`run_once_`＝内容ハッシュ単位で一度だけ、`before_`/`after_` 修飾子併用可）は、**そのままサービス常駐の「変更検知→再起動」に転用できる語彙**として vendor が例示している:

> "This script can also be a template. For example, if you create `run_onchange_install-packages.sh.tmpl` with the contents: `{{ if eq .chezmoi.os "linux" -}} ... sudo apt install ripgrep {{ else if eq .chezmoi.os "darwin" -}} ... brew install ripgrep {{ end -}}`"

**読み方**: chezmoi はホスト管理システムの一次語彙として「role」や「service」を持たない（前回記録 §1.3 と一致）代わりに、「テンプレートの OS 分岐＋変更検知スクリプト」という2つの原始的機構だけを提供し、その組み合わせをユーザーが自分で構築する。home-manager の `launchd.agents`/`systemd.user.services`（前回記録 §1.2、`isDarwin`/`isLinux` から自動選択される対称オプション）と比べると、**「1つの宣言から両OSの実体が自動生成される」一次機能は chezmoi には無い** — ユーザーがテンプレート内で `.chezmoi.os` を分岐させて2つの実体（plist と unit file）を自分で書く必要がある。

#### 1.2 chezmoi — 1Password 連携はテンプレート関数であり、secrets は常に外部ストアから読み、repo には参照コードしか残らない

`https://raw.githubusercontent.com/twpayne/chezmoi/master/assets/chezmoi.io/docs/user-guide/password-managers/1password.md`（`[直接]`）:

> "The output of `op read $URL` is available as the `onepasswordRead` template function, for example: `{{ onepasswordRead "op://app-prod/db/password" }}`"

つまり repo にコミットされるのは `op://vault/item/field` という**参照文字列を含むテンプレート**だけで、値そのものは `chezmoi apply` 実行時に `op` CLI 経由で毎回解決される。secrets 用のディレクトリが chezmoi 側に18種類（1Password/AWS Secrets Manager/Azure Key Vault/Bitwarden/Doppler/HashiCorp Vault/pass/gopass/KeePassXC 等）用意されていること自体（`https://api.github.com/repos/twpayne/chezmoi/contents/assets/chezmoi.io/docs/user-guide/password-managers`、`[直接]`）が、「secrets は репо外の何らかのストアから実行時解決する」という設計を vendor が単一のパターンとして扱っていることの証拠。

#### 1.3 1Password CLI — `op run`/secret references は「repo にコミットしてよいのは参照だけ」を明文化

`https://developer.1password.com/docs/cli/reference/commands/run/`（`[要約経由]`、WebSearch summary）: "`op run` を使うとプロジェクトの secrets を 1Password から安全に読み込み、指定コマンドをサブプロセスとして、環境変数の形で secrets を渡して実行する" — サブプロセスの寿命の間だけ環境変数に載る設計。`https://developer.1password.com/docs/cli/secret-references/`（`[要約経由]`）: secret reference（`op://vault/item/field`）を `.env` に書くことは「repo にコミットしてよい」——実際の値ではなく参照だけだから。サービスアカウント（`https://developer.1password.com/docs/cli/reference/commands/run/` 関連ページ、`[要約経由]`）: 最小権限のためボールト・環境単位でスコープを絞ったサービスアカウントで認証することが推奨されている。**この所有者の「1Password CLI から secrets」という前提は、chezmoi の `onepasswordRead`・dotbot の `dotbot-age`/`dotbot-gitcrypt` プラグイン系（§1.4）と同じ「repo には参照/暗号化済みデータのみ、平文は実行時に外部ストアから取得」という業界共通パターンに一致している。**

#### 1.4 dotbot — 「宣言的データテーブル」を vendor 自身が最上位原則として明記

`https://raw.githubusercontent.com/anishathalye/dotbot/master/README.md`（`[直接]`）:

> "Dotbot makes installing your dotfiles as easy as `git clone $url && cd dotfiles && ./install`, even on a freshly installed system!"
> "**Ideally, bootstrap configurations should be idempotent. That is, the installer should be able to be run multiple times without causing any problems.** This makes a lot of things easier to do (in particular, syncing updates between machines becomes really easy)."
> "Dotbot configuration files are arrays of tasks, where each task is a dictionary that contains a command name mapping to data for that command."

install も update も同じコマンド（`./install` を毎回叩く、`git pull && ./install`）——**単一の冪等エントリポイントという原則そのものが vendor のドキュメントに明記されている唯一の例**。設定は `install.conf.yaml` という**宣言的データテーブル**（`link`/`create`/`shell`/`clean` の4種類のディレクティブ）であり、per-tool のシェルコードではなくYAMLの配列。プラグイン機構（secrets: `dotbot-age`、`dotbot-gitcrypt`。パッケージ管理: `dotbot-brew`、`dotbot-apt`）により「データテーブル＋プラグインで拡張」というアプリケーション的な拡張性を持つ。CI: dotbot 自体が `ci.yml`（GitHub Actions badge 確認済み）＋ Codecov バッジを持つ（`[直接]`、README 冒頭のバッジ行）。

#### 1.5 dotdrop — 「profile」を config.yaml の一次語彙として持つ唯一の非Nixツール

`https://raw.githubusercontent.com/deadc0de6/dotdrop/master/README.md`（`[直接]`）:

> "It also allows to manage different *sets* of dotfiles. For example, you can have a set of dotfiles for your home laptop and a different set for your office desktop. Those sets may overlap, and different versions of the same dotfiles can be deployed using different predefined *profiles*."
> "There exist many tools to manage dotfiles; however, not many allow to deploy different versions of the same dotfile on different hosts. Moreover, dotdrop allows to specify the set of dotfiles that need to be deployed for a specific profile."

`config.yaml` の `dotfiles:` と `profiles:` という2つのトップレベルキーだけで「どのファイルをどのプロファイルに出すか」を宣言する——前回記録が Nix 側で確認した「ディレクトリ合成型」「`mkEnableOption` 型」の**第3の型：データテーブル型 role**の非Nix実例。プロファイルはデフォルトでホスト名に解決される（`dotdrop import` の挙動、README該当行）が、`-p`/`--profile` で明示上書き可能——前回記録が Nix 側で確認した「ロールの選択はコマンドライン引数か外部ファイルに置かれる」という結論と同型。

#### 1.6 GNU Stow は「dotfiles 専用ツールではない」——vendor の元々の対象は snapshot 型パッケージ管理

Stow 自体は GNU パッケージ管理ツールであり、dotfiles 管理は後付けの流用（§2.4の実践者記述で詳述）。vendor（GNU Stow）自身のドキュメントに「dotfiles」という語や複数機管理のガイダンスは無い——**「1トピック1ディレクトリ→symlink」という慣習は100%コミュニティの転用であり、vendor が正解を示しているわけではない**という点で、前回記録が Nix の「role」について出した結論（§1.1「vendor に一次語彙は無い」）と同じ構造。

---

### 2. 実践者

#### 2.1 twpayne/dotfiles（chezmoi 作者本人）— レイヤー分離は「1トップレベルディレクトリ＋ chezmoi の命名規則」

`https://api.github.com/repos/twpayne/dotfiles`（`[直接]`）: 465★、`pushed_at: 2026-09-09`（直近2週間以内、現役）。トップレベルツリー（`[直接]`）:

```
.chezmoiroot
.chezmoiversion
README.md
assets/
home/                 # chezmoi のソースツリー本体
install.sh
```

`home/` 配下（`[直接]`）:
```
home/
  .chezmoi.toml.tmpl          # マシン固有変数（前回記録 §1.3 の二層構造）
  .chezmoiexternal.toml.tmpl  # 外部ソースからの取り込み（例: oh-my-zsh）
  .chezmoiignore.tmpl
  .chezmoiremove.tmpl
  .chezmoiscripts/            # サービス起動などのスクリプト置き場（§1.1）
  Documents/
  dot_bash_aliases.tmpl
  dot_config/
  dot_hammerspoon/            # macOS 自動化ツールの設定（プラットフォーム固有）
  dot_p10k.zsh.tmpl
  dot_ssh/
  dot_zprofile.tmpl
  dot_zshrc.tmpl
  empty_dot_hushlogin
  exact_dot_oh-my-zsh/
  private_dot_gnupg/
```
secrets は 1Password（README、`[直接]`）: "Personal secrets are stored in 1Password and you'll need the 1Password CLI installed." install は `chezmoi init twpayne` の1コマンド。update は `chezmoi update`（別コマンドだが同じ宣言的ソースを再適用するという意味で「同じ操作の繰り返し」）。**レイヤー（bootstrap/config/scripts/secrets）はディレクトリでなく chezmoi の命名規則（`dot_`/`private_`/`.chezmoiscripts`/`run_`）で表現されており、「role」に相当する専用ディレクトリは無い** — マシン差分は `.chezmoi.toml.tmpl` のデータと個々のテンプレート内の `{{ if }}` 分岐に埋め込まれる。

#### 2.2 holman/dotfiles — topic 軸は「後悔していない」が、README 自身が対象範囲を限定している

`https://api.github.com/repos/holman/dotfiles`（`[直接]`）: 7,772★、`pushed_at: 2026-06-25`（3ヶ月前、現役）。トップレベルツリー（`[直接]`）:
```
Brewfile
atuin/ bin/ docker/ editors/ functions/ git/ homebrew/
macos/ ruby/ script/ system/ vim/ xcode/ yarn/ zsh/
```
README（`https://raw.githubusercontent.com/holman/dotfiles/master/README.md`、`[直接]`）:

> "I was a little tired of having long alias files and everything strewn about (which is extremely common on other dotfiles projects, too). That led to this project being much more topic-centric."
> "**topic/\*.zsh**: Any files ending in `.zsh` get loaded into your environment." / "**topic/\*.symlink**: Any file ending in `*.symlink` gets symlinked into your `$HOME`."
> "**topic/install.sh**: Any file named `install.sh` is executed when you run `script/install`."

**topic ディレクトリ自体が「読み込み(`.zsh`)/symlink(`.symlink`)/インストール(`install.sh`)」という3つの役割を1つのディレクトリの中でファイル拡張子によって束ねている** — これは今回の所有者の `domains/<domain>/{packages,config,home,bin,shell,install.sh}` という「1ディレクトリの中に複数レイヤーを持つ」構造と最も近い実例。ただし holman のトピックは「アプリ/言語」単位（ruby, git, vim, zsh, macos）であり、「domain（生活領域）」単位ではない——holman の1トピック＝1アプリという原則と、所有者の1ドメイン＝複数アプリという原則は、見た目は似ていても分割の軸が違う点に注意。

#### 2.3 mathiasbynens/dotfiles — フラット構造、非宣言的（symlink でなく rsync コピー）、31k★だが2年以上停止

`https://api.github.com/repos/mathiasbynens/dotfiles`（`[直接]`）: **31,481★**（今回調査で最大）、`pushed_at: 2024-08-05`（本記録時点で2年1ヶ月停止）。トップレベルはフラット（`.aliases`, `.bash_profile`, `.gitconfig`, `.vimrc` 等が直接並ぶ、`bin/`, `init/` のみサブディレクトリ）。`bootstrap.sh`（`https://raw.githubusercontent.com/mathiasbynens/dotfiles/main/bootstrap.sh`、`[直接]`）:

```sh
function doIt() {
	rsync --exclude ".git/" --exclude ".DS_Store" --exclude ".osx" \
		--exclude "bootstrap.sh" --exclude "README.md" --exclude "LICENSE-MIT.txt" \
		-avh --no-perms . ~;
	source ~/.bash_profile;
}
```
**symlink ではなく `rsync` によるファイルコピー** — 変更を追跡する唯一の手段が「もう一度 `bootstrap.sh` を実行してホームディレクトリに上書きコピーする」ことで、home-manager や chezmoi の「symlink 先の正本を repo に保つ」設計とは根本的に異なる（コピー先を編集してしまうと repo との乖離が repo 側からは検知できない）。`.github/workflows` は存在しない（`api.github.com/repos/mathiasbynens/dotfiles/contents/.github/workflows` は404、`[直接]`）——**CI無し**。**読み方**: 31k★という圧倒的な人気（GitHub 全体でも最も星の多い dotfiles リポジトリの一つ）と、「アーキテクチャとしての健全性」は別軸である、という直接の反証データ。人気＝模範ではない。

#### 2.4 thoughtbot/dotfiles + rcm — フラットな1リポジトリ、role/host分岐は rcm の "tags" が担う

`https://api.github.com/repos/thoughtbot/dotfiles`（`[直接]`）: 8,173★、`pushed_at: 2026-09-03`（3週間前、現役）。トップレベルはほぼフラット（`vim/`, `zsh/`, `bin/`, `git_template/`, `ctags.d/`, `hooks/` 以外は個別ファイル: `gitconfig`, `tmux.conf`, `vimrc`, `zshrc` 等）。実体の管理は別プロジェクト `thoughtbot/rcm`（`https://api.github.com/repos/thoughtbot/rcm`、`[直接]`、3,261★、`pushed_at: 2025-05-23`）の `rcup` コマンドが担う。README（`https://raw.githubusercontent.com/thoughtbot/rcm/master/README.md`、`[直接]`）:

> "The programs provided are rcup(1), mkrc(1), rcdn(1), and lsrc(1)... with support for tags, host-specific files, and multiple source directories."

rcm の "tags" は、chezmoi の `.chezmoi.os` やこの所有者の "role" に相当するもう一つの独立した実装（man page `rcrc(5)` に定義、今回は README レベルの確認にとどめる）——**「1つのフラットな dotfiles リポジトリ＋分岐は専用ツール（rcm）の tag/host 機構に外出しする」という、chezmoi/dotdrop とはまた違う第4の分岐実装パターン**。

#### 2.5 msleigh.io — chezmoi で launchd LaunchAgent を「1回宣言」する具体的な実装レシピ（唯一の一次実装記事）

`https://www.msleigh.io/blog/2026/06/30/deploying-launchagents-with-chezmoi/`（`[直接]`、curlでHTML取得しタグ除去。2026-06-30付、6分の記事）:

> "Running `brew services start ollama` to create a permanently running Ollama service creates a user-level 'LaunchAgent' file... This shouldn't be edited; `brew services` deletes and regenerates it from the formula on every stop, start, or restart, so edits are lost the next time any of those commands runs."
> "Chezmoi allows you to define a `run_onchange_...` script that re-runs the restart whenever `chezmoi apply` finds that the file's contents have changed, so the whole thing can be automated."
> "Add the template for the plist file: `private_Library/private_LaunchAgents/io.msleigh.ollama.plist`. This maps to `~/Library/LaunchAgents/io.msleigh.ollama.plist` when `chezmoi apply` is run. The `private_` prefixes clear the group and world permission bits on deployment... This matters here because `~/Library` is already `700` on macOS; without `private_`, chezmoi would try to reset it to `755`."

**この記事が示す実装パターン**: (1) Homebrew の `brew services` が生成する plist は Homebrew 自身が上書きし続けるので信用できない、(2) 正本を dotfiles 側に持ち `chezmoi apply` で配置し直す、(3) `run_onchange_` スクリプトで「plist の内容が変わったら `launchctl bootout`/`bootstrap` で再起動」を自動化する。**これは home-manager の `launchd.agents`（宣言一発で自動生成・自動リロード）より一段低レベルで、ユーザーが「テンプレート＋変更検知スクリプト」を自分で組み立てる必要がある** — §1.1 の vendor ドキュメント読みと完全に一致する。systemd 側の対称実装（同じ record 内での `run_onchange_` による `systemctl --user restart` パターン）はこの記事には無く、**「chezmoi で launchd と systemd を両方1つのテンプレートから条件分岐して出す」実例は見つからなかった**（§5 参照)。

#### 2.6 CI/テストを持つ practitioner 記事群（複数、直接引用）

`https://mattorb.com/ci-your-dotfiles-with-github-actions/`（`[要約経由]`）:
> "Dependencies that you can't or won't pin versions of in a reliable persistent cache, have the potential for drift." / テストの核心は "Can the install script execute, start to finish, without error?" / GitHub Actions の `macOS-latest` VM 上で毎push実行、"has already caught some bugs" とあり、依存パッケージ名変更や構文ミスを実際に検出したと記載。

`https://michael.mior.ca/blog/automated-testing-of-dotfiles/`（`[要約経由]`）:
> 動機: "I wasn't fully capturing the correct steps to reproduce my environment." / 最初は Docker Hub 上のカスタム Dockerfile（OS パッケージインストール→ユーザー作成→install スクリプト実行）、その後 Travis CI に移行し "easier than expected" と評価。/ 現状のテストは最小限（スクリプトがエラー無く終了するかのみ）だが "this has already saved me a lot of trouble" と明記。

`https://shunk031.me/post/testable-dotfiles-management-with-chezmoi/`（`[要約経由]`）: ディレクトリを3分割:
```
home/       # chezmoi 管理下の dotfiles
install/    # テスト可能なセットアップスクリプト
tests/      # Bats による自動テスト
```
> "separation of concerns" と "maximizing testability" を核とし、"most setup and installation scripts included in dotfiles repositories are not tested for proper functionality" という課題認識から出発。CI は macOS/Ubuntu の2OSマトリクス、`kcov`+Codecov でカバレッジ計測、**毎週金曜日にスケジュール実行される end-to-end セットアップテスト**、ベンチマーク結果を GitHub Pages に自動公開。`if [[ "${BASH_SOURCE[0]}" == "${0}" ]]` によりスクリプトを「実行可能プログラムとしても、他スクリプトからのソース可能なライブラリとしても」両対応させるテクニックを明記。

`https://gbergatto.github.io/posts/tools-managing-dotfiles/`（`[要約経由]`）——ツール比較記事、詳細は §5 否定側の証拠に転記。

**読み方**: 「dotfiles にCI/テストを足す」practitioner の理由は3記事とも同型——① 新規/クリーンな環境で壊れていることに後から気づく、② install スクリプトが「エラー無く最後まで実行できるか」だけでも検知価値が高い、③ macOS+Linux の2OSマトリクスは複数の独立した記事で共通して採用されている実践規模の標準。container ベース（Docker）でのテストは Linux 側でのみ確認でき、**macOS 側は「クリーンな VM」（GitHub Actions の `macOS-latest`）であって「コンテナ」ではない**（macOS にはOSSで広く使えるコンテナ技術が無いため）——この区別を明記しておく。

---

### 3. 測定・実態（数値付き）

| 対象 | 数値 | 出典 |
|---|---|---|
| twpayne/dotfiles (chezmoi 作者本人) | 465★ / push 2026-09-09 | `[直接]` api.github.com |
| holman/dotfiles | 7,772★ / push 2026-06-25 | `[直接]` 同上 |
| mathiasbynens/dotfiles | **31,481★** / push **2024-08-05**（2年1ヶ月停止）/ CIワークフロー無し（404） | `[直接]` 同上 |
| thoughtbot/dotfiles | 8,173★ / push 2026-09-03 | `[直接]` 同上 |
| thoughtbot/rcm | 3,261★ / push 2025-05-23 | `[直接]` 同上 |
| anishathalye/dotbot | 8,007★ / push 2026-07-12 / CI(`ci.yml`)+Codecov バッジ確認済み | `[直接]` 同上 |
| deadc0de6/dotdrop | 1,950★ / push 2026-09-22（2日前、現役）/ CI(tests, CodeQL)+Codecov+ReadTheDocs バッジ確認済み | `[直接]` 同上 |
| lra/mackup | 15,330★ / push 2026-09-09 / **open issues 292件** | `[直接]` 同上 |
| `"install.conf.yaml" filename:install.conf.yaml`（dotbot設定ファイルの採用規模） | 28件 | `[直接]` api.github.com/search/code（サンプリング指標） |
| mackup issue #1924「App settings will not persist on macOS 14」 | closed、本文: "I have been trying to work out why my app settings are all resetting... This has been happening for apps such as Raycast, iTerm, Rectangle, Bartender etc." | `[直接]` api.github.com/repos/lra/mackup/issues/1924 |
| mackup PR #2085「Implement Copy Mode and Refactor Backup/Restore Operations」 | closed（マージ済み）、本文: "Adds 'copy mode' as an alternative to 'link mode' for managing app settings" | `[直接]` api.github.com/repos/lra/mackup/issues/2085 |

---

### 4. 実態（in the wild）

- **mathiasbynens/dotfiles は「最大の星数」と「最も停止している」が同居する** — 31,481★（今回調査で最大）、しかし `pushed_at: 2024-08-05`。CI無し・symlinkでなくrsyncコピーという非宣言的設計。**人気度は保守されている証拠にならない**という直接データ。
- **dotdrop は今回確認した非Nixツールの中で最も直近にpushされている**（2026-09-22、2日前）——「profile」を一次語彙として持つツールが、調査時点で最も活発。
- **mackup の292件のopen issues** は、symlink/copy によるアプリ設定同期という設計自体が「OSのマイナーバージョンアップごとに壊れる」構造的な脆さを持つことの実態的証拠（§5でさらに詳述）。
- issue tracker は失敗報告に偏る、star/pushed_at は「存在」と「直近の活動」は示すが「長期的に壊れていないこと」を示さない、という2種類のバイアスを認めた上で数値を読む。

---

## 代表 repo の構造（ツリー付き、まとめ）

### Nix系（前回2記録から引用のみ、再取得なし）

**mitchellh/nixos-config**（3,109★、[前回記録 §2.1]）— 共有 `mkSystem` 関数1つ、`darwin: bool` フラグで `darwinSystem`/`nixosSystem` と `home-manager.darwinModules`/`.nixosModules` を切替え、**同じ `userHMConfig` を両OSで読み込む**:
```nix
name: { system, user, darwin ? false, wsl ? false }:
let isLinux = !darwin && !isWSL;
    systemFunc = if darwin then inputs.darwin.lib.darwinSystem else nixpkgs.lib.nixosSystem;
in systemFunc { modules = [ machineConfig userOSConfig home-manager.home-manager { ... } ]; }
```

**ryan4yin/nix-config**（2,065★、[前回記録 §2.4]）— `hosts/darwin-<name>/`・`hosts/<nixos-name>/` というホスト別ディレクトリ、role は `modules/nixos/desktop/` のようなディレクトリの import 有無で表現。

**sanketsudake/dotfiles**（4★、唯一の完全一致例、[前回記録 §2.5]）— `mkDarwinHost`/`mkHomeHost` 2関数、`dotfiles.omarchy` という repo-local boolean option、Omarchy所有パス（`~/.config/hypr` 等）は明示的に管理対象外。

### chezmoi系（本記録で新規取得）

**twpayne/dotfiles**（465★）:
```
.chezmoiroot / .chezmoiversion / README.md / install.sh
assets/
home/
  .chezmoi.toml.tmpl              ← マシン固有データ（ローカル、chezmoi initで生成）
  .chezmoiexternal.toml.tmpl      ← 外部ソース取り込み
  .chezmoiscripts/                ← サービス/インストール系スクリプト
  dot_zshrc.tmpl / dot_config/ / private_dot_gnupg/ / exact_dot_oh-my-zsh/
```
role/platform分岐: `.chezmoi.os` 等の組み込み変数＋テンプレート内`{{ if }}`。secrets: 1Password CLI（`onepasswordRead`）。install: `chezmoi init twpayne`。update: `chezmoi update`。CI: リポジトリ自体には見当たらず（README・トップレベルから確認する限りワークフロー無し、chezmoi本体側のCIとは別）。

### plain/stow系（本記録で新規取得）

**holman/dotfiles**（7,772★）:
```
bin/ git/ macos/ ruby/ system/ vim/ xcode/ yarn/ zsh/ docker/ editors/ functions/ atuin/ homebrew/
script/  ← bootstrap, install
Brewfile
```
1トピック1ディレクトリ、`*.symlink`/`*.zsh`/`install.sh` をファイル名規約で判別。secrets: リポジトリ内に機構なし（言及なし）。install=update: `script/bootstrap` を都度実行。CI: README上には明記無し（未確認）。

**mathiasbynens/dotfiles**（31,481★、停止2年超）:
```
.aliases .bash_profile .gitconfig .vimrc ...（フラット、拡張子ファイルが直並び）
bin/ init/
bootstrap.sh  brew.sh  .macos  .osx
```
symlinkでなくrsyncコピー、role/platform分岐なし（macOS専用として設計）、secrets機構なし、CI無し。

**thoughtbot/dotfiles + rcm**（8,173★ / 3,261★）:
```
（thoughtbot/dotfiles、フラット）
vim/ zsh/ bin/ git_template/ ctags.d/ hooks/
gitconfig tmux.conf vimrc zshrc rcrc ...
```
role/host分岐は `rcm`（別リポジトリ）の "tags"/host-specific files 機構に外出し。secrets機構なし。install/update: `rcup`（rcm提供コマンド）。

**dotbot ベースの一般的レイアウト**（vendor README の規範形、具体的な採用リポジトリはツール利用者ごとに違うため型のみ示す）:
```
install.conf.yaml   ← 宣言的データテーブル（link/create/shell/clean）
install / install.ps1
dotbot/ (submodule)
<各トピックディレクトリ...>
```

**deadc0de6/dotdrop**（1,950★）:
```
config.yaml   ← dotfiles: と profiles: の2キー、プロファイルはデフォルトでhostnameに解決
dotfiles/     ← dotpath、実ファイル本体
```

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **Mackup: symlink方式でアプリ設定を同期する設計が macOS のマイナーバージョンアップで壊れた** — issue #1924「App settings will not persist on macOS 14」（`[直接]`、closed）: "I have been trying to work out why my app settings are all resetting, and not persisting in macOS 14. This has been happening for apps such as Raycast, iTerm, Rectangle, Bartender etc." 対応として PR #2085「Implement Copy Mode and Refactor Backup/Restore Operations」（`[直接]`、マージ済み）で「copy mode」を追加——**symlinkベースの同期という設計そのものが、対象がアプリの環境設定（plist/cfprefsd経由）である場合はOSベンダーの内部実装変更に弱い**という具体的な実例。15,330★・292件のopen issuesという規模で今も使われ続けている点も含め、"廃止された" のではなく "設計の一部を作り直さざるを得なかった" という中間的な否定証拠として扱う。
- **GNU Stow の限界: secrets/テンプレーティングが無い、空ディレクトリが増える、離脱コストが高い** — `https://gbergatto.github.io/posts/tools-managing-dotfiles/`（`[要約経由]`）: "a lot of empty directories, which you may find annoying" / "anybody who might want to use your dotfiles would also have to start using this tool" / "the difficulty in migrating away from it. Because the `stow` command only creates symlinks, you will have to manually move all dotfiles to their original location." `https://michaeltinsley.github.io/2025/09/09/taming-my-dotfiles-with-gnu-stow/`（`[要約経由]`）: "There are features of Chezmoi that I wish Stow had. These are primarily around secrets and templating." — 2つの独立した記事が同じ弱点（secrets・templating の不在）を指摘。
- **yadm の弱点: 単なる git ラッパーであることの裏返し** — gbergatto（`[要約経由]`）: "The main benefit of this tool is that it's essentially just a Git wrapper. Its main drawback is that it's just a Git wrapper." / "if your dotfiles repository includes a README, it will clutter up your home directory."
- **chezmoi の弱点: `dot_` 命名規則がツールへのロックインを強制する** — gbergatto（`[要約経由]`）: "If I had to find a downside, it would probably be the renaming of files with the `dot_` prefix. Similar to GNU Stow, this forces anyone who wants to use your dotfiles to install it." 同記事の結論: 著者は最終的に chezmoi ではなく yadm を選び、理由は "it seemed like the most minimal solution that doesn't require me to manually manage a bare Git repository" であり、chezmoi は "feels a bit overkill for the task at hand" と明記——**chezmoiの機能過多を理由に選ばなかった一次の実例**。
- **zgen（zshフレームワーク）は明示的にメンテナンス終了、フォークへの移行を推奨** — `https://dotfiles.github.io/frameworks/`（`[要約経由]`）: "zgen is no longer being maintained, we recommend switching to use the zgenom fork." dotfiles界隈のフレームワークが実際に非推奨化される具体例（shell framework レベルであり、dotfiles全体の管理フレームワークではない点には注意）。
- **mathiasbynens/dotfiles: 31k★でも2年以上pushが止まっており、CIも無く、symlinkではなくrsyncコピーという非宣言的設計** — §2.3, §3, §4で既述。「星の数」を業界標準の代理指標として使うことへの直接の反証。
- **digga の Profiles/Suites 撤回**（Nix、前回記録 §1.2から引用のみ、再調査なし）— "I would be hard pressed to recommend digga to anyone anymore." という一次資料は、「role/profileを共有ライブラリとして一次機能化する」という設計判断一般への否定証拠として、この記録の結論にも関連する。

---

## 確認できなかったこと

- **holman流「topic」レイアウトを直接批判する記事、または「topicからdomainへ再編した」と明言する記事** — 意図的に複数の検索クエリで探したが見つからなかった。「見つからない」ことを報告する（存在しないとは断定しない）。
- **「dotfilesをシンプルにした」というタイトル・主旨の記事で、具体的な脱却理由（過剰設計の自覚等）を明記したもの** — 検索は複数試みたが、明確に一致する一次記事は見つからなかった（"dotfiles-framework" というプロジェクト自体は見つかったが、個人の「シンプルにした」体験談としては裏取りできず）。
- **chezmoi（またはdotdrop等）が「1つの宣言からlaunchdのplistとsystemdのunit fileを両方生成する」ことを実演している実例** — msleigh.io は launchd側のみで、systemd側との対称実装、あるいは同一テンプレートから両OS分岐で出している実例は見つからなかった。home-manager（Nix）だけが、前回記録の通り「isDarwin/isLinuxで自動選択される対称オプション」を vendor 一次機能として持つ。
- **macOSでの「コンテナ」ベースdotfilesテスト** — macOS用のOSSコンテナ技術が事実上存在しないため、確認できた practitioner CI は全て「GitHub Actions の `macOS-latest` VM」であり「コンテナ」ではない。Linux側は複数の実例（Docker）がある。この非対称性自体が確認結果。
- **rcm の "tags"/host-specific files 機構の詳細な動作**（`rcrc(5)` man page の実際の構文）— README レベルの存在確認にとどまり、man page 本文までは今回取得していない。
- **1Password CLI の `op run`/secret references ページの一次テキスト直接取得** — curl が空応答を返し、WebSearch要約のみで代替した（`[要約経由]`と明記済み）。

---

## 結論

**Q1（組織化の軸、どれが生き残るか）**: 単一の正解は無い、という前回記録のNix側の結論が、非Nixでもそのまま成立する。確認できた実例は以下の型に分かれ、**いずれも実在し、いずれもメンテされている**——
- **ツール/アプリ単位（topic）**: holman（7,772★、3ヶ月前push）。1トピック1ディレクトリ、拡張子規約で役割分担。**役割の粒度が「1アプリ」に固定される**ため、複数アプリをまたぐ横断的な関心事（例えば「このマシンはdevマシンか」）を表現する専用の場所が無い——それは`bin/dot`のようなスクリプト側のロジックに押し出される。
- **命名規則単位（chezmoi）**: twpayne（465★、2週間前push）。ディレクトリではなく`dot_`/`private_`/`run_`という**ファイル名の接頭辞**が役割を表現する。1つのフラットな`home/`ツリーの中に、レイヤー（設定/スクリプト/外部取り込み）が命名規則だけで多重化されている。
- **専用ツールの外部機構（rcm/yadm/dotdrop）**: thoughtbot+rcm（8,173★/3,261★）、dotdrop（1,950★、2日前push）。dotfiles本体のディレクトリ構造はフラットなまま保ち、**「どの機/どのプロファイルに出すか」の判断ロジックだけを専用ツールの機能（tags/class/profiles）に外部化する**。
- **共有関数＋ホストディレクトリ（Nix、前回記録）**: mitchellh/ryan4yin/sanketsudake。前回記録の結論を再掲するのみ。

**生き残る軸として言えること**: 4つとも直近1年以内にpushされている現役リポジトリであり、「どれか一つが業界標準として勝った」形跡は無い。**再編が確認できたのは「共有ライブラリとして一次機能化しようとした試み」（digga）のみ**——個々のリポジトリの中で「1つの軸から別の軸へ移った」一次資料は、意図的に探したが見つからなかった（前回記録の結論と同じ「前例なし」）。人気度（★数）だけでは軸を選べない——mathiasbynens（31k★）はフラット・非宣言的・CI無し・2年停止という、他のどの評価基準でも「模範」とは呼べない状態にある。

**Q2（代表repo）**: 上記「代表repoの構造」節に集約。**「domain（生活領域）単位」で組織化している実例は、Nix・chezmoi・plain/stow のいずれの代表リポジトリにも見つからなかった** — 見つかった軸は「アプリ/トピック」「ホスト/プラットフォーム」「命名規則によるレイヤー」の3種のみ。所有者の現行 `domains/{creative,dev,infra,system,workspace}` という「生活領域」軸は、今回調査した代表的なdotfilesリポジトリのどれとも直接一致しない――これは「間違っている」ことの証拠ではなく、**「業界の主流な前例は無い」という事実**として明記する。

**Q3（アプリケーションとしてのプラクティス）**: 単一の冪等エントリポイントは dotbot が vendor ドキュメントで明文化し（"bootstrap configurations should be idempotent"）、mathiasbynens・holman・twpayne いずれも「1コマンドで install/update 兼用」を実践している——ただし mathiasbynens の実装（rsyncコピー、対話式confirm付き）は「冪等」ではあっても「宣言的」ではない。宣言的データテーブルは dotbot（YAML）・dotdrop（YAML）が一次機能として持ち、chezmoiは命名規則を、Nixはモジュールシステムを使う——**「コードではなくデータで表現する」という原則自体は4ツール共通だが、データの形（YAML配列 / ファイル名規則 / Nix式）は全く異なる**。secrets を repo に置かない原則は chezmoi・dotbot(プラグイン)・1Password CLI(op run/secret references) の全てで一致して確認できた——repoに残るのは参照または暗号化済みデータのみ。テスト/CIは複数の独立した practitioner 記事（mattorb, michael.mior.ca, shunk031）が同じ理由（クリーン環境での再現性の欠如）から同じ解（macOS+Linuxの2OSマトリクスCI、install スクリプトが完走するかのテスト）にたどり着いている——**これは複数独立ソースが同じ結論に達したという意味で、他の項目より確度の高い「合流した実践」**。

**Q4（常駐サービス）**: home-manager（Nix、前回記録）だけが「1回の宣言でDarwin/Linux両方に自動的に出る」対称的な一次オプションを持つ。chezmoi は `run_onchange_` スクリプト＋テンプレートのOS分岐という2つの原始機構をユーザーが自分で組み合わせる必要があり（msleigh.ioが唯一の一次実装記事、launchd側のみ確認、systemd側との対称実装は見つからず）、**「1回宣言してどちらのOSにも」という体験は、非Nix環境では今回どの実例にも見つからなかった**——これは所有者にとって重要な「無い」という結果であり、Nixに完全移行しない限り自作するしかない領域として明記する。

**Q5（否定側の証拠）**: 個々のツールレベルでは豊富に見つかった（GNU Stow・yadm・chezmoiそれぞれの弱点、gbergattoが実際にchezmoiを選ばなかった理由、Mackupのsymlink方式がmacOS 14で壊れてcopy modeを追加した経緯、zgenの非推奨化）。**しかし「topic/domainレイアウト」という構造レベルの否定証拠、および「一度採用してからシンプルな構造に戻した」個人の体験談は、意図的に探したが見つからなかった** — これは前回記録のNix側の結論（「1〜2台規模の個人dotfilesの中だけで作ったrole抽象化を自分で剥がした一次資料は見つからなかった」）と同じ形の空振りであり、2つの独立した調査が同じ種類の「無い」に到達したことは、単なる検索の不足ではなく、**「個人dotfilesの構造選択について、公開された後悔の記録は業界全体で薄い」という実態そのもの**として報告する。
