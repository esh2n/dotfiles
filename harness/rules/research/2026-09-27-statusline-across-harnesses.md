# コーディングエージェントの statusline / footer / status bar — 業界の実態調査

調査日: 2026-09-27。対象: Claude Code、Codex CLI、pi（earendil-works/pi）、omp（can1357/oh-my-pi）、DeepSeek Harness（DSH, deepseek-ai/deepseek-harness）。

## 0. 方法と検証の凡例

- 「直接取得」= WebFetch/curl で一次ソース（公式 docs・GitHub README・Issue 本文・API JSON）を直接読んだもの。
- 「要約経由」= WebFetch の要約プロンプト越しに得た内容。原文は別途 URL を明記、引用符付きの文言は要約ツールが返した verbatim 抜粋。
- 「到達不能」= 明示的に記す。今回、Reddit/HN 系は検索していない（時間内で四方向を優先）。omp のフルソース（GitHub コード検索 API）は認証必須のため `api.github.com/search/code` が `Requires authentication` で失敗し、`raw.githubusercontent.com` 経由の docs ファイル読みに切り替えた。
- 持ち主の `harness/scripts/statusline.sh`（file:line で引用）は背景説明のためだけに読み、根拠としては使っていない。

---

## 1. ベンダー — 各ハーネスが「statusline」に何を提供しているか

### 1-1. Claude Code（Anthropic） — 唯一のフル仕様公開元

一次情報: https://code.claude.com/docs/en/statusline （直接取得、2026-09-27）

- 仕組み: `~/.claude/settings.json` の `statusLine.command` に任意のシェルコマンド/スクリプトパスを指定。Claude Code が JSON を stdin で渡し、stdout をそのまま表示する。
  > "The status line is a customizable bar at the bottom of Claude Code that runs any shell script you configure. It receives JSON session data on stdin and displays whatever your script prints"
- 再実行タイミング（イベント駆動 + 任意のポーリング）が明文化されている:
  > "Your script runs once when a session starts... After that, it runs again when: A new assistant message arrives / `/compact` finishes / The permission mode changes / Vim mode toggles / You change the `command`... / A `refreshInterval` timer elapses... / A rate-limit window... reaches its `resets_at` time / A warm prompt cache... reaches its `expires_at` time"
  > "Claude Code debounces updates at 300ms... If a new update triggers while your script is still running, Claude Code cancels the in-flight script."
- 入力 JSON スキーマは非常に詳細（`model`, `workspace.*`, `cost.*`, `context_window.*`, `rate_limits.*`, `prompt_cache.*`, `git_worktree`, `pr.*`, `vim.mode`, `agent.name` など）。フルスキーマは docs 内 `<Accordion title="Full JSON schema">` に例示あり。
- ベンダー自身が性能上の注意を明記（vendor自身が「効かない」側の証拠を出している珍しい例）:
  > "Your status line script runs frequently during active sessions. Commands like `git status` or `git diff` can be slow, especially in large repositories."
  → 対策として `session_id` をキーにした一時ファイルキャッシュ例を公式に掲載。
- 明記された非機能: 「ローカルで動きAPIトークンを消費しない」("The status line runs locally and does not consume API tokens.")、ヘルプメニューや権限プロンプト中は一時的に隠れる。
- 用途として明記されているのは「コンテキスト使用量・コスト・複数セッションの区別・git 状態の常時可視化」の4点のみ（それ以外は非公式）。

**結論**: Claude Code だけが「任意の外部コマンド + JSON stdin」というポータブルな契約を公式に持つ。他4ハーネスにこの契約と同じ形のものは存在しない（下記1-2〜1-5）。

### 1-2. Codex CLI（OpenAI） — 固定項目リストのみ、外部コマンド起動は未実装（2026-09-27時点で公式に未対応と確認）

一次情報:
- Codex Issue #17827 "Customizable status line"（open, 48コメント, 直接取得 API）: https://github.com/openai/codex/issues/17827
- Codex Issue #20244 "Custom command-backed TUI status line or colored status banner"（closed as **duplicate** of #17827, 直接取得 API）: https://github.com/openai/codex/issues/20244

