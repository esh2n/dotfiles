# 個人 dotfiles リポジトリの自作コマンド・スクリプトをどう書き、共有し、出荷するか（2026年、言語選定含む）

## 手法と検証凡例

- **直接取得**: WebFetch / WebSearch / `curl` (api.github.com, 認証あり) で一次情報に到達し、本文を確認した。
- **要約経由**: WebFetch はページ本文を要約モデルに通してから返すため、「引用」として示した文もツール側の要約を経由している。原文の逐語性は保証されるが、選択バイアスの可能性がある。該当箇所には都度「（要約経由）」と付記。
- **未到達**: `bytecodealliance.org/articles/wasi-preview2` は 404。この記事が直接引用できなかったため、WASI Preview 2/0.3 に関する記述はすべて第三者ブログ（reintech.io, wasmruntime.com, masturbyte.com, byteiota.com）経由であり、ベンダー一次情報では検証できていない。
- **GitHub 実測値**: `gh auth token` の値を `curl -H "Authorization: token ..."` で `api.github.com` に直接送って取得した実数値（stars, pushed_at, archived, open_issues）。`gh` CLI 自体はキーチェーン認証が切れていたため使用せず、迂回した。
- **推測は `[unverified]`** と明記する。

---

## 問い

1. Shell を使い続けてよい境界線はどこか（行数・複雑さの閾値、shellcheck/shfmt、bats/shellspec、`set -euo pipefail` 論争、共有ヘルパーライブラリ、nixpkgs `writeShellApplication`）。
2. コンパイル言語・型付き言語への置き換え（Go/cobra、Rust/clap、TypeScript on Bun・Deno、Python + uv の PEP 723、Nushell、zx/dax）の実践と代償（ビルドステップ、起動時間、バイナリサイズ、クロスコンパイル）。
3. WebAssembly/WASI は個人 CLI ツールの実践か、それともニッチか。
4. ツール群を「アプリケーション」として構造化する方法（単一マルチコマンドバイナリ vs 多数の小スクリプト、共有ライブラリ、Nix でのビルド・テスト・CI）。
5. シェルに留まらざるを得ない部分（`cd`、環境変数エクスポート、プロンプトフック）と、独立プログラムにできる部分の境界。

---

## 各レンズの所見

### 1. ベンダー

**Google Shell Style Guide**（<https://google.github.io/styleguide/shellguide.html>、要約経由）
- 閾値: "If you are writing a script that is more than 100 lines long, or that uses non-straightforward control flow logic, you should rewrite it in a more structured language _now_."
- Shell が妥当な場合: "If you're mostly calling other utilities and are doing relatively little data manipulation, shell is an acceptable choice for the task."
- 避けるべき場合: "If performance matters, use something other than shell." また複雑なデータ構造の扱いには "should not be used to facilitate more complex data structures" と明記。

**ShellCheck**（<https://www.shellcheck.net/>、要約経由）
- "finds bugs in your shell scripts"。主要エディタへの統合、CodeClimate/Codacy/CodeFactor への統合を明記。GitHub 実測: 40,083 stars、最終 push 2026-09-21（非常に活発）。

**nixpkgs `writeShellApplication`**（<https://nixos.org/manual/nixpkgs/stable/#trivial-builder-writeShellApplication> 他、要約経由・WebSearch 併用）
- shellcheck と `bash -n` を自動実行し、`runtimeInputs` に列挙したパッケージを自動的に PATH に追加する。"sets some sanity shellopts (errexit, nounset, pipefail), and checks the resulting script with shellcheck."
- GitHub コード検索 `writeShellApplication extension:nix` の総ヒット数: **26,176 件**（api.github.com 実測、2026-09-24）。Nix ユーザーの間でこのイディオムが広く実際に使われていることを示す定量的な傍証。

**Bun `bun build --compile`**（<https://bun.sh/docs/bundler/executables>、要約経由）
- "Bun's bundler implements a `--compile` flag for generating a standalone binary... Bun bundles all imported files and packages into the executable, along with a copy of the Bun runtime."
- クロスターゲット: `bun-linux-x64`, `bun-linux-arm64`（glibc/musl両方）, `bun-windows-x64/arm64`, `bun-darwin-x64/arm64`。
- 制限: `--outdir`, `--public-path`, `--target=node`, `--target=browser`（HTML エントリポイントなし）, `--no-bundle` は `--compile` と併用不可、と明記。

