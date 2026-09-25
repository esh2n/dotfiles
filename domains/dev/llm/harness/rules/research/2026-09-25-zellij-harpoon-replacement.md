---
question: "zellij 0.44.1(nixpkgs)でNacho114/harpoonが `focus_terminal_pane(pane.pane_info.id, true)` のコンパイルエラー(zellij-tile 0.44が3引数化)で機能しない — (1)Nacho114/harpoon自体の状態とフォークの追跡、(2)zellij 0.44対応の代替プラグイン、(3)zellij 0.44に同等機能が組み込まれたか"
date: 2026-09-25
verdict: "(1) Nacho114/harpoon本体(★208、フォーク10、オープンissue5)はzellij-tile `\"0.42.2\"` に2025-05-04以来ピン止めされたままで、`focus_terminal_pane(pane.pane_info.id, true)`(2引数)は現行mainブランチ・最新リリースv0.3.0(2026-02-21、harpoon.wasmダウンロード469件)双方で未修正。upstreamのissue/PR一覧を全件grepしても『0.44』『focus_terminal_pane』への言及は0件——誰も互換性破壊をメンテナに報告していない。10フォーク中、3引数化を実際に直したのは2件のみ(cartwmic/harpoon: 2026-07-10のコミットで`zellij-tile 0.44.3`+`focus_terminal_pane(id, true, false)`に修正、commitメッセージに『Matches the installed zellij runtime』と明記/gabber235/zellij-harpoon: 2026-06-29のコミットで`zellij-tile 0.44`+3引数化、機能追加も伴う独自リファクタ)——ただし両方とも★0・リリース0件で、公開されたwasm成果物は存在しない。最も活発なフォーク(beyondlex/harpoon、upstreamへ2件のPR提出中)はzellij-tile 0.42.2のまま未対応。(2) 代替候補を比較すると、harpoonの用途(pane bookmark+jump)に最も近く実利用実績もあるのは shihanng/zellij-pane-picker(★37、旧名yapp)——star/unstar・cycle・toggle機能を持ち、CI(github-actions bot)でビルドされたwasmを6リリース(v0.1.0〜v0.6.0)継続配布、最新v0.6.0のダウンロード数521。ただし**v0.6.0タグのCargo.tomlは`zellij-tile = \"0.42.2\"`のままで、mainブランチが`0.44.0`へ上げたコミット(2026-04-07)より10か月前のリリース**——公式配布wasmはharpoonと同じ古いクレートでビルドされている。それでも実践者報告(issue #71、『Zellij version: 0.44.0, Plugin version: v0.6.0 (latest)』)はプラグインが正常にロード・動作し、検索結果0件時のパニックという別の不具合にのみ遭遇しており、**旧クレートでビルドされたwasmがzellij 0.44ランタイム上でロード自体は失敗しない**ことを示す実地証拠になっている(推論の補強であり保証ではない[unverified])。もう一つの現実的候補 timonwong/zellij-palette(★12)は`zellij-tile = \"0.44.3\"`と課題の対象バージョンに完全一致し、4リリース(2026-05-14に集中発行、各4アセット)をCIビルドで配布、Find Pane機能でセッション/タブ/pane横断ジャンプをカバーするが、メンテナ自身がREADMEで『mostly AI slop』『expect rough edges』と明言する若く粗いプロジェクト。rvcas/room(★297、最大手だが用途はtab切替でありpane bookmarkではない)は`zellij-tile \"0.41\"`のまま更新されておらず、もし0.44向けに再ビルドすればharpoonと同じ3引数コンパイルエラーに直面する構造(room内の`focus_terminal_pane(pane_id, true)`呼び出しは未修正の2引数のまま)。Picalines/zellij-leap(★0、2026-09-13という最新プッシュ)は`zellij-tile = \"0.45.0\"`——zellij最新版(0.45.1、2026-08-28公開)向けであり、持ち主の0.44.1より新しいAPI要求のため互換性は未確認[unverified]。(3) zellij公式のbuilt-inプラグインエイリアス一覧(zellij.dev/documentation/plugin-aliases)は`tab-bar`/`status-bar`/`strider`(=`filepicker`のcwd版)/`compact-bar`/`session-manager`(=`welcome-screen`のフラグ版)の6種のみで、**pane単位のピッカー/ジャンプ機能はどのバージョンにも組み込まれていない**——0.44.0で追加された新session-manager UI(PR #4821、0.44.3でシングルスクリーン化)はセッション/新規作成/アタッチ/レジャレクトの統合のみでpaneレベルの扱いは無い。"
unverified:
  - "shihanng/zellij-pane-picker v0.6.0のwasm成果物(zellij-tile 0.42.2ビルド)がzellij 0.44.1(または0.44.3)ランタイム上で恒久的に安定動作することの直接検証——issue #71は『ロードして動く』ことの間接証拠だが、この持ち主の環境で実機確認はしていない"
  - "zellij 0.44.0で『infra: wasmtime→wasmiへのWASMランタイム移行』(#4449)が、旧zellij-tileクレートでビルドされたプラグインのホスト関数呼び出し(特に`focus_terminal_pane`の2引数版)を後方互換に扱っている技術的根拠——protobufフィールド追加による後方互換という推測はCHANGELOG/PRの記述からの推論であり、明示的な一次記述は見つからなかった"
  - "Picalines/zellij-leap(zellij-tile 0.45.0)がzellij 0.44.1ランタイム上で動作するか、または0.45必須で動かないか"
  - "timonwong/zellij-palette v0.2.2リリースの4アセットに`.wasm`ファイルが実際に含まれるか——WebFetchのレンダリングエラーで個別ファイル名を直接確認できなかった"
  - "cartwmic/harpoonとgabber235/zellij-harpoonの3引数修正コミットが実際にwasmとしてビルド・zellij 0.44上でロードまで検証されたかどうか——cartwmic側はコミットメッセージで『wasm build and harpoon-core tests green』と自己申告するのみで、CI設定自体が存在せず(.github/workflows 404)、独立検証ではない"
