# chezmoi 単独案の最強の論拠（steelman）— 公正な弱点つき

調査日: 2026-09-24。役割: chezmoi 単独案（chezmoi がファイル・テンプレート・シークレット・ロールを持ち、macOS では Homebrew、Arch/Omarchy では pacman を呼ぶ run スクリプトを実行。ランタイムは mise、Nix は使わない）の最強の擁護者として調べる。並行して Nix 側の steelman が別エージェントにより書かれており、最終判断はリード側が両方を突き合わせて行う。

既読（再調査しない、ただし枠組みの偏りは証拠で問い直す）: `2026-09-24-dotfiles-tool-choice.md`（A/B/C/D 9観点比較、結論はB/Cを支持）、`2026-09-24-role-based-dotfiles.md`（ロール抽象化の業界標準調査）、`2026-09-24-chezmoi-topic-and-dotfiles-rewrite.md`（日本語圏話題化・dotfiles bankruptcy語彙）。これら3本で既に直接取得済みの事実は再取得せず引用のみで使う。

## 方法・検証凡例

- `[直接]` — `curl`（`api.github.com`/`raw.githubusercontent.com` は `Authorization: Bearer $(gh auth token)`。`gh auth status` はキーチェーン再ログインエラーを出すが、このトークン自体は API 呼び出しに有効だった）または WebFetch がページ本文をそのまま返したもの。
- `[要約経由]` — WebFetch/WebSearch の要約（AIによる中間処理）を経由したもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの（403 等、本文中に明記）。
- 既出3記録からの引用は「(既出、再掲)」と明記する。

チャンネルの既知バイアス: vendor(chezmoi.io) は利点を強調し欠点を書かない構造（後述、実測済み）。個人ブログは生存者バイアス（うまくいった話が書かれやすい、乗り換えて後悔した話は書かれにくい）。issue tracker は逆に否定的な報告に偏る。

---

## 問い

macOS(Apple Silicon) + x86_64 Omarchy(Arch+Hyprland) の2機、CLI/LSPは両機、GUIはmacOSのみHomebrew cask、nvim/zsh/tmux/terminal/gitは毎日編集、外部TypeScript生成器が`~/.claude`等を書き出す、常駐サービス(LiteLLM Docker・ローカルHTTPサービス・keep-awake・将来llama-server)はlaunchd/systemd --user、シークレットは1Password CLI、ロールはリポジトリ外選択、install/updateは単一冪等コマンド、コンテナはNixリストから焼いたLinuxパッケージ集合を使っている(現状)。この形に対して「chezmoi単独（+Homebrew/pacman呼び出し+mise、Nixなし）」がどこまで成り立つか。

---

## chezmoi を選ぶ最も強い論拠

### 1. 採用規模・継続性（数値）

`https://api.github.com/repos/twpayne/chezmoi` `[直接]`（本セッションで再取得、既出記録の21,702から微増を確認）:

> stars: 21,703 / open_issues: 59 / forks: 689 / created_at: 2018-11-12T16:45:43Z / pushed_at: 2026-09-20T19:33:46Z

**作成から約8年、単一メンテナ(twpayne)体制のまま現役で、直近4日以内にpushされている。** open issue 59件はリポジトリ規模に対して少なく、放置されたバックログが積み上がっていない状態を示唆する(ただし issue の中身の質までは未検証、[unverified])。

### 2. 数年単位で使い続けている名前つき実践者が複数いる（生存者バイアスに留意しつつ）