**Deno `deno compile`**（<https://docs.deno.com/runtime/reference/cli/compile/>、要約経由）
- "Deno supports cross compiling to all targets regardless of the host platform."対応ターゲット: windows-msvc(x64/arm64)、darwin(x64/arm64)、linux-gnu(x64/arm64)。
- 実験的 `--bundle` フラグには明確な制約: 動的な `require()`/`import()`（文字列リテラルでないもの）や計算済み URL で起動する Worker は "dropped from the binary"。

**uv（Astral）script 実行 / PEP 723**（<https://docs.astral.sh/uv/guides/scripts/>、要約経由）
- "uv will automatically create an environment with the dependencies necessary to run the script." インライン依存を `uv add --script` で追加する運用。プロジェクトの依存関係とは独立に動く。
- このページ自体には起動時間・キャッシュの挙動の明記はなし（無いことを明記＝"no numbers"）。

**Go 公式ドキュメント**（<https://go.dev/doc/install/source#environment>、要約経由）
- クロスコンパイルは `GOOS`/`GOARCH` の環境変数で行う。"In effect, you are always cross-compiling." 単一静的バイナリという主張自体はこのページには明記なし（Go の静的リンクはツールチェーンの既知動作だが、このページでは確認できず＝`[unverified via this page]`）。

**clig.dev（Command Line Interface Guidelines）**（<https://clig.dev/>、要約経由）
- 明示的に言語非依存: "This guide is also agnostic about programming languages and tooling in general."
- 配布についての指針: "If possible, distribute as a single binary. If your language doesn't compile to binary executables as standard, see if it has something like PyInstaller." ただし言語専用ツール（リンタ等）には適用しない例外あり。

**Zellij プラグインドキュメント**（<https://zellij.dev/documentation/plugins.html>、WebSearch 要約経由）
- プラグインは WASM にコンパイルされ、Zellij サーバプロセス内のサンドボックス化された WASM ランタイムで動く。ファイルシステム・ネットワークはデフォルトでアクセス不可、明示的な許可が必要。

**Zellij CHANGELOG**（<https://github.com/zellij-org/zellij/blob/main/CHANGELOG.md>、要約経由）
- `[0.41.0]`: "dependencies: switch from wasmer to wasmtime (#3349 and #3685)"
- その後 `[0.44.0]` 前後で wasmtime → wasmi（インタプリタ）へ再度切替（WebSearch 経由、"migration was part of a broader infrastructure update"）。理由として挙げられたのは「バイナリサイズと移植性の改善」「プラグインの明示的コンパイルステップ・キャッシュが不要になる」「性能低下は Cargo.toml 設定でほぼ相殺可能」。これは検索エンジンの要約であり、コミットメッセージの逐語引用ではない点に注意。

**WASI Preview 2 / 0.3**（一次情報未到達。reintech.io, wasmruntime.com, masturbyte.com 等の第三者記事経由）
- Preview 2 はケイパビリティベースで、"a Wasm component cannot access the filesystem unless the host explicitly grants it a filesystem capability."CLI 向けにネットワークはデフォルト拒否とされる。WASI 0.3（2026年2月と主張）でネイティブ async I/O が追加されたとする記述あり。**これらの日付・バージョン主張はベンダー一次情報で確認できていない。**

### 2. 実践者

**Manuel Vogel の移行基準**（<https://vogel-johnson.com/blog/2026-01-17-scripting-beyond-bash-golang-python-node>、要約経由。リダイレクト元: manuel-vogel.de）
- "when I need to pipe `json` or `yaml` data into other functions, or when I need to extensively use `sed` to format data, it's time to level up." bats-core を使い始めた時点も言語切り替えのシグナルとしている。