sources_note: "gh CLI認証が無効(keyring token invalid)だったため、GitHub REST API(api.github.com)をcurlで直接叩いた。非認証のためcore/search両レート制限にかかり、一部(zellij-palette releases詳細、zellij最新リリース、zellij-leap README、zellij plugin-aliases一覧)はWebFetch(要約経由、verbatim引用不可)で代替した。raw.githubusercontent.com経由でCargo.toml/main.rs/README.mdの原文を直接取得しgrepした箇所は一次情報として扱う。WebSearchはセッション予算超過のため今回は使用できなかった(実践者のブログ/フォーラム言及の追加捜索は行えていない)。"
---

# zellij harpoonの後継 — zellij 0.44向けpane picker/jumpプラグイン調査記録

**調査日**: 2026-09-25。`domains/dev/config/zellij/config.kdl`(76行目)は `bind "b"` に `LaunchOrFocusPlugin "file:~/.config/zellij/plugins/harpoon.wasm"`(floating true, move_to_focused_tab true)を割り当てており、README.md はHarpoonを「よく使うpaneをブックマークして即座に切り替え」る機能として文書化している。持ち主環境はzellij 0.44.1(nixpkgs)、Nacho114/harpoonはzellij-tile 0.44.3向けにビルドすると `focus_terminal_pane(pane.pane_info.id, true)` が「3引数必要なのに2引数しか渡されていない」というコンパイルエラーになり、harpoon.wasmは長期間存在せずbindingは死んでいる。本記録はharpoon自体の状態・代替プラグイン・zellij組み込み機能の3問を四方向(ベンダー/実践者/測定/実地)で埋める。

## 方法と検証凡例

- 一次情報: `raw.githubusercontent.com`から取得したファイル全文(Cargo.toml/main.rs/README.md/CHANGELOG.md)、`api.github.com`(REST API)から取得した構造化データ(repo/releases/issues/pulls/commits)。
- WebFetch: ページを直接取得し要約。逐語引用ではなく要約経由であることを明記する箇所は「[WebFetch要約]」と付す。
- gh CLI認証が無効だったため`gh`コマンドは使用していない。GitHub REST APIは非認証curlで叩いたため、調査中盤でcore/searchレート制限(60/時間)に到達し、一部の裏取りをWebFetchに切り替えた。
- 到達不能・未検証は「[unverified]」と明記。

