# 一つの冪等install命令が「前とは別のdotfiles方式」の残骸にどう収束するか

調査日: 2026-09-26。前提として再調査しない既存記録: `2026-09-24-role-based-dotfiles.md`（home-manager `mkOutOfStoreSymlink` の未解決バグ2件・Omarchyのsymlink破壊との対比・digga撤回）、`2026-09-24-chezmoi-copy-vs-symlink.md`（chezmoiのコピー既定の理由・`apply`の確認プロンプト・symlink破損の3種の失敗モード）、`2026-09-24-dotfiles-architecture.md`（4ツールの構造比較・CI実践・launchd/systemdの非対称性）。本記録はこれらの**続き**であり、「なぜsymlinkかコピーか」「どう組織化するか」は再調査しない。今回の焦点は一点に絞る: **同じマシンに前とは別のdotfiles方式（別リポジトリ、別マネージャ、同じリポジトリの旧レイアウト）が過去に存在した状態から、単一の冪等install命令を繰り返し実行したときに、その残骸（`~`/`~/.config`内の、今は存在しないディレクトリを指す dangling symlink、または別のマネージャが管理していたsymlink）をどう扱うのが業界の型か**。

## 方法・検証凡例

- `[直接]` — `raw.githubusercontent.com` からソース/ドキュメントのMarkdown/Nixファイルを直接 `curl` で取得、または `WebFetch` が該当ページの本文を逐語引用したもの。
- `[要約経由]` — `WebFetch`/`WebSearch` の要約を経由し、逐語確認していないもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの:
  - `gh search`/`gh api`（Bash経由）— サンドボックスの証明書検証エラー（`tls: failed to verify certificate: x509: OSStatus -26276`）で全面的に失敗。GitHub関連の一次データ取得は代わりに `WebFetch` で `api.github.com`/`raw.githubusercontent.com` に直接アクセスして代替した（これは `[直接]` 扱い — 要約でなく生JSON/生テキストを読ませている）。
  - `nix-community.github.io/home-manager/options.xhtml` — JSリダイレクトのみでオプション説明文の本体に到達できず。`home.backupFileExtension`/`home-manager.backupCommand` の正確な挙動は代わりにソースコード本体（`modules/files.nix`, `modules/files/check-link-targets.sh`）を直読して裏取りした。
  - nix-darwin の `/etc` 衝突処理 — 一次ドキュメント本文への直接到達はできず、`[要約経由]` のWebSearch結果のみ。

---

## 問い（再掲）

1. 主要ツールが管理先の既存ファイル/symlinkに何をするか(home-manager/nix-darwin/chezmoi/stow/dotbot/yadm/rcm/Mackup)。
2. 前とは別の方式が残したリンク/ファイルを片付けるツール・実践者はいるか、その安全基準は何か（削除 vs バックアップ vs 警告）。
3. 否定側の証拠（削除がユーザーデータを壊した事故、機能の撤回、苦情）。
4. 単一install命令の中で自動的にやるか、明示フラグ/別コマンドの裏側でやるか。

---

## 第1レンズ: ベンダー

### 1.1 home-manager — 自分自身の「前世代」だけを掃除し、それ以外は正規の衝突として扱う（唯一、ソースコードで完全に裏取りできたツール）

`https://raw.githubusercontent.com/nix-community/home-manager/master/modules/files.nix`（`[直接]`、`legacyCleanup` 関数、`legacyLinkGeneration` の呼び出し元コメント）:

> "# This activation script will\n#\n# 1. Remove files from the old generation that are not in the new\n#    generation.\n#\n# 2. Symlink files from the new generation into $HOME."

`cleanOldGen` 関数（同ファイル）はガード節を持つ:

> ```
> function cleanOldGen() {
>   if [[ ! -v oldGenPath || ! -e "$oldGenPath/home-files" ]] ; then
>     return
>   fi
>   ...
> }
> ```

**これが全ての鍵**: `oldGenPath` は home-manager 自身の**前の世代（generation）**のみを指す。前の世代が存在しない場合（＝そのマシンが home-manager で管理されるのが今回が初めて、または前の方式が home-manager ではなかった場合）、`cleanOldGen` は即座に `return` して何もしない。**つまり home-manager は「前とは別の方式が残したファイル」の存在を原理的に認識する仕組みを持たない** — 掃除の対象は常に「home-manager の直前の世代が書いた home-files マニフェストとの差分」だけである。