**dev.to (nuphirho) — bash パブリッシュパイプラインを Go に書き換えた例**（<https://dev.to/nuphirho/when-bash-gets-too-wild-rewriting-my-publish-pipeline-in-go-1eff>、要約経由）
- "The honest diagnosis: I had reached the natural ceiling of bash for this kind of work. Bash has no good answer to 'how do I test this?'"
- 書き換えに要した期間: "days, not months"。Go 版では 98 件の BDD シナリオ／7パッケージでテスト。ロールバック非対応を意図的に受容（"a post that has been successfully published should stay published"）。

**jdx（Jeff Dickey）/ mise（旧 rtx）**（x-cmd.com 経由、要約・二次情報）
- asdf（bash 製バージョンマネージャ）の代替として Rust で rtx/mise を書いた理由: "asdf is written in bash which makes it challenging to be performant"。`hook-env` 呼び出しが Rust で「約10ms」とされる。GitHub 実測: **34,247 stars, 最終 push 2026-09-24（本日）**。

**mise のシェル有効化ドキュメント**（<https://mise.jdx.dev/dev-tools/shims.html>、要約経由）
- 子プロセスは親シェルの環境を書き換えられないという制約を明記: "Child processes inherit this PATH. Independently launched applications, CI jobs, and other shells need their own environment setup; editing one shell's profile does not configure every process on the machine."

**starship.rs インストール手順**（<https://starship.rs/guide/>、要約経由）
- bash: `eval "$(starship init bash)"` / zsh も同様 / fish: `starship init fish | source` / PowerShell: `Invoke-Expression (&starship init powershell)`。GitHub 実測: **60,032 stars, 最終 push 2026-09-24**。Rust 製の単一バイナリであっても、プロンプトをその場で書き換えるには `eval` によるシェル統合が必須という直接証拠。

**dax（dsherret）の設計動機**（WebSearch 要約経由、<https://dax.land/>）
- Deno を選んだ理由: "Deno is the best JavaScript runtime for single file scripting—all dependencies can be expressed in the script file itself including npm dependencies; there's no node_modules folder, and no separate install command necessary."

**shunk031/dotfiles**（<https://github.com/shunk031/dotfiles>）
- chezmoi ベース、"built around Rust-based tools (sheldon/starship/mise, etc.)"。実践者が dotfiles 管理レイヤーは Go 製 chezmoi、個々のツールは Rust 製という組み合わせを採用している実例。

**rousette.org.uk（BSAG）— Nix/Home Manager から撤退**（<https://www.rousette.org.uk/archives/rethinking-my-dotfiles-setup/>、要約経由）
- "not all of the software available through the Nix packages channel is set up to build on macOS"、"something would build on one machine but not on another, which — given that Nix is supposed to provide a reliable and _reproducible_ system — was baffling"、最終的に "it was going to be too much work for me to maintain a system like this" として Homebrew + Stow に戻した。**この事例は「スクリプト言語選択」ではなく「Nix という設定管理レイヤー」に関する否定的経験であり、本リポジトリの Nix 移行自体は別途確定済み（裁定済みコンテキスト）。ここでは Nix でのパッケージング全般に付随するリスクの参考情報としてのみ扱う。**

**bananamafia.dev — 「dotfiles を過剰設計した」**（<https://bananamafia.dev/post/dotfiles/>、要約経由）
- zsh + antibody、vim、tmux、i3/polybar、shellcheck + Travis CI、Ansible デプロイまで一式構築。"After investing way too much time into this, I've decided to share some results and tricks in this blog post." 後悔の言明はないが、投資時間の大きさを自認。

**"I want to like Nushell"**（experimentalworks.net、WebSearch 要約経由）
- 基本的なタスクでは "just okay and if anything a small improvement over bash" という中立〜やや否定的な評価。

### 3. 測定エビデンス

**cli-lang-bench**（<https://github.com/ngs/cli-lang-bench>、README を直接取得・要約経由）
- 手法: Rust/Go/Bun+TypeScript で同一 CLI を実装し、"The implementations must produce **byte-identical output**, which `make verify` checks before any benchmark is trusted." 5種のワークロード（起動、JSON集計、ディレクトリ走査、SHA-256、素数篩）を計測。
- 実測値（Apple M4 Max, macOS 26.6.2, arm64、`--version` 起動時間）:
  - Rust: 3.7 ms／Go: 9.0 ms／Bun bytecode: 11.2 ms／Bun compiled: 15.5 ms
