# chezmoi: コピー既定 vs シンボリックリンク — ドリフト懸念の裏取り

日付: 2026-09-24
四方向(ベンダー/実践者/測定/実態)すべてを調査。英語出典は原文を逐語引用し、日本語で解説する。

## 方法と検証の凡例

- **直接取得(原文)**: `raw.githubusercontent.com/twpayne/chezmoi` から Markdown ソースを直接 `curl`、GitHub API (`api.github.com`, 認証付き `gh auth token`) でissue本文・コメントを直接取得。これらは逐語引用可能。
- **要約フェッチ経由**: `WebFetch` ツールでHTMLページを取得・要約させたもの。本文中に明記する。逐語引用ではなく要約であることに注意。
- **到達不能**: HackerNews記事本体(`news.ycombinator.com/item?id=31015669`)は直接アクセスでHTTP 429。代わりに `hn.algolia.com` の公開APIから同一コメントを直接取得し、逐語確認できた。

出典URLは各項目に付記。

---

## 問い

1. chezmoiはなぜ既定でコピー方式なのか(公式の理由)。
2. symlinkモード(`mode = "symlink"`)は何をして何をできないか、誰が使っているか。
3. chezmoiはドリフト(直接編集とリポジトリの乖離)をどう検知・解消するか(`status`/`diff`/`verify`/`re-add`/`merge`/`edit --apply`/`--watch`)。`apply`は上書き前に確認するか。
4. コピー方式で実際にドリフトに苦しんだ/symlinkモードに切り替えた/chezmoiをやめた/コピー方式で問題ないと言う実践者の声。
5. dotfilesにおけるsymlinkの業界的な評価。既知の破損モード(エディタのアトミック書き込み、macOSのcfprefsd、Omarchyのリフレッシュ)と、逆にStow/yadm/home-managerのsymlinkが機能しているという反証。コンセンサスはあるか。

---

## 所見

### 1. ベンダー(chezmoi公式ドキュメント、原文取得)

**なぜコピーなのか — `docs/user-guide/frequently-asked-questions/design.md`**
出典: https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/user-guide/frequently-asked-questions/design.md (raw取得、逐語)

> "Why doesn't chezmoi use symlinks like GNU Stow?"
>
> "Symlinks are first class citizens in chezmoi: chezmoi supports creating them, updating them, removing them, and even more advanced features not found in other dotfile managers like having the same symlink point to different targets on different machines by using a template."
>
> "With chezmoi, you only use a symlink where you really need a symlink, in contrast to some other dotfile managers (e.g. GNU Stow) which require the use of symlinks as a layer of indirection between a dotfile's location ... and a dotfile's content ... chezmoi solves this problem in a different way."
>
> "Instead of using a symlink to redirect from the dotfile's location to the centralized directory, chezmoi generates the dotfile as a regular file in its final location from the contents of the centralized directory. This approach allows chezmoi to provide features that are not possible when using symlinks, for example having files that are encrypted, executable, private, or templates."
>
> "The only advantage to using GNU Stow-style symlinks is that changes that you make to the dotfile's contents in the centralized directory are immediately visible whenever you save them, whereas chezmoi currently requires you to pass the `--watch` flag to `chezmoi edit` or set `edit.watch` to `true` in your configuration file."

つまり公式の一次理由は「テンプレート・暗号化・executable/private属性を持たせるため」であり、「symlinkは信頼できないから」という主張は公式ドキュメントには**出てこない**。理由は機能面(テンプレート機能等)。「即時反映されない」ことは唯一の欠点として明示的に認めている。