- Codex の `[tui].status_line`（`~/.codex/config.toml`）は「決められた組み込みID の順序付き配列」であり、外部コマンドは呼べない。#20244 の本文（Codex ユーザーが起票）がこれを正確に説明している:
  > "Today, `[tui].status_line` supports a fixed list of built-in item IDs such as `model-with-reasoning`, `current-dir`, `git-branch`, and context usage. That is useful, but it does not support arbitrary static text, command-backed output, conditional formatting, ANSI colors..."
- OpenAI 社員自身が #20244 を #17827 の重複として閉じ、後者への一本化を明言:
  > (etraut-openai) "Please upvote #17827."
  （`state_reason: duplicate`, `closed_at: 2026-04-29`。API 直接取得で確認）
- #17827 は2026-09-27（今日）時点でも **open** のまま、直近のコメントも要望の継続を示す:
  > (WingsOfPanda, 2026-09-07) "The built-in `/statusline` / `[tui].status_line` is useful, but it selects only predefined items."
  > (oleksandrvashchyshyn-lv, 2026-09-26) "Codex's footer has no custom-text or command item, so the only lever today is `model_catalog_json` with edited `display_name`s. That renders fine, but it isn't a cosmetic override."
  → いずれも Claude Code の statusline を Codex に移植したいと明言しつつ、できないと報告している実践者の一次証言。

**結論**: Codex CLI には Claude Code 型の「外部コマンド + stdin JSON」の statusline は**存在しない**。組み込み項目の選択（`/statusline` コマンドまたは TOML）のみ。ベンダー自身が要望を認識し統合先issueに集約しているが、実装は未着手（2026-09-27時点）。

### 1-3. pi（earendil-works/pi） — 拡張API（TypeScript）でフッターを差し替える方式、外部コマンド起動の契約は無い

一次情報:
- `packages/coding-agent/docs/tui.md`（直接取得 raw）: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md
- `packages/coding-agent/examples/extensions/custom-footer.ts`（直接取得 raw、全文): https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts

- pi の統合ポイントは `ctx.ui.setFooter(factory)`（フッター全体を置き換える）と `ctx.ui.setStatus()`（簡易な追加のみ、置き換えない）の2つ。tui.md はこれを一覧表で示す:
  > "Non-blocking feedback | `ctx.ui.notify()` or `setStatus()`" / "Replace the header, footer, or editor | The corresponding `ctx.ui` component factory"
- `setFooter` はファクトリ関数 `(tui, theme, footerData) => { render(width), invalidate(), dispose }` を渡す**TypeScript拡張**方式。`footerData.getGitBranch()` や `getExtensionStatuses()` でモデル/コスト/ブランチにアクセスできるが、これは Claude Code のような「stdin に JSON、stdout にテキスト」という言語非依存の契約ではなく、pi のプロセス内で走る拡張コード。
- 公式サンプルの `custom-footer.ts` 全文を確認済み。トークン数・コスト・git ブランチを自前で `ctx.sessionManager.getBranch()` から集計してレンダリングしている（=Claude Code の stdin JSON に相当するものを pi は事前に構造化データとして拡張へ渡す設計）。

**結論**: pi はモデル/コスト/git ブランチ等の同種のデータを持つが、配布可能なのは「シェルスクリプト」ではなく「TypeScript拡張」。Claude Code の statusline.sh を無改変では動かせない。

### 1-4. omp（can1357/oh-my-pi） — 固定セグメントの選択式、外部コマンド型セグメントは無い。かつ `setFooter()` は現行版で機能していない（下記2章の実測込み）

一次情報: `docs/settings.md`（直接取得 raw）: https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md

- `statusLine.preset`（`default/minimal/compact/full/nerd/ascii/custom`）と、custom 時の `statusLine.leftSegments` / `rightSegments` / `segmentOptions`。セグメント種別は `status, cost, model, context, git` などの**固定タイプ**の組み合わせであり、Claude Code のような任意コマンド実行型セグメントは存在しない。
  > "For a custom status line, set `statusLine.preset: custom` and configure `statusLine.leftSegments`, `statusLine.rightSegments`, and `statusLine.segmentOptions`. Include `status` in either segment list to render extension statuses registered through `ctx.ui.setStatus()`"
- `cost` セグメントはピーク/オフピーク時間帯料金の矢印表示まで持つなど、Claude Code より作り込まれた面もある。
  > "The `cost` segment shows recorded session costs. For an active provider/model with scheduled pricing, it appends `↑` during peak hours or `↓` off-peak"