---

## 1. ベンダー

### 1.1 zellij公式CHANGELOG — 0.44.0でのプラグインAPI変更(一次情報)

出典: https://raw.githubusercontent.com/zellij-org/zellij/main/CHANGELOG.md [raw取得、全文]

- `## [0.44.0] - 2026-03-23`の項目に`infra: migrate wasm runtime from wasmtime to wasmi (https://github.com/zellij-org/zellij/pull/4449)`および`feat: command sequences, conditionally blocking CLI commands, new plugin APIs (https://github.com/zellij-org/zellij/pull/4546 and https://github.com/zellij-org/zellij/pull/4713)`の記載。
- `## [0.44.3] - 2026-05-13`にも`fix: close session-manager instead of hiding to avoid confusion (#5055)`など session-manager 関連の修正が継続。
- 持ち主環境の`0.44.1`は`2026-04-07`公開。zellij最新は`0.45.1`(2026-08-28、WebFetch経由、下記1.3節)——**持ち主は現行最新から2マイナーバージョン遅れ**。

### 1.2 focus_terminal_paneへの第3引数追加を明記した一次PR

出典: https://api.github.com/repos/zellij-org/zellij/pulls/4546 (imsnif、zellij本体メンテナ、2025-12-11マージ、0.44.0に同梱) [curl直接取得、verbatim]

- 「**New Capabilities for Existing Commands**: 1. `show_pane_with_id` now has a boolean `should_focus_pane` parameter... 2. `focus_pane_with_id` (as well as its siblings: `focus_terminal_pane` and `focus_plugin_pane`), now have the additional `should_be_in_place_if_hidden` boolean parameter. Setting this to true would mean that if the pane to be focused is suppressed, it will replace the focused pane (similarly to how editing the scrollback works).」
- **これが課題facts記載のコンパイルエラーの一次原因そのもの**——zellij側が意図して`focus_terminal_pane`のシグネチャを2引数から3引数に拡張し、それが0.44.0からのzellij-tileクレートに反映された。harpoon側の追従漏れが原因ではなく、zellij側の正式な機能拡張。

### 1.3 zellij最新リリース(一次データではないがWebFetch経由で確認)

出典: https://github.com/zellij-org/zellij/releases [WebFetch要約]

- 最新: `v0.45.1`(2026-08-28公開)。直近5件: v0.45.1→v0.45.0(2026-08-20)→v0.44.3(2026-05-13)→v0.44.2(2026-05-05)→v0.44.1(2026-04-07、持ち主の版)。

### 1.4 zellij公式の組み込みプラグインエイリアス一覧(一次ドキュメント)

出典: https://zellij.dev/documentation/plugin-aliases [WebFetch要約]