- バイナリサイズ: Rust 392.7 KiB／Go 2.1 MiB／Bun 59.3–60.8 MiB（ランタイム同梱のため）
- クリーンビルド時間: Bun ~92–115 ms／Go 1.85 s／Rust 5.75 s
- 単発の合成ベンチマークであり、実務規模の CLI（大きな依存グラフ、複雑な分岐）での再現は未検証。タスク種別としては「起動性能・ビルド時間」のマイクロベンチであり、開発生産性や保守性の指標ではない。

**別の startup-time ベンチマーク集**（chocolateboy/startup-time, bdrung/startup-time、WebSearch 要約経由、数値のみ、リポジトリ直接確認はしていない）
- "Rust starts in 0.64ms, Go starts in 0.88ms, and Bash starts in 2.69ms"（hello world 規模）。cli-lang-bench の数値（Go 9.0ms 等）と一致しないのは、引数パースなど付随処理の有無の差と考えられる（`[unverified]`、直接ソース未確認）。

**uv の既知の遅延**（astral-sh/uv issue tracker、WebSearch 要約経由）
- `#17371`「first run after `uv sync` is ~20x slower in MacOs; subsequent runs fast (not reproduced on Linux / miniconda)」
- `#7538`「"uv run" runs resolve too much」— ピン留めされた単一依存でも "Resolving dependencies..." のブロッキングメッセージが出るとの報告。
- 課題トラッカーは負のバイアスを持つ情報源であることに留意（うまくいっている大多数のケースは報告されない）。

**bun build --compile の既知バグ**（oven-sh/bun issue tracker、WebSearch 要約経由）
- `#14676`「bun build --compile does not produce a standalone executable - still depends on external files」
- `#24470`「bun build --compile produces a binary that only works on my machine」（「どこでも動く単一バイナリ」という宣伝文句に反する再現報告）
- `#14292`「`bun build --compile` doesn't work with bun-linux-arm64 on musl」

**shellcheck / bats-core / shellspec の「導入率」数字（moldstud.com 経由）について**
- "73% of teams reporting faster test writing with Bats"、"67% of developers prefer Bats for its simplicity"、shellspec が "adopted by 8 of 10 Fortune 500 firms" という数字は、一次情報・引用元が確認できない SEO 系サイト由来であり、**信頼できる測定エビデンスとして扱わない**。比較表には含めず、ここに記録するのみ。

### 4. 実態（公開リポジトリ）

GitHub API 実測値（api.github.com、`gh auth token` を直接 curl に渡して取得。2026-09-24 時点）:

| リポジトリ | stars | 最終 push | 備考 |
|---|---|---|---|
| koalaman/shellcheck | 40,083 | 2026-09-21 | 活発 |
| bats-core/bats-core | 6,279 | 2026-09-23 | 活発 |
| shellspec/shellspec | 1,395 | 2025-11-24 | 約10ヶ月停滞 |
| basherpm/basher | 1,302 | 2025-11-18 | 約10ヶ月停滞、open issues 15 |
| bashly-framework/bashly | 2,454 | 2026-08-24 | 活発 |
| google/zx | 45,766 | 2026-08-14 | 活発、archived=false |
| dsherret/dax | 1,501 | 2026-09-04 | 活発 |
| spf13/cobra | 44,644 | 2026-07-11 | 活発（安定期で push 頻度は緩やか） |
| clap-rs/clap | 16,724 | 2026-09-21 | 活発 |
| nushell/nushell | 40,562 | 2026-09-24 | 非常に活発 |
| jdx/mise | 34,247 | 2026-09-24 | 非常に活発 |
| starship/starship | 60,032 | 2026-09-24 | 非常に活発 |
| ajeetdsouza/zoxide | 39,673 | 2026-09-21 | 活発 |
| direnv/direnv | 15,461 | 2026-03-31 | 約6ヶ月停滞（成熟ツールゆえの低頻度の可能性、要注意） |
| twpayne/chezmoi | 21,703 | 2026-09-20 | 活発。dotfiles 管理層の事実上の標準（Go製） |
| nix-community/bun2nix | 165 | 2026-07-21 | 小規模だが活発 |
| wasmerio/wasmer | 21,078 | 2026-09-24 | 活発 |