- しかし「任意の外部コマンドで独自セグメントを描く」機構は無く、Issue #1966（open, 直接取得API）が正確にこの欠落を要求している:
  > "there is no extension/plugin API for registering custom status-line segments/components... Today the [built-in preset list is fixed]"
- 加えて Issue #8430（open）はセグメント数が24種に対し1行(120桁)で1/3程度しか表示できないという密度不足を報告（横並び1行制約）。
- Issue #7944（open, 質問）は「Claude Code や pi のような見た目にしたい」という素朴な要望で、回答なしのまま放置。

### 1-5. DeepSeek Harness（DSH, deepseek-ai/deepseek-harness） — ベンダーは statusline/footer に一切言及なし、全てコミュニティプラグイン

一次情報: https://github.com/deepseek-ai/deepseek-harness （要約経由 WebFetch）、`ccch1mneyyy/dsh-TUI`（要約経由）、`dsh-plugin.org/plugins/small-miao/dsh-statusbar`（WebSearch要約）

- 公式 README は「Cordis という everything-is-a-plugin アーキテクチャ」とだけ説明し、statusline/footer/statusbar 機能への言及は無い（要約経由WebFetchの明示的な否定回答）。
- 実在する statusline 相当はすべて**サードパーティ Cordis プラグイン**:
  - TUI 側: `ccch1mneyyy/dsh-TUI`（★3.6k、2026-09-27 直近プッシュ、DSH公式WeChatアカウントが紹介、GitHub Trending TypeScript日間7位と自称）。「state rail」としてコンテキストバー・TPSゲージ・キャッシュヒット率・git/セッション情報を表示。純粋な Cordis パッチで「アンインストールで痕跡なし」。
  - Web UI 側: `small-miao/dsh-statusbar`（VSCode風ボトムバー）。プラグイン開発者は `ctx.get('statusbar')` から `registerItem/updateItem/removeItem/list` を呼ぶ、DSH固有のプラグインAPI。
- どちらも Claude Code の「stdin JSON + 任意コマンド」契約とは無関係の、DSHプラグインランタイム専用のAPI。ベンダー自身が用意した公式featureではない。

**四者まとめ**: Claude Code だけが「言語非依存・外部コマンド実行・stdin JSON」の契約を持つ。Codex はこれをまさに要望しているが未実装（open issue）。pi と omp はどちらも「拡張API(TS)でフッターを差し替える／セグメントを選ぶ」設計で、omp は現行版で該当APIが壊れている（後述）。DSH はベンダー機能自体が存在せず、コミュニティのCordisプラグインが代替している。

---

## 2. 実践者 — 名のある個人の記録（肯定・否定 両方）

### 肯定・実践記録

- Daniel Mackay（要約経由 WebFetch）: https://danielmackay.substack.com 系または https://www.dandoescode.com/blog/claude-code-custom-statusline — worktree/branch を見失う「認知的混乱」を解決するために自作。rate_limits フィールドが Claude Code v1.2.80 で追加されるまで表示できなかったと明記:
  > "The `rate_limits` field is the piece I was missing initially — it was added in Claude Code v1.2.80."
  性能面のトラブルは報告していない（"in-process", "no background service" と評価）。
- aihero.dev の記事（著者名不明、要約経由）: コンテキストウィンドウ管理への執着（"a constant source of paranoia for me"）を動機に、`git --no-optional-locks` をパフォーマンス目的で使用したと明記。ただし失敗談・撤回の記述は無い。

### 否定・トラブル報告（実践者コミュニティ、issue tracker由来）

- ccstatusline（★13,042、2026-09-21直近プッシュ）Issue #485 "Processes pile up when Claude Code keeps stdin open"（open, 直接取得）: https://github.com/sirmalloc/ccstatusline/issues/485
  > "after a while my machine started crawling and I found 35+ ccstatusline processes all sitting there doing nothing... Claude Code spawns a new ccstatusline process each refresh cycle but keeps the stdin pipe open without sending EOF."
  → Claude Code側がstdinをEOFせずキープすることと、ccstatusline側がEOF待ちで無限ハングすることの組み合わせによるプロセス蓄積。回避策は `head -1` でEOFを強制するラッパー。**statusline機構自体の運用コスト**を示す否定的実測。
- ccstatusline README（要約経由）自身が「起動コマンドの解決オーバーヘッド」を実測して公開している:
  > `bunx -y ccstatusline@latest` 約633ms 対 pin済み `ccstatusline` コマンド約207ms → 再描画のたびにレジストリ解決が走ることを避けるため、グローバルインストールの固定を推奨。