さらに `legacyCleanup` スクリプト自身も、削除前に対象が本当に自分の世代由来かを再検査する:

> ```
> # A symbolic link whose target path matches this pattern will be
> # considered part of a Home Manager generation.
> homeFilePattern="$(readlink -e ${storeDir})/*-home-manager-files/*"
> ...
> elif [[ ! "$(readlink "$targetPath")" == $homeFilePattern ]] ; then
>   warnEcho "Path '$targetPath' does not link into a Home Manager generation. Skipping delete."
> else
>   verboseEcho "Checking $targetPath: gone (deleting)"
>   run rm $VERBOSE_ARG "$targetPath"
> ```

**読み方**: たとえ「前の世代」が存在してその対象パスが空リストにあっても、リンク先が Nix store 上の home-manager 自身の世代パターンに一致しなければ、警告だけ出して**削除しない**。つまり「安全に削除してよい」の基準は二重（① 前の home-manager 世代のマニフェストに載っている ② 実際のリンク先が home-manager 自身の store パターンに一致する）で、どちらも満たさない限り触らない。

### 1.2 home-manager — 「前とは別の方式」の残骸が衝突として現れたときの扱いは、通常のファイル衝突と完全に同一（symlinkだから特別扱いされることはない）

`https://raw.githubusercontent.com/nix-community/home-manager/master/modules/files/check-link-targets.sh`（`[直接]`）の `checkCollision` 関数:

> ```
> elif [[ ! -L "$targetPath" && -n "$HOME_MANAGER_BACKUP_EXT" ]] ; then
>   backup="$targetPath.$HOME_MANAGER_BACKUP_EXT"
>   ...
>   warnEcho "Existing file '$targetPath' is in the way of '$sourcePath', will be moved to '$backup'"
> else
>   collisionErrors+=("Existing file '$targetPath' would be clobbered")
> ```

そして分類ループの直前:

> ```
> # Resolve all existing symlinks with a single readlink call. A link into a
> # Home Manager generation is ours; anything else is a collision candidate.
> if [[ ${#linkTargets[@]} -gt 0 ]] ; then
>   ...
>   if [[ ! "$currentSource" == $homeFilePattern ]] ; then
>     checkCollision "${linkSources[i]}" "${linkTargets[i]}"
> ```

**これは持ち主の実際の状況（旧レイアウトのsymlinkが`~`/`~/.config`に残っている）に直接答える一次資料**: home-manager 自身の store パターンに一致しない既存の symlink（別のマネージャが張ったもの、旧レイアウトのbashリンカが張ったもの、を含む）は「通常のファイル衝突」と全く同じ扱いを受ける。`backupFileExtension`（この持ち主は `"pre-next"` を設定済み）が設定されていれば `$targetPath.pre-next` にリネームしてから新しいsymlinkを張る。設定されていなければ `collisionErrors` に積まれ、activation全体が失敗して終わる:

> "Please do one of the following:\n- In standalone mode, use 'home-manager switch -b backup' to back up files automatically.\n- When used as a NixOS or nix-darwin module, set either\n  - 'home-manager.backupFileExtension', or\n  - 'home-manager.backupCommand',\n  ...\n- Set 'force = true' on the related file options to forcefully overwrite the files below."

**削除は一度も選択肢に無い。** 選択肢は「バックアップして置き換える」「force で強制上書き（バックアップなし）」「activationを中止する」の3つのみで、home-manager が既存の（前の方式が残した）symlinkやファイルを**自発的に消す**経路はソースコード上どこにも無い——消えるのは、あくまで新しいsymlinkに`mv`でリネームされてから、上書きされる形だけ。

### 1.3 home-manager — 自動force置換オプションは提案され、実装されたが、明示opt-inのまま。メンテナ自身が「無条件推奨は無責任」と明言

`nix-community/home-manager` issue #4199「Add option to replace existing files」（`[直接]`、WebFetch経由でissue本文取得）の要旨:

> "Having Home Manager fail if an existing file exists is a big foot-gun... if an existing file exists, users cannot cleanly roll back to previous NixOS generations because Home Manager will fail to realize those previous generations."