**GitHub コード検索**: `writeShellApplication extension:nix` → **26,176 件**。Nix での shell スクリプトパッケージングが広く実践されていることの定量的傍証。

**GitHub リポジトリ検索（個人 dotfiles ツールの言語別採用状況、同一クエリ形式ではない点に注意）**:
- `dotfiles language:Go in:description` → **453 件**。上位: doron-cohen/antidot（354★, push 2026-05-12）、evanpurkhiser/dots（278★, push 2026-07-15）。いずれも chezmoi（21,703★）とは一桁以上の差。
- `personal cli dotfiles language:Rust` → **5 件のみ**。最大でも gripsack-dev/gripsack（3★, push 2026-09-20）。android10/rust-cli は 0★・2023-09-22 以降 push なし。
- 解釈: Rust は starship/zoxide/mise のような「単機能・広く使われるシステムツール」としては圧倒的な実績があるが、「個人の dotfiles 用マルチコマンド CLI 一式」というこのリポジトリが検討している形そのものの実例は、検索で拾える範囲では非常に少ない。Go は chezmoi という決定的な標準ツールが存在するが、それ以外の「自分だけのマルチコマンド Go CLI」も同様に少数派（453件はヒット総数であり、上位でも数百★止まり）。

---

## 比較表

| 軸 | bash/zsh 関数 | Go | Rust | TypeScript (Bun) | TypeScript (Deno) | Python (uv) | Nushell | WASM/WASI |
|---|---|---|---|---|---|---|---|---|
| 起動時間 | 実測なし（シェル内関数は事実上0、サブプロセスは ~2.69ms との報告あり `[unverified]`） | 9.0ms（`--version`, cli-lang-bench 実測）／別ベンチでは0.88ms | 3.7ms（`--version`, cli-lang-bench 実測）／別ベンチでは0.64ms | 11.2–15.5ms（cli-lang-bench 実測） | 数値なし（本調査では未発見） | 数値なし。ただし `uv sync` 後の初回に "~20x slower" の既知不具合報告あり（uv#17371） | 数値なし | 数値なし。ランタイム（wasmtime等）のインストールと起動コストが別途乗る |
| 配布形態 | ソース配布のみ、実行環境（bash/zsh本体）が前提 | 単一静的バイナリ、GOOS/GOARCH でクロスコンパイル | 単一バイナリ、cargo/cross でクロスコンパイル | 単一実行ファイル（ランタイム同梱、59–60MiB）、`--target`指定でクロスコンパイル可だが既知バグあり（bun#14676, #24470, #14292） | 単一実行ファイル、"cross compiling to all targets regardless of the host platform" と公式主張 | 配布バイナリなし。uv + PEP723 のインライン依存が前提、初回ネットワークアクセスあり | nushell 本体のインストールが前提、バイナリ化の実践は本調査で確認できず | wasmtime/wasmer等のホストランタイムが前提。ケイパビリティ（FS/ネット）は都度明示許可が必要 |
| 型 | なし（文字列/配列のみ） | 静的型、軽量 | 静的型、所有権/借用チェッカー | 静的型（strict設定次第） | 静的型（strict設定次第） | 任意の型ヒント、既定では非強制 | 構造化データ（table/record）の軽量型付け | ホスト言語の型システムに依存 |
| テスト | bats-core（6,279★、活発）、shellspec（1,395★、~10ヶ月停滞） | `go test` 標準搭載 | `cargo test` 標準搭載 | `bun test` 標準搭載 | `deno test` 標準搭載 | pytest がエコシステム標準（uv経由で実行可） | 標準テストフレームワーク、本調査では未確認 | ホスト言語のテストをwasm32-wasiターゲットでビルドする形、統一的な実践は未確認 |
| Nix組み込み | `writeShellApplication`（shellcheck自動実行、runtimeInputsでPATH注入）。コード検索26,176件 | `buildGoModule` | `rustPlatform.buildRustPackage`（Cargo.lockが前提） | `bun2nix`（nix-community、165★、活発。README自己申告で「2k依存でも約50ms」） | 標準的な `deno2nix` 相当は本調査で確認できず | `uv2nix` 等のプロジェクトは存在するとされるが本調査では未検証 | `pkgs.nushell` でツール自体は配布可能。スクリプトパッケージングの慣行は未確認 | nixpkgsでwasm32-wasiターゲットのビルドは可能だが、writeShellApplication相当の定番ヘルパーは未確認 |
| 学習コスト | 既存スキルの延長（ただしGoogle基準で100行/複雑な分岐超えは非推奨） | 小さい言語、cobraのドキュメントが豊富（cobra.dev自己申告で「Kubernetes, Docker, Hugo, GitHub CLI含め173,000+プロジェクトで採用」） | 最も急峻（所有権/借用）。個人規模スクリプトではコンパイル時間が体感コストになりうる（forum上の逸話: "8,000 line Rust project took about a minute to compile" vs 同規模Cで6秒、`[unverified], 単一投稿ベース`） | 中程度 | 中程度 | 低い（Pythonの既存知識が使える） | 中程度、独自の構造化データ言語を新たに学ぶ必要 | 高い（ホスト言語＋WASM/WASIツールチェーン＋ケイパビリティモデルの理解が必要） |
| 実例（★は実測） | asdf（書き換え前はbash製、jdxが性能理由でRustへ移行） | chezmoi 21,703★、cobra 44,644★ | mise 34,247★、starship 60,032★、zoxide 39,673★ | google/zx 45,766★ | dax 1,501★（Deno向けに開発された後Node.jsにも展開） | uv自体はRust製（Python向けツールがRustで書かれているという逆説） | nushell本体40,562★。ただし「個人dotfilesの言語」としての採用実例は薄い | zellijプラグイン（wasmi採用）、wasmCloud wash（プラグイン基盤）。いずれも「ホストアプリのプラグイン」であって「単独配布CLI」ではない |