- omp Issue #13473（open, 直接取得, 2026-09-27付でメンテナがtriage — 本日）「`setFooter()` is declared on `ExtensionUIContext` but no-ops in every mode」: https://github.com/can1357/oh-my-pi/issues/13473
  > "The factory is never called, so an extension that follows the type gets no error and no output."
  > メンテナ roboomp の応答: "Triaged as `enhancement`. The code-level claims check out; the no-op is documented and dates back to the original port, so this is an API/design decision for the maintainer, not a regression." "`setFooter`/`setHeader` have been `() => {}` stubs since the commit that added them... The footer and header methods never were [wired up]."
  → omp は pi からのフォーク移植時に `setFooter` を意図的に stub のまま残しており、**pi用に書かれた statusline/footer 拡張は omp では黙って何も描画されない**ことが、fork元の元プロジェクトとの一次的な非互換として2026-09-27にメンテナ自身により確認された。
- elecnix/pi-footer-widget（★0、要約経由）: pi 本体のフッターAPIの断片化を示す practitioner の直接証言:
  > "`ctx.ui.setFooter()` replaces the entire footer. Every extension that wants a footer widget either clobbers the default (losing session name, stats, provider prefix, thinking level, extension statuses) or fights other extensions for the one `setFooter` slot."
  → 「pi-statusbar」(pull型)と「pi-powerline-footer」(push型)という**互換性のない2つの競合コンポーザー**がすでに存在し、統一APIが本体に無いためサードパーティが橋渡しライブラリを書かざるを得ない状態。upstream要望 earendil-works/pi#6509 待ち。

**結論**: 肯定側の実践者は「使えている」報告のみで撤回談は見当たらなかった。否定側は issue tracker 由来（バイアス: 問題を報告する場なので当然否定寄り）だが、(a) Claude Code の stdin キープによるプロセス蓄積、(b) omp の `setFooter` no-op（フォーク間の非互換）、(c) pi 本体のフッターAPI断片化、の3件は再現手順・コード行番号付きで検証可能な形で報告されている。

---

## 3. 測定可能な証拠 — 採用数・保守状態（stars/pushed_at は `gh`/`api.github.com` 実測、2026-09-27時点）

`api.github.com` の検索API直接実行（認証なし、レートリミット内）で採取。

| リポジトリ | 対象ハーネス | ★ | 直近push |
|---|---|---|---|
| jarrodwatts/claude-hud | Claude Code | 28,186 | 2026-09-26 |
| sirmalloc/ccstatusline | Claude Code | 13,042 | 2026-09-21 |
| Haleclipse/CCometixLine (Rust製) | Claude Code | 3,461 | 2026-03-14（半年停滞） |
| Owloops/claude-powerline | Claude Code | 1,169 | 2026-09-27 |
| chongdashu/cc-statusline | Claude Code | 641 | 2026-02-16（7ヶ月停滞） |
| nicobailon/pi-powerline-footer | pi | 445 | 2026-09-26 |
| lmilojevicc/pi-zentui | pi | 95 | 2026-09-26 |
| Xichun123/pi-cometix-footer | pi | 43 | 2026-07-26 |
| hsingjui/pi-statusline（Claude Code互換を明示的に謳う） | pi | 5 | 直近コミット日時未取得 |
| yinziyang/pi-statusline | pi | 未取得（別実装、README で "Codex quota" も統合と説明） | — |
| ccch1mneyyy/dsh-TUI | DSH | 3,568 | 2026-09-27 |
| small-miao/dsh-statusbar | DSH (Web UI) | 未取得（プラグインマーケットのみ確認） | — |
| Harrison-Blair/statuslines（Claude Code+Codex横断を明示） | Claude Code + Codex | 0 | commit数3のみ |
| 個人名の `<user>/codex-statusline` フォーク多数 | Codex | ほぼ全て 0〜2 | 大半2026年内だが★ゼロ |