これは2026-09-26時点でクローズ済み、PR #7887（`[直接]`）で実装された。PR本文（`[直接]`、WebFetch経由取得）:

> "This adds an opt in option to instead overwrite the old backup instead of failing." / "This setting removes data, so I don't think suggesting it for any collision is responsible." / "Anyone turning this option on will be aware of potential data loss."

オプション名は `home-manager.overwriteBackup`。**これは同種の要求（前の方式の残骸を自動で片付けたい）が実際に業界内で出て、実装されたが、既定値は常にoffで、コミット本人が「無条件に勧めるのは無責任」と明記した一次資料** — Q4（自動か明示フラグか）に直結する。

### 1.4 nix-darwin — `/etc` 配下は「既存ファイルは上書きしない」が既定で、手動リネームを要求する（`[要約経由]`、一次ドキュメント本体には未到達）

WebSearchの要約（`[要約経由]`）: nix-darwinが `/etc` にファイルを配置しようとして既に存在する場合、"not linking environment.etc.\"nix/nix.conf\" because /etc/nix/nix.conf exists, skipping..." という警告を出し、**上書きせずスキップする**。既存ファイルを `mv /etc/bashrc /etc/bashrc.before-nix-darwin` のように手動でリネームするか、既存ファイルの中から nix-darwin 版を `source` するように書き換えることが公式に案内されている。**この一次ドキュメント本文は直接取得できておらず**、home-manager ほど確度の高い裏取りはできていない。ただし方向性は home-manager と一致する: 自動削除ではなく、スキップまたは手動対応。

### 1.5 chezmoi — 前の方式からの移行を公式にサポートするが、移行後の「片付け」自体には触れない

`https://www.chezmoi.io/migrating-from-another-dotfile-manager/`（`[直接]`、既存記録 `2026-09-24-chezmoi-copy-vs-symlink.md` で未取得だった新規ページ）:

> "Many dotfile managers (like stow, yadm, and rcm) use symbolic links... If you `chezmoi add` such a symlink, chezmoi will add the symlink, not the file. To assist with migrating from symlink-based systems, use the `--follow` option to `chezmoi add`... this will tell chezmoi add that the target state of `~/.bashrc` is the target of the `~/.bashrc` symlink, rather than the symlink itself. When you run `chezmoi apply`, chezmoi will replace the `~/.bashrc` symlink with the file contents."

**このページは「前の方式のsymlinkをどう取り込むか」だけを扱い、「前の方式が残した、もう使わない残骸をどう消すか」には一切触れていない** — vendor ドキュメントに明示的な空白がある。`chezmoi destroy`（`https://www.chezmoi.io/reference/commands/destroy/`、`[直接]`、WebFetch経由）は "Remove target from the source state, the destination directory, and the state" であり、危険な操作として `--force` なしではプロンプトが出ることが明記されているが、これは chezmoi 自身が管理しているターゲットの削除コマンドであり、**chezmoi が関知していない外部の残骸を掃除する機能ではない**。

### 1.6 GNU Stow — `--adopt` は既存ファイルを消さず「stowディレクトリに吸収する」。dangling symlinkの検査は本体と別の `chkstow` ユーティリティ

`http://www.gnu.org/software/stow/manual/html_node/Invoking-Stow.html`（`[直接]`、WebFetch経由）:

> "When stowing, if a target is encountered which already exists but is a plain file (and hence not owned by any existing stow package), then normally Stow will register this as a conflict and refuse to proceed. This option [`--adopt`] changes that behaviour so that the file is moved to the same relative place within the package's installation image within the stow directory, and then stowing proceeds as before." / "**Warning!** This behaviour is specifically intended to alter the contents of your stow directory. If you do not want that, this option is not for you."

`chkstow`（`https://www.gnu.org/software/stow/manual/html_node/Target-Maintenance.html`、`[直接]`、WebFetch経由）:

> "Stow provides a new utility `chkstow` to help with this. It includes three operational modes which performs checks that would generally be too expensive to be performed during normal stow execution." / "`--badlinks` Checks target directory for bogus symbolic links. That is, links that point to non-existent files."