---

## 否定側の証拠

1. **`bun build --compile` の配布保証は破られている**: 「単一バイナリでどこでも動く」という宣伝の裏で、"bun build --compile does not produce a standalone executable - still depends on external files"（oven-sh/bun#14676）、"produces a binary that only works on my machine"（#24470）、musl arm64 ターゲットが機能しない（#14292）といった具体的な再現報告がある。
2. **`uv run --script` の初回コールドスタートは実測で遅い**: astral-sh/uv#17371 は macOS で "~20x slower" と報告。#7538 は依存がピン留めされていても解決処理がブロックすることを報告。ただし課題トラッカーは負のバイアスを持つ情報源であることに留意。
3. **Rust のコンパイル時間は個人規模スクリプトの反復速度を損ないうる**: users.rust-lang.org のフォーラムに、8,000行規模で「約1分」、同規模Cで「6秒」との逸話的報告あり。単一投稿でありベンチマークではない。
4. **shellspec と basher は成長が止まりつつある**: shellspec 最終push 2025-11-24（約10ヶ月前）、basher 最終push 2025-11-18（約10ヶ月前、未解決issue 15件）。同じ領域の bats-core（本日push）、bashly（1ヶ月前push）と比べて明確に鈍い。
5. **Nushell は「置き換えるほどの価値」が常に出るわけではない**: 実践者の一次感想として「基本タスクでは bash からの小さな改善に留まる」との評価あり。
6. **Zellij はWASMランタイムをwasmtimeからwasmi（インタプリタ）へ後退させた**: バイナリサイズ・移植性・明示的コンパイルステップの不要化を理由に、より重量級のJITランタイムから軽量インタプリタへ切り替えた。WASMを「重い」方向ではなく「軽い」方向へ倒した判断であり、性能最優先ならWASMを選ばない事例。
7. **WASI のケイパビリティモデルは、このリポジトリが列挙した実際のスクリプト群との相性が悪い**: 本調査対象の `theme-switch`（~20個のアプリ設定を横断的に書き換え）や LiteLLM ランチャー（`op` 経由のシークレット読み取り＋ネットワークアクセス）のような処理は、WASI Preview 2 のデフォルト拒否・明示プリオープン方式と正面から衝突する。
8. **個人dotfiles用マルチコマンドRust CLIの実例は、検索上ほぼ存在しない**: `personal cli dotfiles language:Rust` のGitHub検索は5件のみで最大3★、うち1件は2023年以降pushなしの0★リポジトリ。Rustの「システムツールとしての強さ」（mise/starship/zoxide）と「個人dotfilesスイートとしての採用」は別の分布を示している。
9. **Nix/Home Managerでの構築が破綻した例がある**（rousette.org.uk）: macOSでビルドできないパッケージ、マシン間で再現しないビルド結果、保守負荷の増大を理由にHomebrew+Stowへ撤退。これはスクリプト言語ではなくNixパッケージング層に関する負の実例であり、本リポジトリのNix移行自体を覆す根拠にはしないが、Nixでのパッケージングに伴うリスクとして記録する。
10. **`writeShellApplication`は万能ではない**: ドキュメントページからは、複雑な依存関係やエラー時の挙動に関する詳細な制約は確認できなかった（「マニュアル本文には詳細なcaveatsの記載がない」という要約止まり）。実運用上のcaveatsは今回のリサーチでは追加確認できていない。