- Claude Code 向けは 13k★級のツールが複数あり、omp向け "statusline" 検索でも上位互換ツールとしてヒットする(=omp利用者もClaude Code製ツールを流用しようとする形跡)が、これは vim/tmux用の `powerline`, `lualine.nvim`, `vim-airline` 等の**別カテゴリのツールが検索ノイズとして混入**している点に注意（`omp-statusline`検索結果の上位はvim系プラグインで、omp固有のヒットはほぼ無い）。
- `codex-statusline` という名前のリポジトリは30件近く見つかるが、ほぼ全てが★0の個人フォーク/検証コード。1件（sh-ai-x/codex-statusline）が★1。**Codex 向けに実際に使われている statusline ツールは実質存在しない**という採用実態と、1-2章の「Codexには外部コマンド契機が無い」という仕様上の欠落が一致する。
- pi 向けの statusline/footer 系リポジトリは383件ヒットするが、大半が★0〜数十の個人拡張で、100★超はごく少数（nicobailon: 445, lmilojevicc: 95）。統一・定番と呼べるものは無い。

**在り方の傾向**: Claude Code だけがエコシステムとして「本物の市場」（13k★級ツールが複数、Rust実装まである）を持つ。他ハーネスは個人が自分用に書いた小規模拡張の乱立で、"cross-harness one script" を謳うツールは実在するが★0〜5規模の実験段階（Harrison-Blair/statuslines, hsingjui/pi-statusline）。

---

## 4. 実地（in the wild） — クロスハーネス互換の試みとその実態

- **Harrison-Blair/statuslines**（★0、要約経由 WebFetch）: 「1つの共有設定でポータブル」と謳うが、実装を読むと Codex 側は外部コマンドを呼ばず、Codex の**固定フィールドTOML設定へセグメントIDを変換**しているだけ:
  > "Codex exposes fixed native footer fields, so statusline.py translates the same segment IDs into Codex's [tui].status_line setting."
  つまり Claude Code 側の任意ロジック（カスタム色分け・アイコン・独自集計）はCodex側には持ち込めず、**Codexの組み込み項目セットに縮退**する形でしか「互換」を実現していない。pi対応は「計画中、未着手」と明記(`"nothing is built for it yet"`)。omp には触れていない。
- **hsingjui/pi-statusline**（★5）: pi 側は `ctx.ui.setFooter()` を使い Claude Code と同型のJSONペイロードを自作スクリプトのstdinに流す、という点で「本当にClaude Codeのスクリプトを無改変で使える」設計。ただし pi 本家の `setFooter` は正常動作するが、**omp では同名APIが no-op**（2章）なので、このアプローチは pi では成立してもフォーク先のompでは成立しない。
- ccstatusline の「複数independentなstatusline」機能（WebSearch要約）は、同じJSONをチェーンすることで複数ツールを合成できると説明されるが、これはあくまでClaude Code内部の話であり、他ハーネスへの展開ではない。

**結論**: 「1本のスクリプトを複数ハーネスで使い回す」という実践は存在するが、いずれも小規模（★0〜5）かつ Codex 側は機能を落とした劣化互換（固定項目への変換）にとどまる。pi→omp間ですら統一されていない（setFooterの実装差）。

---

## 5. 要約表

| 出典 | タスク種別 | 結果 | 費用・数値 | 名指しの失敗モード |
|---|---|---|---|---|
| Claude Code公式docs (code.claude.com/docs/en/statusline) | 統合機構の仕様 | 外部コマンド+stdin JSON、300msデバウンス、任意`refreshInterval` | トークン消費ゼロと明記 | 大規模repoで`git status`等が遅くなるとベンダー自身が明記、セッションIDキーのキャッシュを公式推奨 |
| Codex issue #17827 (open, 48コメント) | 機能要望 | 未実装のまま2026-09-27時点でopen | — | Claude Code型statuslineを移植できないと複数実践者が明言 |
| Codex issue #20244 (closed, duplicate) | 機能要望 | OpenAI社員が#17827への一本化を明言 | — | コマンドバック型は「今日時点で存在しない」 |
| pi tui.md / custom-footer.ts (直接取得) | 拡張API仕様 | `setFooter`はTS拡張、JSON stdin契約ではない | — | 該当なし（動作する） |
| omp settings.md (直接取得) | 設定仕様 | 固定セグメント選択式、コマンド型セグメント無し | — | Issue #1966: 拡張APIが無いとの要望open |
| omp issue #13473 (open, 2026-09-27 triage) | バグ報告 | `setFooter`/`setHeader`が全モードでno-op | — | メンテナが「fork時からのstub、直す予定はdesign decision」と明言 |
| DSH README (要約経由) | ベンダー機能有無 | statusline機能への言及なし | — | 全てサードパーティCordisプラグイン(dsh-TUI ★3.6k, dsh-statusbar) |
| ccstatusline issue #485 (open) | 運用不具合 | Claude CodeがstdinをEOFしないためプロセスが35+蓄積 | マシンが重くなる実害 | `head -1`ラッパーが回避策、根本修正は未定 |
| ccstatusline README (要約経由) | 性能実測 | bunx起動633ms対pin済み207ms | 数値あり | 頻繁な再描画での起動オーバーヘッドを自認 |
| Harrison-Blair/statuslines (★0) | クロスハーネス実装 | Codex側は固定項目への変換に縮退、pi未着手 | ★0, commit3件のみ | 「Codexにはコマンドバック型が無い」と実装者自身が明記 |
| hsingjui/pi-statusline (★5) | クロスハーネス実装 | Claude Codeスクリプトをpiでほぼ無改変流用 | ★5 | omp（別プロダクト）では`setFooter`no-opのため動作しない可能性[推測、未実測] |
| gh検索 (api.github.com, 2026-09-27) | 採用実態 | Claude Code向けツールのみ13k★級が複数、Codex/pi/DSH向けはロングテールの個人拡張 | 表内★数参照 | `codex-statusline`名の30件中29件が★0 |