**Q4への直接の答え**: dangling symlinkの検出（掃除の前段階）は stow 本体の通常実行には**含まれておらず**、別ユーティリティ `chkstow` を明示的に呼び出す形。しかも `chkstow` 自体が「削除する」とは文書に書かれていない（チェックのみ）。stow は「前の方式の残骸」という概念自体を持たない。

### 1.7 dotbot — `clean` ディレクティブが「安全に削除してよい」の基準を最も明確に一次文書化している

（`2026-09-24-dotfiles-architecture.md` §1.4で確認済みの「宣言的データテーブル」という設計の続き、`clean`単体は今回新規取得）`https://raw.githubusercontent.com/anishathalye/dotbot/master/README.md`（`[直接]`、WebFetch経由）:

> "Clean commands specify directories that should be checked for dead symbolic links. These dead links are removed automatically." / "Only dead links that point to somewhere within the dotfiles directory are removed unless the `force` option is set to `true`." / `recursive: true` — ディレクトリ再帰探索も可能だが `~` 全体の再帰は性能上非推奨。

link ディレクティブ側:
> "`relink` — Removes the old link if it's a symlink (default: false)" / "`force` — Force removes the old link, file or folder, and forces a new link (default: false)" / "`backup` — Backup existing files/directories if they exist, creating a backup with suffix `.dotbot-backup.{timestamp}`"

**これが今回調べた中で唯一「安全基準」を一文で明文化しているvendorドキュメント**: **「dotfilesディレクトリの中を指しているdangling symlinkだけを自動削除する」**。それ以外（他のツールが張ったsymlink、他の場所を指すdangling symlink）は `force: true` を明示しない限り一切触らない。

### 1.8 yadm / rcm / Mackup — いずれも「前とは別の方式の残骸」を扱う一次語彙を持たない

- yadm: `https://yadm.io/docs/alternates`（既存記録`2026-09-24-role-based-dotfiles.md` §1.5で確認済み、再掲なし）は `class`/`alt` の仕組みのみを持ち、外部ツールが残したsymlinkに関する記述は無い。ただし §2.2（実践者/実態）で見る通り、`yadm alt` 自身が**外部symlinkを意図せず削除するバグ**を抱えている。
- rcm: `rcdn`（`https://thoughtbot.github.io/rcm/rcdn.1.html`、`[要約経由]`）は「rcmが知っているrcファイル（＝symlink）だけを削除する」——rcm自身が作成し追跡しているものだけが対象で、外部ツールの残骸には触れない設計。
- Mackup: `link uninstall` は「Mackup自身が作ったsymlinkを消して元のファイルをコピーで戻す」機能であり、これも自分が作ったものだけが対象。前の別ツールの残骸を扱う機能は無い。

**総括（vendor）**: 7ツール中、「前とは別の方式が残した残骸」という概念を一次語彙として持つツールは**ゼロ**。全てのツールが「自分が作った/追跡しているもの」だけを掃除の対象にする設計に収束している。掃除の安全基準が最も明文化されているのは dotbot（"only dead links that point... within the dotfiles directory"）で、home-manager はソースコードレベルで同種の基準（自分のstoreパターンに一致するリンクのみ）を実装しているが、公式マニュアルの文章としては明文化されていない（今回ソース直読で発見）。

---

## 第2レンズ: 実践者

### 2.1 msleigh.io — GNU StowからChezmoiへの移行で、「片付け」がまさに実害を出した一次証言(強い証拠)

`https://www.msleigh.io/blog/2026/06/13/migrating-dotfiles-from-branches-and-gnu-stow-to-chezmoi/`（`[直接]`、`curl`でHTML取得しタグ除去して本文確認。既存記録`2026-09-24-dotfiles-architecture.md` §2.5で引用した同じ著者の別記事とは異なる記事）:

> "Old symlinks from the previous tool are not automatically cleaned up. Chezmoi only manages paths it knows about. Any directory not following Chezmoi's naming conventions is left alone — including symlinks created by the tool being replaced. A directory that was a live symlink under the old setup remained one after `chezmoi apply`, causing any new files written into it to land inside the source repository rather than the home directory."