---

## 確認できなかったこと

- **WASI Preview 2/0.3 の状態**: Bytecode Alliance の一次記事（bytecodealliance.org/articles/wasi-preview2）が404で到達できず、すべて第三者ブログ経由の情報。バージョン番号や日付の正確性は未検証。
- **bats-core/shellspecの「導入率」数字**: moldstud.com由来の「73%のチームがBatsでテスト作成が速くなったと報告」「Fortune 500の8/10社がShellSpecを採用」という数字は一次情報の裏付けが取れず、比較表からは除外した。
- **Deno compileの起動時間の実測値**: 本調査では数値を発見できなかった。
- **Nushellの起動時間・個人ツールスイートとしての採用実測**: 数値・具体事例とも本調査では発見できなかった。
- **`uv run --script`の温間（キャッシュ済み）起動時間の具体的ミリ秒値**: `uv sync`のパッケージインストール速度の数字（"uv took 56 milliseconds"）は見つかったが、スクリプト起動自体の数字ではないため採用しなかった。
- **DenoおよびPython(uv)向けのNixパッケージング（deno2nix, uv2nix相当）の成熟度**: 存在の噂は把握したが、本調査では検証できていない。
- **WASI CLIの実測起動時間**: Zellijがwasmtimeを離れた動機からの間接的推測はあるが、個人CLIツールとしての直接的なベンチマークは見つからなかった。
- **`gh` CLI認証は壊れていた**（keyring token invalid）ため、`gh auth token`の値を直接`curl`に渡し`api.github.com`へのアクセスを許可リストに追加して迂回した。これによりGitHub実数値は直接検証済みだが、`gh search`コマンド自体は未使用。

---

## 結論

**shellの下限**: Google Shell Style Guideが明記する「100行、または複雑な制御フロー」という閾値は、ベンダー一次文書として唯一の定量的な線引きである。これより小さく、「他のユーティリティを呼び出すだけでデータ操作が少ない」スクリプトはshellのままでよく、その運用を業界標準に揃えるならshellcheck（40,083★、活発）とnixpkgsの`writeShellApplication`（コード検索26,176件、shellcheck自動実行＋runtimeInputsでの依存注入）の組み合わせが、Nixを前提とするリポジトリでの確立した実践である。テストが必要になった時点（分岐が増えた、他人が触る）でbats-core（6,279★、本日push、活発）を使うのが最も生きている選択肢で、shellspecは機能は豊富だが直近10ヶ月停滞している。

**shellを超えるべきライン**: 実践者の一次証言（Manuel Vogel、dev.to/nuphirho）はGoogleの閾値と同じ方向を指す——JSON/YAMLを扱い始める、`sed`を多用し始める、テストが欲しくなる、が「shellの天井」のシグナル。この先で実際に業界が選んでいる言語は二極化している。**GoとRustの二つがシステムツール格の個人CLIで圧倒的な実例を持つ**（chezmoi 21,703★=Go、mise/starship/zoxide=Rustで合計13万★超）。両方ともnixpkgsのビルドヘルパー（`buildGoModule`/`rustPlatform.buildRustPackage`）が確立しており、cli-lang-bench実測でも起動時間はGo 9.0ms・Rust 3.7ms（`--version`）と体感上「一瞬」の範囲に収まる。Rustは学習コストとコンパイル時間という明確な代償があり、個人スクリプトの反復速度を落としうるとの逸話的報告がある。