- **Mike Kasberg**（mikekasberg.com）— 2021-05-12 の記事 `https://www.mikekasberg.com/blog/2021/05/12/my-dotfiles-story.html` `[直接]` で "chezmoi for more than a year now, across at least 3 computers simultaneously" と書き、Dropboxフォルダ→自作bash差分ツール（"pretty well for a couple years"）からの乗り換えを報告。同じ著者が2026-01-31の記事 `https://www.mikekasberg.com/blog/2026/01/31/dotfiles-secrets-in-chezmoi.html` `[直接]` でまだ chezmoi を使い続けている（後述の弱点でも引用）——**2021年から2026年まで、5年近く継続使用している一次資料が2本の日付付き記事として存在する。**
- **smasato**（Zenn, 2025-07-20、既出記録より再掲）: 「3年間使ってきて『chezmoiではできない』と思ったことは一度もありません」
- **bsag**（rousette.org.uk）— フッターの自己紹介で「bsag」として20年以上ウェブ上で活動と明記（`[要約経由]`）。この人物は Nix と chezmoi の両方を実際に使った直接比較の書き手でもある（後述「両方を使った人の声」）。

### 3. 複数OSテンプレーティングは vendor 一次機能、`.chezmoi.os`/`.chezmoi.hostname` は組み込み変数（既出記録 §1.3 で直接取得済み、再掲）

`https://chezmoi.io/user-guide/manage-machine-to-machine-differences/` `[直接]`（既出）:

> "`{{ if eq .chezmoi.os "darwin" -}}`... `{{ else if eq .chezmoi.os "linux" -}}`..."

同一バイナリ・同一リポジトリで Darwin/Linux/Windows を区別なく扱う設計。

### 4. 1Password統合は対話的`op`セッションでそのまま動く一次関数（既出記録 §1.2 で直接取得済み、再掲）

`https://www.chezmoi.io/reference/templates/1password-functions/onepasswordRead/` `[直接]`:

> "If there is no valid session in the environment, by default you will be interactively prompted to sign in."

所有者が既に使っている「対話的`op`ログイン」とそのまま一致する。

### 5. 単一冪等コマンドのブートストラップは vendor が公式に示し、実践者が実際にそのまま使っている

`jpoissonnet/dotfiles`（既出記録 §2.1、再掲）: "Only git, and chezmoi itself. Everything else is installed by `chezmoi apply`."

さらに今回新規に見つけた **`skenmy/dotfiles`** `https://raw.githubusercontent.com/skenmy/dotfiles/main/README.md` `[直接]`（`pushed_at: 2026-09-23T09:35:47Z`——本記録の前日、star 0だが極めて活発）は、この案件の形にほぼ完全一致する規模の実装:

> "Cross-platform dotfiles for **macOS, Linux, and Windows**, managed by chezmoi." / "One source of truth → applied identically to every MacBook, Windows PC, and Linux server I touch." / macOS/Linux: `sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply skenmy`

一行ブートストラップが `name`/`email`/`signingKey`/`headless`/`work` をプロンプトし、`run_once_*` スクリプトでパッケージインストールとOS別defaultsまで行う。

### 6. ロール選択はリポジトリ外のローカル未追跡ファイルに一度だけ焼く（既出記録 §1.3 で直接取得済み、再掲＋実例追加）

`promptBoolOnce` → `~/.config/chezmoi/chezmoi.toml`（既出）。`skenmy/dotfiles`の`.chezmoi.toml.tmpl`が`work`/`headless`フラグとして実装している実例が新規に確認できた（上記引用内）。

### 7. パッケージ管理は`run_onchange_`でbrew bundle/pacman双方の公式サンプルを持つ（既出記録 §1.3 で直接取得済み、再掲＋実例追加）

`skenmy/dotfiles`の "Brew auto-sync" 機構（新規、`[直接]`）: nightly launchd ジョブが `brew bundle dump` を実行し、`.chezmoitemplates/brew/`のフラグメントと差分を取って新規インストール分を**自動でリポジトリに追記・署名コミット・push**する——"Append-only by design. Local uninstalls do not remove from Brewfile (removal is intentional and should go via a PR)."。**「手元で入れたパッケージがリポジトリに反映され忘れる」という、Brewfile系ツール全般が抱える定番の片方向ドリフト問題に対する、実践者による具体的な自動化解**。

---

## chezmoi への正当な批判