これは vendor記述（§1.5）と完全に一致する一次的な実地確認: **chezmoiは前のツールの残骸を検知しない**。そしてこの直後、著者は**手動で**その残骸を片付けようとして、次の事故を起こした:

> "'Orphaned' content was still live. After the old symlinks were cleaned up, content in the source directory that appeared to be orphaned leftovers — no longer tracked by Git, not deployed by Chezmoi — was deleted as redundant. It was not redundant: because the old symlink was still active, that directory (Vim bundle configuration) in the source was still the live installation. Deleting it deleted the running software. The error mode is subtle: during a migration, the source directory simultaneously serves as the old tool's deployment target and the new tool's source of truth, and content that looks inert may still be in active use."

**これは「ツールが自動で消して事故った」話ではなく「ツールが何もしてくれないので人間が手作業で片付けて事故った」話**——vendorが「前の方式は自動で片付けない」という設計判断をした結果として、その責任が丸ごと人間の手作業に落ち、そこで実際にデータ（動いていたVimプラグイン一式）を失った、という直接の負の証拠。同記事は同じ移行作業の中でさらに2つの近縁トラブルを報告している:

> "Untracked symlinks in the source directory are silently followed. An untracked symlink pointing outside the source directory was found by Chezmoi's filesystem scan, followed to its target, and the target's content deployed as a regular file, changing the file type without any warning."

### 2.2 yadm issue #236 — 「別方式（home-manager）が張ったsymlinkをyadm自身が無条件削除する」という直接の反例

`https://github.com/yadm-dev/yadm/issues/236`（`[直接]`、WebFetch経由、api.github.com JSON取得）、**2020-07-26作成、2026-09-26時点でopenのまま**:

> "NixOS makes heavy use of symlinks for managing configuration. As a result I have a bit of a weird conflict between `yadm` and `home-manager` which both expect to create some symlinks in `~`. I was hoping to avoid conflicts by using yadm alternate files, but `yadm` seems to unconditionally remove the symlink created by other applications when it doesn't match one of the alts." / "If no alternate files match the current OS / `local` parameters, I would expect any existing file (including symlink) not to be modified."

メンテナ `TheLocehiliosan` の返信（同日）:

> "This change will likely have to be managed with a configuration, because your desired behavior is actually the old behavior before #65 was fixed."

実践者 `ian-h-chamberlain` の提案（同日）:

> "Would it be enough to check that the linked-to file is actually a `yadm alt` file... before removing it? In my case, the symlink getting removed links to somewhere entirely outside of the yadm worktree..."

メンテナの反応: "👍 Checking the target of the symlink is probably a good idea. I like it." — しかし2022年に2度 `stale` ラベルが付いた記録があるのみで、**2026-09-26時点でも修正はマージされておらず、issueはopenのまま6年放置**。**これは「別のdotfiles方式（この場合はhome-manager）が張ったsymlinkを、別のツール(yadm)がその存在を知らずに無条件で削除する」という、まさに設問が懸念する事故の実在する一次報告**——しかもメンテナ自身が「直すべき」と合意しながら6年間直っていない。

### 2.3 dcreager/dotfiles-base・clormor/dotfiles・muhac/dotfiles-manager — 自作ツールが収束する2つの型

**安全側（target-prefixチェックあり）**:
- `dcreager/dotfiles-base`（`[直接]`、README、8★、`pushed_at: 2022-04-16`）: "recursively look through the entire tree rooted under `$HOME`, looking for symlinks that point into a dotfiles repository, and deleting any symlink that points at a nonexistent file." — dotbotの`clean`ディレクティブと**全く同じ安全基準**（dotfilesリポジトリを指しているdangling symlinkのみ）に、独立に収束している。
- `clormor/dotfiles` PR #23（`[直接]`、WebFetch経由、0★、`pushed_at: 2026-09-14` = 12日前・現役）: "Renaming or deleting a file in the repo left its old symlink behind in $HOME, pointing at a path that no longer exists. Nothing cleaned these up, so stale links accumulated silently." に対する修正が "Offers deletion via interactive removal (`rm -i`) for each broken link that traces back to the repository" / "Preserves unrelated links by verifying the target path matches the repo location before removal" — **これも独立に同じ「リンク先がリポジトリ内かを確認してから、対話的確認付きで削除する」という型に収束**。まさに設問の状況（同じリポジトリの旧レイアウトが残したdangling symlink）にドンピシャで一致する実例。