同ページはさらに、symlinkモードの自動化提案(issue #886)について:

> "chezmoi might get some automation to help ... but it does need some convincing use cases that demonstrate that a symlink from a dotfile's location to its contents in a central directory is better than just having the correct dotfile contents."

**symlinkモードの制限 — 同ページ「What are the limitations of chezmoi's symlink mode?」**

> "In symlink mode chezmoi replaces targets with symlinks to the source directory if the target is a regular file and is not encrypted, executable, private, or a template."
> "Symlinks cannot be used for encrypted files because the source state contains the ciphertext, not the plaintext."
> "Symlinks cannot be used for executable files as the executable bit would need to be set on the file in the source directory and chezmoi uses only regular files and directories in its source state for portability across operating systems."
> "Symlinks cannot be used for private files because git does not persist group and world permission bits."
> "Symlinks cannot be used for templated files because the source state contains the template, not the result of executing the template."
> "Symlinks cannot be used for entire directories ..."
> "In symlink mode, running `chezmoi add` does not immediately replace the targets with a symlink. You must run `chezmoi apply` to create the symlinks."

**symlinkモードの設定 — `reference/target-types.md`**
出典: https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/reference/target-types.md (raw取得、逐語)

> "By default, chezmoi will create regular files and directories. Setting `mode = "symlink"` will make chezmoi behave more like a dotfile manager that uses symlinks by default, i.e. `chezmoi apply` will make dotfiles symlinks to files in the source directory if the target is a regular file and is not encrypted, executable, private, or a template."

**`apply`は無断で上書きしない — `reference/commands/apply.md`**
出典: https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/reference/commands/apply.md (raw取得、逐語)

> "Ensure that *target*... are in the target state, updating them if necessary. If no targets are specified, the state of all targets are ensured. **If a target has been modified since chezmoi last wrote it then the user will be prompted if they want to overwrite the file.**"

**懸念にそのまま答えるFAQ項目 — `usage.md`**
出典: 同リポジトリ、raw取得、逐語(このタイトル自体が調査依頼者の懸念とほぼ同一文言)

> "What are the consequences of 'bare' modifications to the target files? If my `.zshrc` is managed by chezmoi and I edit `~/.zshrc` without using `chezmoi edit`, what happens?"
>
> "Until you run `chezmoi apply` your modified `~/.zshrc` will remain in place. When you run `chezmoi apply` chezmoi will detect that `~/.zshrc` has changed since chezmoi last wrote it and prompt you what to do. You can resolve differences with a merge tool by running `chezmoi merge ~/.zshrc`."

同ページはさらに5通りの編集ワークフローを列挙し、コピー先を直接編集して `chezmoi re-add` / `chezmoi merge` で書き戻す運用を公式に認めている。

**ドリフト検知・解消コマンド群(すべて raw取得、逐語)**
- `status`: "The first column of output indicates the difference between the last state written by chezmoi and the actual state." — git statusに似た二列表示で"last written"と"actual"の乖離を可視化。 (https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/reference/commands/status.md)
- `verify`: "Verify that all *target*s match their target state. chezmoi exits with code 0 (success) if all targets match their target state, or 1 (failure) otherwise." — CI向けの0/1終了コード。(.../commands/verify.md)
- `re-add`: "Re-add modified files in the target state ... chezmoi will not overwrite templates." (.../commands/re-add.md)
- `merge`: "Perform a three-way merge between the destination state, the target state, and the source state for each *target*." 既定は `vimdiff`。(.../commands/merge.md)
- `edit --watch`: "Automatically apply changes when files are saved" — ただし "Only works if `edit.hardlink` is enabled and works." という制約付き。(.../commands/edit.md)
- `edit`のハードリンク機構: "chezmoi creates a hardlink in a temporary directory to the file in your source directory, so even though your editor thinks it's editing `.zshrc`, it is really editing `dot_zshrc` in your source directory." — つまり `chezmoi edit` 経由なら編集は**直接ソースファイルを書き換えている**(symlinkと同じ即時反映)。(troubleshooting.md)

**「symlinkは二級市民か」— issue #980、メンテナ(twpayne)本人の回答**
出典: https://github.com/twpayne/chezmoi/issues/980 (GitHub API、逐語)

> "Symlinks are first class citizens: chezmoi supports creating them, updating them, removing them, and even more advanced features not found elsewhere like having the same symlink point to different targets on different machines by using templates."
> "I suspect the question arises because, with chezmoi, you only use symlinks where you really need a symlink, in contrast to some other dotfile managers (e.g. GNU Stow) ..."

同issueで実践者 adrian5 (2021-01-01) の疑問:

> "I'm just very used to editing files in their target location (symlink approach), but that can be unlearned."

twpayneの回答:

> "Personally, I tend to run `chezmoi cd` and then just edit the files in the source state directly with my `$EDITOR`. After I save an edited file I run `chezmoi diff` to check what effect my changes would have, and run `chezmoi apply` once I'm happy with the result."

**symlinkモードの完全自動化提案(issue #886)は2021-12-22にメンテナがWONTFIXでクローズ**
出典: https://github.com/twpayne/chezmoi/issues/886 (GitHub API、逐語)

> "I'm going to close this as WONTFIX because:
> * The proposal breaks the 1:1 mapping between files in the source direction and files in the destination directory
> * There are many good reasons why you shouldn't use symlinks for your dotfiles
> * chezmoi has a symlink mode which you can use where necessary.
> * For the remaining use cases where you do actually want a symlink, you can do this with a `symlink_`."

これは約1年半(2020-09〜2021-12)にわたる実践者3名(kcthrn, eugenesvk, 3v1n0)との詳細な設計議論の末の判断であり、「symlinkモードをもっと自動化してほしい」という需要が実在したことと、それをメンテナが意図的に拒否したことの両方を示す一次資料。

**Why use chezmoi? のユーザー証言(ベンダーサイト掲載、バイアスに留意=好意的な声のみ選別掲載)**
出典: https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/why-use-chezmoi.md

> "Chezmoi is like what you might get if you re-wrote my bash script in Go, came up with better solutions than `diff` for managing config on multiple machines, added in secrets management and other useful dotfile tools, and tweaked and perfected it over years." — @mike_kasberg

このページはベンダー自身が選んだ肯定的引用のみで構成されており、否定的な声は含まれない(バイアス明記)。

### 2. 実践者(独立ソースで裏取り)

**njt(Hacker News, 2022-04-13、独立取得で確認)**
出典: https://hn.algolia.com/api/v1/items/31015669 (Algolia HN API、逐語、chezmoi公式サイトが引用しているのと同一コメントだが、ここでは独立に一次ソースへアクセスして確認した)

> "I spent some time evaluating all the available dotfile managers a few months ago and settled on chezmoi ... I had initially been turned off when I first encountered it, because it seemed overkill for (what appeared to me) a simple task. But the problem of managing a relatively small number of dotfiles across a relatively small number of machines with small differences between them and keeping them up to date proved to be MUCH more complex than I imagined. Copy things around by hand, and then later distributing them via source control got hairy very quickly."

**Mike Kasberg (要約フェッチ経由、ブログ本文未逐語取得)**
出典: https://www.mikekasberg.com/blog/2021/05/12/my-dotfiles-story.html (WebFetch要約)
ドリフトについて: "You update the file on one computer, but forget to copy it down on another one and the files get out of sync." — これはchezmoi以前の手運用(Dropbox + bashスクリプト)の問題として書かれている。symlink vs コピーの直接比較は本文になし。[要約経由、逐語未確認]

**twpayne本人(2019年、issue #423への回答=メンテナも実践者としてこの穴を認めた)**
出典: https://github.com/twpayne/chezmoi/issues/423 (GitHub API、逐語) — 詳細は「否定側の証拠」参照。

**lunik1(2019-12-30、コミュニティによる自衛策)**
出典: 同issue #423のコメント(GitHub API、逐語)

> "If you use zsh here is a snippet you can add to your `.zshrc` to make sure any changes made by `chezmoi apply` are manually confirmed."

ユーザーが `chezmoi apply` を毎回 `-n`(dry-run)でラップし、差分がある場合のみ手動確認するzsh関数を書いて共有している。本人いわく "I would like to see something like this added to chezmoi proper, too." — 公式機能では不十分だったという意思表示。

**adamshand(2024-01、discussion #3513)**
出典: https://github.com/twpayne/chezmoi/discussions/3513 (GitHub API、逐語)

> "I'd like to run `chezmoi update` nightly on all my servers to make sure they always have the latest version of files. However if there are local changes I'd like them to be skipped, so I don't risk losing something useful. This seems like it should be easy, but I can't figure out how to do this."

twpayneの回答: 組み込みフラグは無く、`chezmoi status` の出力をパースして自作スクリプトを書く必要があると案内。adamshandは実際にそのラッパースクリプトを書いて共有した(2024-01-26)。**非対話(cron/CI)運用でのドリフト自動回避は、2024年1月時点でもchezmoi本体に組み込み機能がない**という限界を示す一次資料。

### 3. 測定的エビデンス

dotfileマネージャ選択について、査読論文・ベンチマーク・リーダーボードの類は**存在しない**分野である(探索したが見つからず、以下「確認できなかったこと」参照)。この観点での定量測定は「実態」レンズのGitHub指標(スター数、issue件数、push日時)で代替する。

### 4. 実態(GitHub上の公開状態、`gh api` / 検索、認証済み)

**リポジトリの活動状況(2026-09-24時点、`api.github.com` 直接取得)**

| リポジトリ | Star数 | Open issues | 最終push |
|---|---|---|---|
| twpayne/chezmoi | 21,703 | 59 | 2026-09-20 |
| yadm-dev/yadm | 6,431 | 48 | 2026-04-13 |
| aspiers/stow (GitHub mirror, 本家はGNU Savannah) | 1,131 | 44 | 2025-12-03 |
| lra/mackup | 15,330 | 292 | 2026-09-09 |
| nix-community/home-manager | 10,380 | 977 | 2026-09-24 |

chezmoiは活発にメンテナンスされている(open issue 59件は21.7k starのプロジェクトとしては低い比率)。Mackupは292件のopen issueを抱え、うちタイトルに"symlink"を含むものだけで26件ヒットする(`gh api search/issues q=repo:lra/mackup+symlink+in:title` → total_count: 26)。これはMackupがsymlinkでmacOSアプリ設定を管理する設計を採っていることに起因する既知の構造的弱点であることを示す量的シグナル。

**VS Code: symlinkを上書きする既知バグ(修正後も再発報告あり)**
出典: https://github.com/microsoft/vscode/issues/194856 (GitHub API、逐語)

タイトル: "vscode always replace symlink `settings.json`"、2023-10-05オープン、VS Code 1.83.0での退行。コメント欄より:

> daniel-liuzzi: "This also happens on Windows symbolic links after updating to 1.83.0"
> RasmusLeupold: "It is the same behavior on MacOS."
> wdscxsj: "This also happens to other symlinked files like `keybindings.json` and `locale.json`; they are replaced on save."
> sandy081 (VS Code開発者): "@bpasero Thanks for the fix. Tagged this as a candidate." (2023-10-05、修正はほぼ即日)
> jstm88 (2023-10-09、修正後の再発報告): "I've observed that on my machine (macOS 13.5.2) the symlinks are not deleted, but instead all settings simply fail to save. There is no error message ... If I make a local copy of the file instead of a symlink, the file *is* updated with the new setting and it works."

関連issue https://github.com/microsoft/vscode/issues/195539 (GabrielStaples、GitHub API裏取り):

> "it wipes the file and creates a whole new inode number! This means there is now no way for me to either symlink _or_ hardlink to the settings files"

結局、ユーザーの一人(ElectricRCAircraftGuy)は同issueのコメントでsymlinkを諦め、**git hookでファイル変更を検知してコピーする**回避策を公開している — chezmoiが採用しているのと同じ「コピー方式」に独立して収束した実例。

**macOS: cfprefsdとsymlinkの相性問題(Mackup #1924, Sonoma)**
出典: https://github.com/lra/mackup/issues/1924 (WebFetch要約) / https://adamtaylor.me/posts/sonoma-breaks-symlinks (WebFetch要約)

> Mackup #1924 (scottrobertson): "App settings will not persist on macOS 14" — Raycast, iTerm, Rectangle, Bartenderなど複数アプリで発生。`mackup uninstall`で直るが`mackup backup`を再度打つと再発。

adamtaylor.me記事の要約:「macOS SonomaはPreferencesディレクトリ内の`.plist`のsymlinkを壊した。iTerm2、Karabinerが影響を受けた。著者はCVE関連の変更を疑っているが推測にとどまる[unverified]。最終的な回避策は`cp -R`によるコピーへの切り替え」— これもsymlinkからコピーへの回帰の実例。

**Omarchy: リフレッシュ処理がsymlinkを実体ファイルに置き換えるバグ(修正済み)**
出典: https://github.com/omacom/omarchy/pull/9372 (WebFetch要約、PR本文由来)

> PRの要旨: "the rename also replaces a **symlink**" — `mktemp` + `mv`によるコンフィグ移行処理が、symlink化されたdotfiles(ユーザーのdotfilesリポジトリからリンクされた設定)を**気づかれないまま実体ファイルに変換**し、以後の編集がリポジトリに反映されなくなるバグ。修正は`mv`をやめ、既存のsymlinkのinodeをそのまま使う`cat "$tmp" >"$file"`方式に変更。

出典: https://github.com/omacom/omarchy/discussions/191 (WebFetch要約)

> sspaeti: "Just don't change the omarchy dots in ~/.local/share/omarchy, and move all your dots in somewhere not touched by Omarchy" — Omarchy公式dotfilesとは別の場所にユーザー自身のdotfilesを置き、GNU Stowで管理する回避策。

出典: https://omarchy.org/manual/dotfiles/ (WebFetch要約、ベンダー一次)

> "Those are considered your files for your changes. The files that live in `/usr/share/omarchy` belong to Omarchy itself" — Omarchy自体は`.bashrc`のみ更新で保護すると明言するが、`~/.config`配下の一般論としてのsymlink安全性は保証していない。

**home-manager: `mkOutOfStoreSymlink`は「反例」として機能している(WebFetch要約)**
出典: 検索結果の要約より(NixOS公式ドキュメント、home-manager issue #3514ほか)

> "Home Manager provides a `mkOutOfStoreSymlink` function ... Using `mkOutOfStoreSymlink` instead of store copies allows editing a dotfile to be live and requires no switch."

ただし: "The `recursive` option is incompatible with `mkOutOfStoreSymlink` (Home Manager bug #7187) and silently falls back to store paths, which breaks live editing." — symlink方式にも独自の落とし穴があることが要約中に明記されている。[要約経由]

**GNU Stow: 継続使用の実態(要約検索、逐語未確認)**
Stowは現在もアクティブに使われている([要約経由]複数の2024-2026年のdotfilesリポジトリ/ブログ記事)。ただしStow本家はGNU Savannahにあり、GitHub上の`aspiers/stow`はミラールートで、star数(1,131)はStow全体の採用規模を過小評価している可能性が高い[unverified]。

### 5. 「symlinkは悪い」は業界コンセンサスか

見つかった証拠を総合すると、単純な「symlinkは悪い」という一枚岩の合意は存在しない。実際に踏まれている境界線は次の通り:

- **壊れるのは主に「他のアプリが設定ファイルにアトミック書き込み(mktemp+rename)をするケース」** — VS Code (#194856, #195539)、Omarchyのリフレッシュ処理 (PR #9372)。rename系のアトミック書き込みはsymlinkのinodeを消して実体ファイルに置き換えるため、意図せずリンクが切れる。
- **macOSのGUIアプリの環境設定(`~/Library/Preferences`、cfprefsd経由)は特に弱い** — Mackup issue 26件、Sonomaでの一斉破損。CLIのプレーンテキスト設定(`.zshrc`, `.tmux.conf`など)とは別の失敗モード。
- **CLIのプレーンテキスト設定に対するsymlinkは実際に機能し続けている** — Stow、yadm、home-managerの`mkOutOfStoreSymlink`は現役で使われている(star数、pushed_at共に活発)。
- chezmoi自身の結論(design.md, issue #980, #886)は「テンプレート・暗号化・パーミッションが要らないファイルだけsymlinkモードでよい」という線引きであり、これは上記の実態調査と整合する。

---

## 否定側の証拠

- **コピー方式でも実際にドリフトで変更を失った実践者がいる(2019年当時)。** issue #423, markstos: "Today I ran `chezmoi update` for the first time, not realizing beforehand that it would `apply` by default. I might have lost of some changes-- I'm not sure." GabeDuarteM: "some tools automatically add stuff to your configs, and I lost some of them due to an `apply` I made later." — これは現在の"modified since last write"プロンプトが実装される**契機になった**issueであり、当時は防御機構が無かったことを示す。(https://github.com/twpayne/chezmoi/issues/423)
- **非対話運用(cron/CI)では、ドリフト保護が組み込まれていない。** 2024年1月時点でも「更新のたびにローカル変更をスキップする」公式フラグはなく、ユーザー自身が`chezmoi status`をパースするスクリプトを書く必要があった。(https://github.com/twpayne/chezmoi/discussions/3513)
- **symlinkモードの完全自動化はメンテナに明確に拒否されている(WONTFIX, 2021-12-22)。** 実践者側からの1年以上にわたる設計提案は通らなかった。(https://github.com/twpayne/chezmoi/issues/886)
- **symlink方式側にも独自の破損が実在する。** VS Codeのアトミック書き込みでのsymlink破壊(クロスプラットフォームで再現、#194856/#195539)、macOS Sonomaでの`.plist`シンボリックリンク破損(Mackup #1924、タイトルに"symlink"を含むissueだけで26件)、Omarchyのconfig移行処理によるsymlink消失(PR #9372、修正前は"silently converted to detached copies")。これらはすべて「symlinkにしておけば編集がリポジトリに反映される」という前提そのものを覆す、独立した3つのエコシステムでの実例。
- **chezmoiの`chezmoi edit`は便利だが、デフォルトの直接編集運用(`chezmoi cd`して直接編集)を選ぶユーザーもメンテナ自身を含めて多い。** つまり「symlinkでない=即時反映されない」という不便さは、公式もissue #980で"unlearn"が必要な体験として認めている。

---

## 確認できなかったこと

- dotfileマネージャの選択について、学術論文・定量ベンチマーク・リーダーボードは検索した範囲では**存在しない**。これはこの分野に測定的エビデンスの慣行自体がないためであり、chezmoiや symlink方式固有の欠落ではない。
- Mike Kasbergのブログ記事本文は`WebFetch`による要約のみで、原文の逐語引用は取得できていない[要約経由]。
- Omarchy関連の3ページ(discussions/191, manual/dotfiles, PR #9372)はすべて`WebFetch`要約経由であり、GitHub APIでの逐語裏取りは行っていない[要約経由]。
- macOS Sonomaでsymlinkが壊れた技術的原因(CVE起因かどうか)は、参照した記事自身が推測であると認めており、Appleの一次資料には未到達[unverified]。
- GNU Stowの「継続して使われている」という評価はWeb検索の要約に基づくもので、Stow本家(GNU Savannah)のissueトラッカーやメーリングリストは未調査。
- `chezmoi.vim`のようなエディタ統合や、symlinkモードを実運用しているユーザーの実際のdotfilesリポジトリ(例えばissue内で名前が挙がった`3v1n0`, `eugenesvk`, `kcthrn`)の実際の運用結果(何年使ってどうなったか)までは追えていない。

---

## 結論

**懸念(コピーだと直接編集がリポジトリに反映されずドリフトする)は根拠のある心配だが、chezmoiはそれを無視していない。** メンテナ自身が「テンプレート・暗号化・実行属性のために実ファイルが要る」という機能上の理由でコピーを選び(design.md)、その代わりに `apply`実行時の「最後にchezmoiが書いた時から変更されていたら確認を求める」という検知機構(apply.md, verbatim: "the user will be prompted if they want to overwrite the file")と、`status`/`diff`/`merge`/`re-add`という一連の解消コマンドを用意している。これは「ドリフトが起きない」設計ではなく「ドリフトを検知して手動で解決させる」設計であり、無音の上書きは公式ドキュメント上は起きない仕様になっている。

**ただし無音上書きが「起きない」のは対話的な`apply`のときだけである。** 2019年には実際に変更を失った実践者が複数おり(issue #423)、それが現行のプロンプト機構が実装される契機になった。さらに2024年時点でも、cronなど非対話運用でドリフトを自動回避する組み込み機能はなく、ユーザーが`chezmoi status`の出力をパースする自作スクリプトを書く必要がある(discussion #3513)。**「直接編集で書き戻されない」という懸念そのものは、対話運用では公式機構でほぼ解消されているが、自動運用では未解決のまま残っている。**

**「symlinkは悪い」という業界の一枚岩の合意は見つからなかった。** 見つかったのはもっと具体的な境界線である。symlinkが壊れるのは主に「他のプログラムがそのファイルに対してmktemp+renameのアトミック書き込みをする」ケース(VS Code #194856/#195539、Omarchy PR #9372)と、「macOSのGUIアプリ環境設定(cfprefsd経由)」のケース(Mackup、symlinkを含むissueだけで26件)であり、いずれもプレーンテキストのCLI設定ファイル(`.zshrc`など)を自分だけが編集する用途とは異なる失敗モードである。GNU Stow・yadm・home-managerの`mkOutOfStoreSymlink`は実際に現役で使われ続けており(星数・push日時とも活発)、CLI設定に限ればsymlinkは今も業界で機能している。

**chezmoiが業界で評価されている点は、"symlinkを避けていること"自体ではなく、単一ソースからテンプレート・暗号化・OSごとの差分・秘密情報管理をまとめて扱えることである。** why-use-chezmoi.mdの実践者証言(バイアス: ベンダーが選んだ好意的な声のみ)も、HNで独立に確認したnjtのコメントも、いずれも「symlinkがないから良い」ではなく「複数マシン間の差分管理と秘密情報管理が楽になったから良い」という理由付けをしている。

したがって設計判断としては次の線が妥当: **symlinkモードは「テンプレート化も暗号化もパーミッション調整も不要な、自分だけが編集するプレーンテキストのCLI設定」に限定して使う価値がある**(chezmoi自身のFAQの結論と一致)。一方、ドリフト対策として`chezmoi edit --watch`やコピー既定+`status`監視のどちらを選んでも、非対話・自動運用のドリフト検知は自分で組む必要がある、という限界は残る。

### 前例なしリスト

- dotfileマネージャ選択に関する学術的・定量的ベンチマークの前例: なし。
- symlinkモードを長期(数年単位)実運用した定量報告: なし(issueでの設計議論はあるが運用結果報告は未発見)。
- 「コピー方式 vs symlink方式」を同一ユーザーがA/B的に比較した記録: なし。