---

## 6. 平易な結論（判断は書かない、支持される事実と支持されない事実のみ）

- **「JSON stdin + 任意外部コマンド」という Claude Code の統合方式そのものは、他のどのハーネスにも同じ形では存在しない。** Codex は固定項目リストのみで、外部コマンド実行はベンダー自身が認識している未実装の要望（#17827, open, 2026-09-27時点）。pi と omp は「拡張コード（TypeScript）でフッターを描く」設計であり、シェルスクリプトの持ち回しを前提にしていない。DSH はベンダーとして statusline 機能自体を持たない。
- **pi と omp は名前が似ていて（omp は pi のフォーク）データモデルも似ている（model/cost/context/git）が、拡張APIの互換性は無い。** omp のメンテナ自身が2026-09-27（本日）、`setFooter`/`setHeader` が「フォーク時からのstub」であり直す計画のない設計判断だと述べている。pi 用に書かれたフッター拡張を omp にそのまま持ち込む前提は成り立たない。
- **「1本のスクリプトを複数ハーネスで使い回す」実践は実在するが、いずれも小規模（★0〜5）で、Codex側では機能を大きく落とした劣化互換（自由記述の放棄、固定項目への変換）でしか成立していない。** 「業界で確立した慣行」と呼べる規模には達していない。
- **Claude Code 陣営だけが本物の市場（13k★超のツールが複数、Rust実装、28k★の統合HUD）を持つ。** 他ハーネス向けの統合ツールは個人の実験リポジトリの乱立にとどまる。
- **否定側の証拠も実在する。** Claude Code自身のstdinキープによるプロセス蓄積（ccstatusline #485）、頻繁な起動のオーバーヘッド（ccstatusline README実測）、大規模repoでの`git`呼び出しの遅さ（ベンダー自身の注意書き）。これらは「動くが無料ではない」ことを裏付ける。

## 7. 確認できなかったこと（no precedent found / 到達不能）

- **Claude Code / Codex / pi / omp / DSH の5つ全てに同時対応する単一statuslineツールの実例は見つからなかった。** 最も近い Harrison-Blair/statuslines も pi・ompには未着手。
- omp（can1357/oh-my-pi）が将来 `setFooter` を修正する計画があるかどうかは issue のtriageコメント以上の情報に到達できなかった（ロードマップ等未確認）。
- yinziyang/pi-statusline の実装詳細・star数・実際の互換範囲は WebSearch の要約のみで、一次ソースを直接読めていない[未検証]。
- DSHの公式ドキュメントサイト（deepseek.com/harness）そのものには直接アクセスしておらず、README要約とdsh-plugin.orgの記載のみに依拠している[要約経由、未直接確認]。
- Reddit / Hacker News 上の実践者スレッドは時間内に調査していない（四方向のうち「実践者」は個人ブログとissue trackerに限定した）。
- ccstatusline #485・omp #13473 以外の「頻繁な再描画による負荷」系の定量ベンチマーク（CPU使用率やレイテンシの系統的計測）は見つからなかった。個々の起動時間実測（633ms/207ms）のみ。