### A. デフォルトのcopyモードはコピーであり、「編集した側」と「リポジトリ側」が構造的に分岐しうる（所有者の最大の懸念に直結）

chezmoi自身の日次操作ドキュメント `https://www.chezmoi.io/user-guide/daily-operations/` `[要約経由]` が示す対処法:

> "Edit a dotfile with: `chezmoi edit $FILENAME`" ... "To automatically run `chezmoi apply` when you quit your editor, run: `chezmoi edit --apply $FILENAME`" ... "To automatically run `chezmoi apply` whenever you save the file in your editor, run: `chezmoi edit --watch $FILENAME`"

直接ターゲットファイルを編集してしまった場合の回復コマンドは `chezmoi re-add`（WebSearch要約、複数ソース一致、`[要約経由]`）。`skenmy/dotfiles`は運用ルールとして明記している（新規、`[直接]`）:

> "**Never edit `~/.zshrc`, `~/.gitconfig`, etc. directly.** Edit in the source dir (or with `chezmoi edit`) — direct edits will be overwritten on next `chezmoi apply`."

**しかしこの規律は破られる、という一次証拠が実在する**: `stanfish06/my-configs` issue #140「Recurring drift between chezmoi-managed configs and top-level reference mirrors (4th occurrence)」`https://github.com/stanfish06/my-configs/issues/140` `[直接]`:

> ghostty/tmux設定の「参照ミラー」コピーとchezmoi管理下の実体が繰り返し乖離。**issue #74(2026-05-20)→#132(2026-07-17)→#136(2026-07-19)→#140(2026-07-20)と、わずか2ヶ月余りで4回同じ種類のドリフトが再発。** 原因は「Nothing enforces or even documents that these must stay in sync.」——chezmoi自体の機能不足ではなく「二重管理された構造」の問題だが、**chezmoiを使っていてもドリフトは自動的には防げない**ことを示す具体的な反復記録。

GitHub Discussion `https://github.com/twpayne/chezmoi/discussions/4420`「Using chezmoi "backwards"」`[要約経由]`も同種の訴え: アプリが自分で書き換える設定ファイル("Sometimes I edit settings within apps. That changes the dotfiles without Chezmoi knowing")をどう追従させるかという構造的な穴があり、提案された`chezmoi merge-all`は「open[s] ... an interactive window for every diff」で自動化に向かないと報告されている。

Wantedly（既出記録、再掲）の1年運用報告も同じ種類の失敗を名指し: 「変更を追加するのを忘れたり、意図せず`chezmoi apply`を実行しないままになってしまう」——CIでのテンプレ構文チェックのみが緩和策であり、**「編集した内容がリポジトリに戻っていない」という状態そのものを検知するCIは報告されていない**。

**評価**: `chezmoi edit`/`re-add`/`diff`/`status`という一式のコマンドは存在し、vendor一次機能として整っている。ただし「規律を破らない」ことを強制する仕組みは無く、症状の実例（4回のドリフト再発、apply忘れ）が複数の独立した一次資料から確認できる。**所有者の「コピーは編集されるとドリフトする」という懸念は、of a real, documented failure modeであり、杞憂ではない。**

### B. バージョン固定・ロールバック・宣言的サービス・コンテナ焼き込みという4点で、Nixが持つものをchezmoi単独は持たない

**バージョン固定（cross-OS）**: HomebrewにはNixのような lock file 機構が無い。`stout.neullabs.com`の一般論（chezmoi特有ではないが、chezmoi+Homebrewの組み合わせにそのまま当てはまる）`[直接]`:

> "'brew bundle' reads a 'Brewfile', but a Brewfile is a dependency declaration, not a lock. It says 'brew "openssl"' — it doesn't say which version."

**この不足は具体的なコスト事故として既に実例が存在する**: `laurigates/dotfiles` issue #418「ci: pin chezmoi version instead of installing latest via brew」`https://github.com/laurigates/dotfiles/issues/418` `[要約経由]`:

> "CI installs chezmoi at whatever version Homebrew currently ships." ... "A chezmoi release broke `main` without any change in this repo. chezmoi ≥2.72 started rejecting leading-slash patterns in `.chezmoiignore` as `invalid path`." **ビルドは2026-08-04〜08-18の約2週間、原因不明のまま壊れ続けた。**

これは「chezmoi自体は無傷」だが「Homebrew経由でバージョンを固定していなかった」ことによる実際の事故で、chezmoi単独運用でも起こりうる種類の失敗として計上すべき。対処法として同issueは「バージョンをCIで明示的に固定し、アップグレードはPRで意図的に行う」を採用しており、**mise([既出決定]所有者が既にランタイム管理に使っている)でchezmoi自体のバージョンも固定できる**（`laurigates/dotfiles` PR #449「pin chezmoi via .mise.toml」、`[要約経由]`タイトルのみ確認）——完全な代替にはならないが緩和策として実在する。

**ロールバック**: chezmoiに組み込みのロールバックコマンドは無い。vendor自身のフローが示す唯一の回復手段はgit（`https://www.chezmoi.io/user-guide/daily-operations/` 周辺、WebSearch要約が複数issue/discussionから一致して確認、`[要約経由]`）:

> git resetで以前のコミットに戻す（source directory側）。バックアップが無ければ最終手段として`rm ~/.local/share/chezmoi`。

対してNixのgenerationベースのロールバックはOS wikiが一次資料として明記している（`https://wiki.nixos.org/wiki/Nixos-rebuild` `[要約経由]`）: `nixos-rebuild switch --rollback`。**ただし2024年12月時点でnixos-rebuild自体も「1世代前より古いものへの直接切り替え」は未実装という制約付きの機能**(同ソース、要約経由)——Nix側も無条件の万能ロールバックではないが、chezmoiには対応する仕組みが一切無い、という非対称は事実として残る。

**宣言的サービス管理**: chezmoiには`launchd.agents`/`systemd.user.services`に相当する一次の宣言的オプションが無い(既出記録で確認済み、再掲なし)。実践では`run_onchange_`スクリプトでplist/unitファイルを配置し、`launchctl`/`systemctl --user`を呼ぶ間接パターンに頼る。**`skenmy/dotfiles`がこの間接パターンの最も具体的な実例**(新規、`[直接]`): macOSは`~/Library/LaunchAgents/com.skenmy.chezmoi-update.plist`、Linuxは`~/.config/systemd/user/chezmoi-update.{service,timer}`——両OSで別々のファイル形式・別々の有効化コマンド(`launchctl`暗黙ロード vs `systemctl --user enable --now`)を書く必要があり、Nixの`launchd.agents`/`systemd.user.services`のような同じNix構文で両OSに対称的に書ける宣言的レイヤーとは異なる。加えてLinuxサーバでは`loginctl enable-linger`という追加の一手間が明記されている("Without this, the user-level systemd timer... won't fire when you're logged out")。

**コンテナへのパッケージ集合の焼き込み**: chezmoiはDocker統合コマンドを持ち(`https://www.chezmoi.io/reference/commands/docker/`、要約経由で存在のみ確認)、`chezmoi init --apply`をコンテナ内で実行できる。また`justintimejlew/dotfiles`(要約経由のタイトルのみ)は"bare-metal and DevPod containers. One-command bootstrap: chezmoi init --apply"と自称している。**ただしこれらはいずれも「コンテナのOSに対応するパッケージマネージャ(apt/pacman/brew)をコンテナ内で個別に呼ぶ」方式であり、Nixのように「1つのpackagesリストからLinux専用のclosureを1回ビルドして複数のコンテナに配る」という所有者の現行パターン([既出決定]box-shape/tools-nix-list-box-subset)とは仕組みが異なる**。chezmoi側は「同じスクリプトが動く」ことは示せるが、「1つの評価済み成果物を配る」ことは示せない——この点は所有者の現行運用からの後退になりうる、と率直に言うべき。