**危険側（target-prefixチェックなし）**:
- `muhac/dotfiles-manager`（`[直接]`、README+`symlink.sh`、0★、`pushed_at: 2026-09-23` = 3日前・現役）の壊れたsymlink掃除コードは:
  > ```
  > find -L "$dir" -maxdepth 1 -type l -exec rm -f {} +
  > ```
  これは「壊れているかどうか」だけを見て、**リンク先がどこであれ**（自リポジトリの外・システムファイル・他ツールの管理下）無条件で削除する。README側に `CLEAN_BROKEN_LINKS=0` というスキップフラグはあるが、既定は有効（削除する側）。**3つの独立した個人リポジトリのうち1つが、dotbot/dcreager/clormorの「リンク先を確認する」という型を踏襲していない**——収束は完全ではないという直接の反証。

---

## 第3レンズ: 測定・実態（数値付き）

| 対象 | 数値 | 出典 |
|---|---|---|
| yadm-dev/yadm issue #236「Non-yadm symlinks are removed by yadm alt」 | open、2020-07-26作成、2026-09-26時点で**6年以上未修正** | `[直接]` api.github.com |
| home-manager issue #4199「Add option to replace existing files」 | closed、PR #7887で `home-manager.overwriteBackup` として実装（既定off） | `[直接]` api.github.com/github.com |
| home-manager由来issue: olafkfreund/nixos_config #1731「home-manager backupCommand is broken, making every file collision a fatal deploy」 | `backupCommand`のシェル構文4箇所の誤りで衝突が即死化した実例 | `[要約経由]` |
| dotbot issue #112「Need some clarification on `clean` command」 | closed、メンテナ回答: "if there was some broken link there that apparently didn't have anything to do with your dotfiles, then maybe we shouldn't touch it, just to be safe" | `[直接]` api.github.com |
| dotbot issue #90「make a back up of overwritten file or folder」 | closed（Milestone 2.0）、`force`が無条件削除であることへの懸念提起 | `[直接]` api.github.com |
| dcreager/dotfiles-base | 8★ / push 2022-04-16（4年停止） | `[直接]` api.github.com |
| clormor/dotfiles | 0★ / push 2026-09-14（12日前・現役） | `[直接]` api.github.com |
| muhac/dotfiles-manager | 0★ / push 2026-09-23（3日前・現役） | `[直接]` api.github.com |
| GNU Stow `chkstow --badlinks` | stow本体の通常実行とは別の専用ユーティリティ、"too expensive to be performed during normal stow execution" | `[直接]` gnu.org |

**バイアスの明記**: issue trackerは失敗報告に偏る（yadm #236, home-manager #4199/#1731, dotbot #90/#112はすべて「困った」側の報告）。star数はdcreager(8)・clormor(0)・muhac(0)といずれも小規模で、「掃除ロジックの型」についての学術的ベンチマークやリーダーボードはこの分野に存在しない（`2026-09-24-chezmoi-copy-vs-symlink.md`で既に確認済みの事実の継続）。

---

## 第4レンズ: 実態（in the wild）

- **「前とは別の方式の残骸を掃除する」を一次機能として持つ有名・大規模ツールは無い** — dotbot（8,007★、既存記録で確認済み）の`clean`でさえ、対象は「dotbotのdotfilesディレクトリを指すdangling symlink」に限定され、「前は別のツールだった」ケースを名指ししていない。
- **個人の小規模リポジトリ（★1桁〜0）でだけ、この問題への対処が実装されている** — dcreager(8★)・clormor(0★)・muhac(0★)。いずれも「困ってから自分で書いた」パッチであり、確立された共有ライブラリやプラグインとしての実装は見つからなかった。
- **収束の程度は部分的** — dotbot・dcreager・clormorの3件は独立に同じ安全基準（target-prefixチェック）に到達しているが、muhacの1件はそれをしていない。3対1で「target-prefixチェックあり」が優勢だが、全会一致ではない。
- **yadmの6年放置issue**が示す実態: 「別方式の残骸を巻き込んで消してしまう」バグは、メンテナが妥当性を認めても長期間放置されうる——「有名で管理されているツールだから安全」という前提は成立しない。