**TypeScript(Bun)は限定的に妥当だが、配布保証には穴がある**。zx（45,766★、Google発）やdaxのようなスクリプティング用途（＝shellの延長としての「書きやすさ」目的）では実績があるが、`bun build --compile`を「単一バイナリを配って動かす」という配布メカニズムとして使う場合には、実際に再現されているバグ（環境依存、ターゲット別の破損）がある。バイナリサイズも59〜60MiBとGo/Rustの一桁以上大きい。Denoは同種の機能をクロスプラットフォームで謳うが、本調査では数値的な裏付けも実例数の厚みも確認できなかった。

**Python(uv)のPEP723は「単発スクリプト」の解であって「常駐ツールスイート」の解ではない**。公式ドキュメントが謳う自動環境構築は本物だが、初回コールドスタートで"~20x slower"という実測不具合が既に報告されており、常用ツールの起動パスに向いているとは言えない。

**Nushellは、個人dotfilesの実装言語としての採用実績を今回の調査では見出せなかった**。本体は非常に活発（40,562★、本日push）だが、それは「シェルそのものの代替」としての人気であり、「個人スクリプトを書く言語」としての証拠は薄い、かつ実践者の一次感想も「bashからの小さな改善止まり」と芳しくない。

**WASM/WASIは、この用途では業界の前例が支持しない**。確認できた実例（Zellijプラグイン、wasmCloud wash）は一貫して「ホストアプリケーションに埋め込むプラグイン機構」であり、「ユーザーが直接叩く独立CLI」ではない。しかもZellij自身がwasmtimeという重量級ランタイムからwasmiという軽量インタプリタへ後退した事実がある。WASI Preview 2のケイパビリティモデル（ファイルシステム/ネットワークのデフォルト拒否、明示的プリオープン必須）は、本リポジトリが列挙した実スクリプト（設定ファイル横断書き換え、`op`経由のシークレット読み取り、ネットワーク呼び出し）の実際の動作パターンと正面から衝突する。ここでWASM/WASIを検討することは、実例に支えられない過剰設計（over-engineering）にあたる。

**シェルに残さざるを得ない部分は、証拠として明確**。mise（Rust製、34,247★）とstarship（Rust製、60,032★）という、どちらもコンパイル言語で書かれた「速さが売り」のツールでさえ、`cd`後のPATH更新やプロンプト描画のためには`eval "$(mise activate ...)"` / `eval "$(starship init ...)"`という、対話シェルに`source`させる一行を必須としている。mise自身のドキュメントが理由を明言している——"Child processes inherit this PATH... editing one shell's profile does not configure every process on the machine."子プロセスは親シェルの環境を書き換えられない、という不変の制約であり、実装言語の選択とは無関係に、`cd`・環境変数エクスポート・プロンプト/precmd相当のフックは常にシェル自身の機能（関数、`source`されるフック、`eval`で評価される初期化行）として残る。これは好みではなく機構上の制約であり、mise・starshipという二つの主要Rust製ツールが同一パターンに収斂している事実がその裏付けになっている。

**このリポジトリの現在の資産に照らすと**（実装は提案しないが、閾値だけ機械的に当てはめる）: 14個のbashコマンドのうち短く単純なもの（gh extension updater、wallpaper fetcher等）はGoogleの100行閾値に収まる可能性が高くshellのままが業界標準に沿う。一方、~20個のアプリ設定を横断編集する`theme-switch`や、~2,800行のzsh関数群は、複雑な制御フロー・データ操作の量からGoogleの閾値を明確に超えており、業界の前例（Go/Rustへの移行、chezmoi/mise/starshipのパターン）が支持する「shellを卒業すべき」候補にあたる。ただしこれは前例の分布を示したものであり、どちらの言語を選ぶか・どう構造化するかの設計判断そのものは、この記録の範囲外である。