### C. テンプレート言語・命名規則の学習コストと摩耗

`karlmdavis/dotfiles` issue #27（既出記録、再掲）: 「encoding attributes into filenames (`private_dot_`, `executable_`, `.tmpl`, `create_`, `modify_`, `run_once_after_`) makes the source tree hard to scan and every rename a two-step affair」。

テンプレート言語(Go text/template)についての具体的な批判は、今回の検索では公式ドキュメントの読みにくさへの言及(WebSearch要約、「the intended audience is Go programmers, not systems administrators」)止まりで、**Go text/templateそのものを名指しで「捨てた」一次資料は見つからなかった**——強い批判ではなく、中程度の学習コストという扱いが妥当。

### D. Nixから離脱してchezmoiに来た人自身が、Nixの弱点を具体的に名指ししている（次節で詳述）

---

## 両方を使った人の声

### bsag (rousette.org.uk) — NixからchezmoiへmacOSで撤退、Linux/NixOSでの評価とは切り分けている

`https://www.rousette.org.uk/archives/a-tour-around-chezmoi/` `[要約経由]`。著者はNixを実際に使った上でこう書く:

> "Nix is amazing, but I get the feeling that it is best used on Linux, and perhaps best used as NixOS" / "the operating system itself puts constraints on what Nix is able to control, and as macOS is not the key platform for development effort, some packages are broken for macOS" / "I found myself having to manage more and more bits of my command-line ecosystem outside of Nix, which rather defeated the purpose of it"

さらに実務上の非対称: **Nixのアンインストールは面倒だったが、chezmoiは軽量で容易に取り除ける**、という趣旨の記述がある(要約経由の言い換えのため直接引用はできないが、この記事の結論として明記)。chezmoi移行後の慣れについても: 「It took me a little while to get used to this way of doing things, but now it feels natural.」——学習コストはあったが乗り越えたと明記。

**この証言の価値と限界**: macOS固有のNixの弱さ(パッケージが壊れやすい、macOSがNixのメイン対象ではない)を実際に使った上で名指ししており、既出記録のBen Mezger("macOS presented obstacles with Nix")と**独立した2人目の一次資料**として、「macOSでのNix運用は本人たちが直接体験した壁にぶつかる」という主張を補強する。ただし著者はLinux/NixOSそのものは「amazing」と評価しており、「Nixが悪い」のではなく「macOSでのNixが悪い」という限定的な主張である点は明記しておく——この所有者の2機のうち1機はmacOSであり、直接関連する証言。

### Ben Mezger（既出記録、再掲のみ）

「Kept Chezmoi for application config, uses Nix for system management」「macOS presented obstacles with Nix」→「Homebrew manually installed」。**chezmoiとNixの両方を実際に併用した末の結論が、両者いずれか単独ではなくハイブリッドだった**、という事実は、"chezmoi単独"の主張に対しても中立ではなく留保をつける形で働く——Mezger自身はNixを完全に手放してはいない。

---

## 確認できなかったこと