---

## 否定側の証拠（同じ熱量で収集）

- **msleigh.io: chezmoiが片付けをしない設計選択の結果、人間の手作業がVimプラグイン一式（動いていたソフトウェア）を削除した** — §2.1。ツール自身が壊したのではなく、「ツールが何もしないので人間が代わりにやって壊した」という間接的だが実在する事故。
- **yadm issue #236: 別方式(home-manager)が張った外部symlinkをyadm自身が無条件削除する、6年open未修正のバグ** — §2.2。まさに設問が懸念する事故そのものの一次報告。
- **home-manager issue #1731: `backupCommand`のシェル構文誤りで、あらゆるファイル衝突が致命的なactivation失敗になった** — 「バックアップして安全に」という設計自体は正しくても、実装（この場合はユーザー自身の設定ミス）次第で「安全策のはずが逆に全面停止を招く」実例。
- **muhac/dotfiles-manager: target-prefixチェックなしの無条件`rm -f`で壊れたsymlinkを削除する設計** — dotbot/dcreager/clormorが収束した「安全な削除」パターンに従っていない、現役（3日前push）の反例。
- **dotbot issue #90: `force`オプションが元ファイルをバックアップなしで削除することへの懸念** — closedにはなったが、issue本文からは実際にバックアップ機構が追加されたかどうかは確認できず（`[未確認]`として明記）。
- **home-manager issue #4199 = 「既存ファイルがあると失敗する」設計自体への苦情が"6th most-liked issue"になるほど大きかった**（PR #7887本文の言及） — 「安全側に倒す」設計判断そのものが、実際のユーザーには「足かせ」として不満を持たれていたことの直接証拠。

---

## Q4への回答: 自動か、明示フラグ/別コマンドか

集めた証拠は一貫して**「明示フラグ/別コマンド」側**を支持する:

- home-manager: 自動force置換 (`overwriteBackup`) は実装されたが**既定off**、実装者本人が「無条件推奨は無責任」と明言（§1.3）。
- GNU Stow: dangling symlinkの検査は本体の`stow`実行とは別の`chkstow`という**専用ユーティリティ**（§1.6）。
- dotbot: `clean`ディレクティブ自体は自動実行されるが、対象は「dotfilesディレクトリ内を指すdangling symlinkのみ」に**あらかじめ範囲を絞った上で**自動、それ以外は`force: true`という**明示フラグ**なしには一切触らない（§1.7）。
- chezmoi: 前方式の残骸を掃除する機能自体が無く、`--follow`（symlinkの中身を取り込む）も`destroy`（自分の管理対象を消す）も、どちらも**ユーザーが明示的に呼ぶコマンド**であって自動発火ではない（§1.5）。

**「単一の冪等install命令の中に、前方式の残骸削除を無条件で組み込む」という設計は、今回調べた範囲のどのツールにも見つからなかった。** 見つかったのは「①対象を厳密に絞った上で自動（dotbotのclean）」「②明示的なopt-inフラグ（home-managerのoverwriteBackup）」「③別コマンド（chkstow、chezmoi destroy）」の3パターンのみで、どれも「デフォルトで、無条件に、前とは別の方式の残骸を消す」という形は取っていない。

---

## 確認できなかったこと

- nix-darwinの`/etc`衝突処理の一次ドキュメント本文（`nix-darwin.github.io/nix-darwin/manual/`該当ページ）への直接到達——WebSearchの要約のみで裏取りした。
- dotbot issue #90が実際にバックアップ機構の追加につながったかどうか——issueはMilestone 2.0でcloseされているが、対応するPRやコミットまでは追えていない。
- GNU Stowの`--adopt`が実際にユーザーのデータを失わせた一次のインシデント報告——複数のクエリで検索したが見つからなかった。`--adopt`の設計自体（既存ファイルを保持したままstowディレクトリへ移す）は「削除しない」という点で他のツールと同じ方向だが、それを裏付ける負の実地証拠は今回の調査時間内では発見できなかった（「無い」ことの確認であり、「存在しない」ことの証明ではない）。
- yadm issue #236のその後の展開（2022年のstaleラベル以降、2026年までの間に何らかの議論やPRがあったか）——今回取得したコメント一覧はstaleボットの投稿までで打ち切られており、その後の履歴は未確認。
- rcmの`rcdn`・Mackupの`link uninstall`の一次ドキュメント本文の逐語確認——いずれも`[要約経由]`（WebSearchのスニペットのみ）で、raw sourceへの直接アクセスは今回行っていない。
- 「dotfilesマネージャの掃除ロジック」について、学術的ベンチマークや定量的な安全性評価——既存記録（`2026-09-24-chezmoi-copy-vs-symlink.md`）で確認済みの通り、この分野自体に測定的エビデンスの慣行が無いため、今回も同じ結果（存在しない）だった。