- 列挙された組み込みエイリアスは`tab-bar`・`status-bar`・`strider`(ファイルピッカー、`filepicker`は`cwd "/"`設定版)・`compact-bar`・`session-manager`(`welcome-screen`は`welcome_screen true`設定版)の**6種のみ**。
- **pane単位のピッカー/ジャンプ/ブックマーク機能は組み込みエイリアスに一つも存在しない**——0.44.0で追加された新session-manager UI(下記2.1節、PR #4821)はセッションの新規作成/アタッチ/レジャレクトを1画面に統合したものであり、対象はセッション単位でpane単位ではない。

---

## 2. 実践者

### 2.1 zellij新session-manager UIの狙い(一次PR、参考)

出典: https://api.github.com/repos/zellij-org/zellij/pulls/4821 [curl直接取得、verbatim]

- 「This changes the `session-manager` to a single screen, combining the "new session", "attach" and "resurrect" tabs for simplification and convenience sake. The new screen includes a list of active sessions, followed by a list of resurrectable sessions. Typing a session name fuzzy finds through the entire list...」——**セッション名のあいまい検索であり、pane名やpane内容の検索ではない**。

### 2.2 Nacho114/harpoon — フォーク先で3引数化を実際に直した2人の実践者

出典: https://api.github.com/repos/cartwmic/harpoon (curl、commits) [一次データ]

- コミット`0e7dac38`(2026-07-10、著者Michael Cartwright、★0・followers 0のGitHubアカウント、esh2n/本リポジトリとは無関係の第三者)のメッセージ[verbatim]: 「build: bump zellij-tile 0.42.2 -> 0.44.3 ... Matches the installed zellij runtime (new supported floor). Only source change: focus_terminal_pane gains a third bool (focus_terminal_pane(id, true, false)). Behavior-neutral; wasm build and harpoon-core tests green.」
- **課題factsが記述する『zellij-tile 0.44.3向けにビルドすると3引数エラー』という状況そのものを、この持ち主とは無関係の第三者エンジニアが独立に踏み、同じ原因(focus_terminal_paneの第3引数)を同じ結論で特定し修正した**——一次情報としての裏付けが取れた実例。ただしこのフォークは★0・フォーク0・リリース0件、`.github/workflows`は404(CI無し)で「wasm build...green」はコミットメッセージの自己申告のみ。直後のコミット群は`opsx`/`respawn-state-handoff`という無関係なワークフロー自動化の作業に切り替わっており、harpoon機能としての継続開発は止まっている。

出典: https://raw.githubusercontent.com/gabber235/zellij-harpoon/main (raw取得、commits経由API併用) [一次データ]

- コミット`2e0f84b1`(2026-06-29、著者Gabber235)[verbatim commit message]: 「build: upgrade to zellij-tile 0.44 and edition 2024」。main.rs 283行目で`focus_terminal_pane(slot_data.pane_id, true, false)`——3引数化を確認。
- 同フォークは単なるバージョン追従に留まらず、「fixed 5-slot system」から「arbitrary key-based slots」への独自リファクタ(コミット`123bbda5`)、デバッグログ基盤の追加、クロスセッション永続化の同期I/O化など**継続的な独自開発**が確認できる——2026-02-06〜2026-06-29の5か月にわたる複数コミット。ただし★0・リリース0件で、README自体はNacho114/harpoon本家のものをそのまま流用しており(2.4節参照)、独自機能を反映した更新はされていない。

### 2.3 Nacho114/harpoon upstream — 誰も互換性破壊を報告していない(負の証拠)

出典: https://api.github.com/repos/Nacho114/harpoon/issues?state=all (curl、全22件のissue/PR一覧を`focus_terminal_pane`・`0.44`でgrep) [一次データ]

- **ヒット0件**——upstream issue/PRのタイトル・本文一覧のどこにも『0.44』『focus_terminal_pane』への直接言及がない。最新のオープンPRは#22(2026-05-17、beyondlex『recent sort mode』)と#21(2026-04-03、beyondlex『cross-session pane navigation』)——直近の活動はzellij 0.44互換ではなく機能追加に集中しており、**メンテナ自身もコントリビュータもzellij 0.44向けの再ビルドを試みていない可能性が高い**[推論]。issue #13「can't find crate for `core`」(2024-10-08open)、#8「searchable list」機能要求(2024-02-07open)、#7「pane lost after break to other tab」(2024-02-07open)も未解決のまま残る。

### 2.4 shihanng — harpoonにPRを送った後、自作ツールに移行した実践者

出典: https://github.com/Nacho114/harpoon/pull/18 (「Fix issue not able to select pane with Enter key」、2025-05-04マージ)、https://github.com/shihanng/zellij-pane-picker [一次データ]

- shihanngはharpoon本家に修正PRを送った実績があるコントリビュータでありながら、その後**別プラグイン(zellij-pane-picker、旧名"yapp")を自分で立ち上げている**——harpoon本家がzellij-tile 0.42.2のまま更新を止めた(2025-05-04以降無変更)のと同時期に自作へ移行したタイミングが符合する[推論、直接の移行理由の言明は見つかっていない]。

### 2.5 timonwong — zellij-palette、AI生成コードであることを自ら明かす実践者

出典: https://github.com/timonwong/zellij-palette [WebFetch要約]

- README内でメンテナ自身が「mostly AI slop」「expect rough edges, inconsistent design choices」と明言——**否定的自己評価を伴う若いプロジェクト**。既知の制約として「floating panesはzellij側の仕様でタブ内グループ扱いのため、1つの表示切替が同タブの全floating paneに影響する」ことも自ら開示している(zellij自体の制約であり本プラグイン固有のバグではない)。

---

## 3. 測定

### 3.1 harpoon本体とフォークの活動指標比較(一次データ、GitHub API直接取得)

| リポジトリ | ★ | フォーク/オープンissue | 最終push | zellij-tile版 | 3引数対応 | リリース(wasm) |
|---|---|---|---|---|---|---|
| Nacho114/harpoon(本家) | 208 | 10 / 5 | 2026-02-21 | 0.42.2 | 未対応 | v0.3.0(2026-02-21)、DL 469 |
| cartwmic/harpoon(fork) | 0 | 0 / — | 2026-07-14 | 0.44.3 | **対応済** | なし |
| gabber235/zellij-harpoon(fork) | 0 | 0 / — | 2026-06-29 | 0.44 | **対応済** | なし |
| beyondlex/harpoon(fork) | 0 | — | 2026-05-19 | 0.42.2 | 未対応 | なし |
| dsaenztagarro/harpoon(fork) | 0 | — | 2026-04-03 | 0.42.2 | 未対応 | なし |

**10フォーク中、実際にzellij 0.44の3引数シグネチャへ追従したのはcartwmic・gabber235の2件のみ、かつどちらも★0・リリース0件**——「直す方法は分かっている実践者がいる」ことと「誰でも使える形で公開されている」ことの間に断絶がある。

### 3.2 代替プラグイン候補の測定データ(一次データ、GitHub API直接取得+一部WebFetch)

| リポジトリ | ★ | zellij-tile版(Cargo.toml) | 最新リリース | wasmアセット/DL数 | 最終push | 用途 |
|---|---|---|---|---|---|---|
| rvcas/room | 297 | `0.41`(main、未更新) | v1.2.1(2026-01-21、CIビルド) | room.wasm / 2,742 | 2026-04-11(nix修正のみ) | tab切替(pane bookmark機能なし) |
| shihanng/zellij-pane-picker | 37 | `0.42.2`(**v0.6.0タグ時点**)/`0.44.0`(main、2026-04-07以降) | v0.6.0(2025-06-22、CIビルド) | zellij-pane-picker.wasm / 521 | 2026-06-22 | pane star/jump/toggle(harpoon型) |
| timonwong/zellij-palette | 12 | `0.44.3`(現行と一致) | v0.2.2ほか計4件(すべて2026-05-14、CIビルド) | 各リリース4アセット[unverified: ファイル名未確認] | 2026-05-14 | コマンドパレット+Find Pane |
| FuriouZz/zjpane | 13 | `0.41.2` | [未確認] | [未確認] | 2025-05-27 | pane移動 |
| Winston-cs/zellij-jump-list | 25 | `0.38.2` | [未確認] | [未確認] | 2024-09-08 | vim風jump list |
| Picalines/zellij-leap | 0 | `0.45.0`(zellij最新版向け) | [releases page有りとREADMEに記載、件数未確認] | [未確認] | **2026-09-13**(最新) | tab/pane/session名ジャンプ |

- **zellij-pane-pickerの矛盾**: mainブランチのCargo.tomlは`0.44.0`(コミット`839b3d62`、2026-04-07)だが、**現在ダウンロード可能な唯一のリリース資産v0.6.0(2025-06-22公開)はそのコミットの10か月前のタグであり、実際は`zellij-tile 0.42.2`でビルドされている**——README記載のインストールURLをそのまま使うと、harpoonと同じ古いクレートを使ったwasmが降ってくる。
- **dependabotの挙動**: メンテナはzellij-tileを明示バージョン文字列として`0.44.1`(#80)・`0.44.2`(#83)へ上げるPRを**マージせずクローズ**し、`0.44.3`へのPR(#84)は現在もオープン未マージ——Cargo.tomlのcaret指定(`"0.44.0"`は`>=0.44.0 <0.45.0`と等価)は既に0.44.x全体をカバーするため実質的な互換性問題ではない可能性が高いが、**新規releaseタグを切っていない**ため利用者は結局10か月前ビルドのwasmしか手に入らない。

### 3.3 実地の不具合報告(pane-picker、practitioner起票、負の証拠)

出典: https://github.com/shihanng/zellij-pane-picker/issues/71、/issues/87 [curl直接取得、verbatim抜粋]

- issue #71(オープン、2026年、コメント0件)[verbatim]: 「Zellij version: 0.44.0 / Plugin version: v0.6.0 (latest)」の環境で「When typing a search query that matches no panes, the plugin panics.」——**逆に言えば、v0.6.0(0.42.2ビルド)がzellij 0.44.0上でロード・通常動作すること自体は実地で確認されている**(パニックは検索0件時の一部条件に限定)。
- issue #87(オープン、対応コメントなし)[verbatim]: 「I setup the plugin according to the docs, but then the navigation between tabs stops working with the Alt + L I have setup. If I don't have it in `load_plugins` it works fine, once I trigger it for the first time, the move to the right stops working.」——**プラグインをロードしただけで既存のキーバインドと衝突し壊れるという、未解決の副作用報告**。

---

## 4. 実地(in the wild)

### 4.1 awesome-zellij — コミュニティが列挙するpane/tab切り替え系プラグインの全量

出典: https://raw.githubusercontent.com/zellij-org/awesome-zellij/main/README.md [raw取得、grep] (★はREADME記載のバッジ数、取得時点)

- `harpoon (⭐206)`、`zellij-pane-picker`は明示掲載なし(READMEのbadge取得タイミングにより実数と差異あり、curlで直接取得した★37が優先)、`zellij-jump-list (⭐26)`、`zjpane (⭐13)`、`zellij-leap (⭐0)`、`neolij (⭐30)`、`zellij-palette`は明示掲載なし(リスト側が更新に追いついていない可能性、これも実数取得値★12を優先)。
- **同リストが列挙するpane関連プラグインは6〜7種と分散しており、harpoonクローンの決定版は存在しない**——コミュニティ自身も一本化できていない状態。

### 4.2 rvcas/room — 最大手(★297)だが用途がずれ、かつ0.44未対応

出典: https://api.github.com/repos/rvcas/room (curl) + https://raw.githubusercontent.com/rvcas/room/main/src/main.rs (raw、grep) [一次データ]

- README[verbatim]: 「A Zellij plugin for quickly searching and switching between tabs.」——**tab切替が主用途で、pane bookmark(harpoonの核心機能)は無い**。
- ただし`src/main.rs`305行目に`focus_terminal_pane(pane_id, true)`(2引数、未修正)という、**AIコーディングエージェント連携プラグイン「claude-zellij-whip」からのpipeメッセージを処理する箇所**が存在する——もしこの持ち主やzellij-tileの依存を`0.44`系に上げて再ビルドすれば、harpoonと全く同じコンパイルエラーに直面する構造。roomはリリース済みwasm(v1.2.1、`zellij-tile "0.41"`)を配っているため、ビルドし直さない限りこの問題は顕在化しない。

### 4.3 harpoonフォーク10件のうち実働継続を示す活動時系列

出典: https://api.github.com/repos/Nacho114/harpoon/forks (curl) [一次データ]

| フォーク | 最終push |
|---|---|
| cartwmic/harpoon | 2026-07-14(ただしharpoon機能開発ではなく別ワークフロー) |
| gabber235/zellij-harpoon | 2026-06-29 |
| beyondlex/harpoon | 2026-05-19 |
| dsaenztagarro/harpoon | 2026-04-03 |
| shihanng/harpoon | 2025-05-06(その後は別プラグインzellij-pane-pickerへ移行、2.4節) |
| luiisca/zellij-harpoon | 2025-05-05 |
| tchiadeu/harpoon | 2024-09-04 |
| m4siri/harpoon | 2024-02-20 |
| zbrox/harpoon | 2026-02-21(本家v0.3.0に永続化機能としてマージ済み、2.2節・1.1節) |
| dit7ya/harpoon | 2023-08-30 |

- **フォークの活動は分散して続いているが、どれ一つとして★・リリース・CIを備えた「本家の後継」に育っていない**——zbroxの永続化コードだけが本家にマージされ生き残った唯一の例。

---

## サマリー表

| 出典 | 対象 | 数値/事実 | 既知の失敗モード・負の証拠 |
|---|---|---|---|
| zellij PR #4546(一次、vendor) | focus_terminal_pane等の第3引数追加 | 2025-12-11マージ、0.44.0同梱 | 意図した仕様拡張であり、harpoon側の追従漏れがコンパイルエラーの原因 |
| zellij CHANGELOG(一次、vendor) | 0.44.0のWASMランタイム変更 | wasmtime→wasmi移行(#4449) | 旧wasmとの完全な互換性根拠は一次記述が見つからず[unverified] |
| zellij plugin-aliases(一次、vendor) | 組み込みプラグイン一覧 | tab-bar/status-bar/strider/compact-bar/session-manager/welcome-screenの6種のみ | pane単位ピッカーは組み込みに存在しない |
| Nacho114/harpoon(一次、issue全件) | upstream報告状況 | issue/PR 22件中『0.44』言及0件 | 誰も互換性破壊を本家に報告していない |
| cartwmic/harpoon(一次、practitioner) | フォークでの修正実例 | 2026-07-10、3引数化コミット | ★0・リリース0・CI無し、直後に無関係な作業へ転換 |
| gabber235/zellij-harpoon(一次、practitioner) | フォークでの修正実例 | 2026-06-29、3引数化+独自リファクタ | ★0・リリース0、READMEは本家のまま未更新 |
| shihanng/zellij-pane-picker(一次、測定) | harpoon型代替の最有力候補 | ★37、v0.6.0 wasm DL 521件 | 公式リリースは`zellij-tile 0.42.2`ビルドのまま(mainの0.44.0化から10か月遅れ)、issue #71(検索0件パニック)・#87(キーバインド衝突)未解決 |
| timonwong/zellij-palette(一次+WebFetch) | zellij-tile版完全一致の代替 | ★12、`0.44.3`、4リリース(2026-05-14) | メンテナ自身が「AI slop」「rough edges」と明言 |
| rvcas/room(一次、測定+実地) | 最大手だが用途不一致 | ★297、DL 2,742〜3,436/リリース | `zellij-tile "0.41"`のまま、tab切替のみでpane bookmark無し、再ビルドすれば同じ3引数エラー |
| Picalines/zellij-leap(WebFetch) | 最新プッシュ(2026-09-13) | `zellij-tile 0.45.0`(zellij最新0.45.1向け) | ★0、持ち主の0.44.1に対し新しすぎる可能性[unverified] |

---

## 否定側の証拠(明示)

- **Nacho114/harpoon本家は16か月以上(2025-05-04以降)zellij-tileを一切バンプしておらず、issue/PR一覧のどこにも0.44互換性への言及がない**——メンテナが問題を認識している形跡自体が無い。
- **フォークで3引数化に成功した2件(cartwmic・gabber235)はどちらも★0・リリース0件**——「直せる」ことと「誰でも使える形で配布されている」ことは別問題。cartwmic側は`.github/workflows`が404でCIが存在せず、修正が動作することの検証はコミットメッセージの自己申告のみ。
- **代替最有力候補shihanng/zellij-pane-pickerの公式配布wasm(v0.6.0)も、実はharpoonと同じ`zellij-tile 0.42.2`でビルドされている**——mainブランチのCargo.tomlだけが`0.44.0`に上がっており、それを反映した新規リリースタグが10か月以上切られていない。
- **pane-pickerには実利用者が踏んだ未解決バグが2件ある**——検索結果0件でのパニック(#71)、プラグイン読み込みだけで既存のAlt+Lキーバインドが壊れる副作用(#87)。どちらもメンテナからの返信・修正コミットは確認できなかった。
- **timonwong/zellij-palette はメンテナ自身が「mostly AI slop」と明言する若いプロジェクト**——zellij-tile版は一致するが、実績の厚みでは劣る。
- **zellij公式は0.45.1(2026-08-28)まで進んでおり、持ち主の0.44.1は既に2マイナー遅れ**——今回選ぶプラグインがどのzellij-tile版を要求するかによっては、次のzellij更新で再び同種の破壊に遭う可能性がある。

---

## 確認できなかったこと(前例なし・未検証)

- shihanng/zellij-pane-picker v0.6.0(zellij-tile 0.42.2ビルド)が、この持ち主のzellij 0.44.1環境で実際にロード・動作することの直接確認(issue #71は間接証拠のみ)
- zellij 0.44.0の「wasmtime→wasmi」ランタイム移行が、旧zellij-tileクレートでビルドされたプラグインのホスト関数呼び出しをどう後方互換に扱っているかの一次技術記述
- Picalines/zellij-leap(zellij-tile 0.45.0)が持ち主のzellij 0.44.1で動くか、0.45必須で動かないか
- timonwong/zellij-palette v0.2.2の4アセットに実際に`.wasm`ファイルが含まれるか(WebFetchのレンダリングエラーでファイル名未確認)
- 実践者のブログ/フォーラム(Reddit r/zellij、HN等)でのharpoon代替に関する追加言及——WebSearchのセッション予算超過により今回は捜索できなかった

---

## 結論(平易な言葉で)

**harpoon.wasmが無い原因は特定できた**: zellijは0.44.0で`focus_terminal_pane`(および兄弟関数)に第3引数`should_be_in_place_if_hidden`を意図的に追加した(PR #4546、zellij本体メンテナによる一次PR)。harpoon本家はこの変更に16か月以上追従しておらず、issue一覧にも報告が一件もない——**放置されたプラグインであり、直せば動く一行修正だが、誰も公開の形では直していない**。10個あるフォークのうち3引数化を実際にやったのはcartwmic・gabber235の2件だけで、どちらも★0・リリース0・第三者による検証も無い個人の作業ログに近い。

**代替として最も筋が良いのはshihanng/zellij-pane-picker**——star/unstar・jump・toggle機能がharpoonの用途にほぼ一致し、★37・CIビルドのリリースを6回重ねており、現在の`LaunchOrFocusPlugin {floating true; move_to_focused_tab true}`という設定パターンとも直接互換のインストール例をREADMEが示している。ただし**唯一の落とし穴として、公式配布されているv0.6.0のwasmは実はharpoonと同じ古い`zellij-tile 0.42.2`でビルドされている**(mainブランチだけが0.44.0へ上がっている)。それでも実践者のissue報告(#71)は、この旧ビルドがzellij 0.44.0上で普通にロードして動くことを示しており、致命的な非互換ではなさそうだ[この一点は推論、実機未確認]。次点はtimonwong/zellij-palette——zellij-tile版は課題の対象(0.44.3)と完全一致するが、メンテナ自身が「AI slop」と認める若いプロジェクトで実績が薄い。

**zellij 0.44自体にharpoon相当の組み込み機能は無い**——公式ドキュメントが列挙する組み込みプラグインは6種のみで、どれもpane単位のピッカー/ブックマークをカバーしない。0.44で新しくなったのはsession-manager(セッションのあいまい検索)だけで、pane名やpane内容でジャンプする用途は依然として外部プラグイン任せ。

**配線の実務的な含意**: どちらの候補を選ぶにせよ、README記載の`location="https://github.com/.../releases/download/<tag>/<file>.wasm"`という直接URL参照ではなく、現在の`file:~/.config/zellij/plugins/harpoon.wasm`と同じローカルファイル配置パターンに合わせて、特定タグのwasmを一度ダウンロードして固定するのが既存の運用と整合する。shihanng/zellij-pane-pickerを選ぶ場合は「公式最新リリースが実は旧クレートビルドである」という事実を踏まえ、mainブランチから自前でビルドし直す(zellij-tile 0.44.0以降を明示指定)か、v0.6.0のリリースwasmをそのまま試して動作確認するかの二択になる——**どちらの経路も、この持ち主の環境での実機検証はこの調査の範囲外**。