- Go text/templateそのものを名指しで批判し離脱した一次資料——中程度の学習コストへの言及はあったが、「テンプレート言語が理由でchezmoiをやめた」という一次資料は見つからなかった。
- `chezmoi ≥2.72`の`.chezmoiignore`破壊的変更(laurigates issue #418)がリリースノートでどう告知されていたか(意図的な破壊的変更だったのか、無警告だったのか)——issue本文からは判別できなかった。
- Nixの`nixos-rebuild --rollback`がmacOS(nix-darwin)側でも同等に機能するか——今回取得したのはNixOS wiki記事のみで、darwin-rebuild固有の挙動は未確認。
- `justintimejlew/dotfiles`のDevPodコンテナ運用の実際の失敗談・運用年数——README/タイトルの要約のみで、本文を直接取得できていない。
- 「chezmoiを数年使った末に、性能やスクリプトの肥大化(`run_`スクリプト散乱)を理由に離脱した」という一次資料——検索した範囲では見つからず、前例なしとして扱う。
- Brewfile.lock.jsonを`.chezmoiignore`に載せてバージョンを擬似固定する具体的な実装例の一次ページ——WebSearchの要約でパターンの存在は確認できたが、実装コードを直接取得したリポジトリは特定できなかった。

---

## 結論（率直に）

**chezmoi単独案は、この所有者の形に対して「動く」という点では強い実例に裏付けられている。** 採用規模(21,703★、8年、直近4日以内にpush)、複数の3〜5年級の実践者一次資料、そして`skenmy/dotfiles`という本記録の前日にpushされた、macOS+Linux+Windowsを1リポジトリ・1コマンドで統一し、launchd/systemdの常駐サービス・Homebrew自動同期・1Password系シークレット・ロールプロンプトのすべてを実装している具体例が、**この案件とほぼ同じ形をすでに動かして見せている。** これは「理屈の上で可能」ではなく「実在する運用」という強さを持つ。

**同時に、所有者本人の最大の懸念(コピーが編集されるとドリフトする)は、of a real, evidence-backed failure modeであって、杞憂ではない。** `chezmoi edit`/`re-add`/`diff`/`status`という道具は揃っているが、それを使い続ける規律を強制する機構は無く、`stanfish06/my-configs`のリポジトリでは2ヶ月足らずで同種のドリフトが4回再発したという記録が実在する。Wantedlyの「apply忘れ」報告も独立に同じ症状を裏付けている。**chezmoiを選べば「ドリフトが起きなくなる」わけではなく、「ドリフトを検知して戻すための道具が一式揃う」だけ**、というのが証拠が支持する範囲。

**Nixと比べて明確に失うものが4つあり、いずれも具体的な事故・非対称で裏付けられる**: (1) OS間のバージョン固定はHomebrewに一次機構が無く、`laurigates/dotfiles`では実際に2週間のCI破損という数値付きの事故が起きている。(2) ロールバックはchezmoiに組み込みが無く、gitへの手動依存になる——対してNixのgeneration機構はvendor一次資料で確認できる実在の非対称的優位(ただし無条件の万能機能ではない)。(3) 宣言的サービス管理は間接パターン(plist/unitファイルを手で書き、launchctl/systemctlを個別に叩く)に留まり、`skenmy/dotfiles`が示す通りOSごとに構文も有効化コマンドも異なる。(4) コンテナへのパッケージ集合の焼き込みは、chezmoiではコンテナ内で個別にOSのパッケージマネージャを呼ぶ方式にとどまり、所有者が現行運用している「Nixリストから評価済みclosureを配る」方式の代替にはならない。

**両方を使った人の声は、"chezmoi一本"を単純に支持しない。** bsag は Nix と chezmoi の両方を使った末に macOS では chezmoi へ、しかし Linux/NixOS 自体は「amazing」と評価したままであり、Nix全否定ではなく「macOSでのNix」への限定的な撤退である。Ben Mezger は逆方向の遍歴を経て、最終的にはNixとchezmoiの併用に落ち着いた——**「実際に両方使った人」の証言は、どちらも「単独ツールで完全に足りた」とは言っていない。**

**平易に言うと**: chezmoiだけでこの形を動かすことは、他の誰かが既に、ほぼ同じ形で、しかもつい最近まで運用しているという点で、机上の空論ではない。ただし「コピーのドリフト」「バージョン固定」「ロールバック」「宣言的サービス」の4点は、chezmoiが自前では持たない・または間接的にしか持たない性質であり、これらを補う具体的な仕組み(CI parity check、mise経由のchezmoi自体のバージョン固定、launchd/systemd個別実装)を自分で用意する前提でなければ、Nixが標準で持つ保証と同等にはならない。