---

## 結論（誰かに一度で伝わるように）

**「別のdotfiles方式が残した残骸を、単一の冪等install命令が自動で片付ける」という業界標準は存在しない。** 7つの主要ツール（home-manager, nix-darwin, chezmoi, GNU Stow, dotbot, yadm, rcm, Mackup）は例外なく「自分が作った/追跡しているものだけを掃除する」設計であり、home-managerに至ってはソースコードレベルで二重のガード（① 前の**自分自身の**世代のマニフェストに載っている ② リンク先が**自分の**Nix storeパターンに一致する）を持つ——「前とは別の方式」という概念そのものが、どのツールの設計にも存在しない。

**この持ち主の具体的な状況（同じリポジトリの旧レイアウトが`~`/`~/.config`に残したdangling symlink、`backupFileExtension = "pre-next"`設定済み）に対して、home-managerのソースコードが実際にどう振る舞うかは特定できた**: 旧レイアウトがhome-manager自身の管理下に一度でもあった場合は`oldGenPath`との差分として自動的に片付く。旧レイアウトがhome-manager管理下に一度も入っていなかった場合（bashリンカ時代の残骸など）は、home-managerはその存在を検知する仕組みを持たず、**新しい設定がそのパスに新しくファイルを置こうとした瞬間にだけ**「通常の衝突」として現れ、`backupFileExtension`（設定済みの`"pre-next"`）でリネームされる。**home-managerが管理しようとしていないパス（今の設定に対応するオプションが無い、今後も無い旧レイアウトのファイル）は、home-managerからは永遠に見えず、永遠にdanglingのまま放置される** — これはバグではなく設計そのもの。

**「掃除を自動化したい」という要求自体は実在し（home-manager #4199、"6th most-liked issue"）、実装もされた（`overwriteBackup`）が、既定は常にoffで、実装者本人が「無条件に勧めるのは無責任」と明記した。** これと対称的に、独立した3つの個人dotfilesリポジトリ（dotbot・dcreager・clormor）が自然に収束した安全基準は**「リンク先が自分のdotfilesリポジトリを指しているdanglingリンクだけを対象にする」**であり、この基準を持たない1件（muhac）が現役で存在することも含め、**「収束はしているが全会一致ではない」**という中間的な実態が最も正確な要約になる。

**否定側の証拠が最も雄弁に語るのは、「ツールが自動で片付けない」という安全側の設計判断そのものが、責任を人間の手作業に丸ごと移すだけで、事故を無くしはしない**ということ（msleigh.ioのVimプラグイン削除、§2.1）。逆に「ツールが自動でやってしまう」側の実例（yadm issue #236）は、他方式のsymlinkを無条件削除するバグとして6年間放置されている。**どちらの方向にも実在する失敗モードがあり、「安全な自動化」を主張できる一次資料はどこにも見つからなかった。**

### 前例なしリスト

- 「前とは別のdotfiles方式の残骸を検知して片付ける」ことを一次機能として持つ、★1,000超級の有名dotfilesツール・フレームワーク: なし。
- 「同じリポジトリの旧レイアウトからの移行」に特化した掃除ロジックの業界標準・共有ライブラリ・プラグイン: なし（見つかったのはいずれも個人リポジトリ内の自作パッチ）。
- GNU Stow `--adopt` によるユーザーデータ損失の一次インシデント報告: なし（検索したが見つからず、「存在しない」ことの証明ではない）。
- dotfilesの掃除ロジックの安全性に関する学術的・定量的評価: なし（分野自体にこの慣行が無いことは既存記録で確認済み）。
