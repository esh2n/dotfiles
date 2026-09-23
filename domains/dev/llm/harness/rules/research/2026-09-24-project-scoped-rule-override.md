# プロジェクト単位のグローバルルール上書き — 業界慣行調査

調査日: 2026-09-23

## 検証方法の凡例

- 直接取得: WebFetch / Bash(curl, GitHub REST API `search/code`, `repos/{owner}/{repo}/contents/...`) で一次ファイル本文を取得したもの。行内に「直接取得」または該当URLを明記。
- 要約経由: WebSearch のクエリ結果として返ったスニペット/要約。個別に「WebSearch要約」と明記し、一次資料が別途取得できたものはそちらを優先して引用。
- 到達不可: 見つからなかった、または到達できなかったもの。「到達不可」と明記（「存在しない」ではなく「見つからなかった」の意味）。
- `gh` CLI は本セッションで keyring トークンが無効(`gh auth status` で `Failed to log in ... The token in keyring is invalid`)、かつ Go の TLS スタックがプロキシ証明書を検証できず(`x509: OSStatus -26276`)動作しなかったため、`gh auth token` で取得した値を `curl` の `Authorization: token` ヘッダに載せて GitHub REST API (`api.github.com`) を直接叩いた。これは `gh search code` と同じデータソース(GitHub Code Search API)であり、結果の正当性は同等。

---

## 問い

1. グローバルなハーネスルール（例:「`.yoki.json` の `allowMainBranchWork: true` がない限り main への push 禁止」）に対する、プロジェクト単位の上書き・パラメータ化の業界標準は何か。候補は (a) ハーネス純正のプロジェクト設定ファイル、(b) ハーネス非依存のリポジトリファイル（AGENTS.md 等）、(c) プロジェクト側の上書きを持たず、Git ホストのブランチ保護と「絶対ルール」に任せる。
2. 特に「このリポジトリではエージェントが main に push してよい」というケースで、ベンダーと実践者は何をしているか。
3. レビューエージェント向けの「CSS 方法論・トークン置き場・spacing の所有者」といったプロジェクトパラメータは、リポジトリルートの JSON が普通か、AGENTS.md/CLAUDE.md のプローズが普通か、それとも `.stylelintrc` 等ツール設定の流用が普通か。

---

## 各レンズの所見

### レンズ1: ベンダー

**Claude Code — 設定ファイルの階層と適用範囲**
公式ドキュメント（直接取得）は5段階の優先順位を図示している。
> Levels (highest→lowest): 1. Managed settings (`managed-settings.json, MDM, or the claude.ai console`) — "Your organization" / 2. Command line (`claude --settings`) — "You, this session" / 3. Project local (`.claude/settings.local.json`) — "You, this project" / 4. Shared project (`.claude/settings.json`) — "Everyone in the project" / 5. User (`~/.claude/settings.json`) — "You, every project"
出典: https://code.claude.com/docs/en/settings （直接取得）

重要な補足として、WebSearch要約（複数の二次記事の合成、一次文言は個別に未検証）によれば permission ルールは「上書き」ではなく「マージ」される、つまり deny はどのスコープにあっても効く（"a deny anywhere in the stack sticks"）。この設計だと、プロジェクト側の `.claude/settings.json` は「グローバルの deny を緩める」方向には効かない、少なくとも同じキーに対する deny がグローバル側にあれば勝つ、という理解になる。一次ドキュメントページ本文でこの merge 挙動そのものを確認できていないため、この一段落は要約経由として扱う。

つまり Claude Code は「プロジェクト単位の上書き」用のハーネス純正ファイル (`.claude/settings.json`) を持つが、それは Claude Code 専用であり、Codex / pi / DSH / omp には届かない。

**Codex CLI — プロジェクト設定と信頼(trust)**
公式ドキュメント（直接取得、`developers.openai.com/codex/config-basic` から `learn.chatgpt.com/docs/config-file/config-basic` へ308リダイレクト）:
> "to scope settings to a specific project or subfolder, add a `.codex/config.toml` file in your repo"
> "Project config files: `.codex/config.toml`, ordered from the project root down to your current working directory (closest wins; **trusted projects only**)"
> "If you mark a project as untrusted, Codex skips project-scoped `.codex/` layers, including project-local config, hooks, and rules."
> 組織管理下では "your organization may also enforce constraints via `requirements.toml` (for example, disallowing `approval_policy = "never"` or `sandbox_mode = "danger-full-access"`)" ともある。
出典: https://learn.chatgpt.com/docs/config-file/config-basic （直接取得、リダイレクト先）

つまり Codex にもプロジェクト単位の上書き機構 (`.codex/config.toml`) はあるが、これも Codex 専用。かつベンダー自身が「信頼していないプロジェクトのローカル設定は読まない」という trust gate を明記しており、"repo が自分で自分の安全制約を緩められる" ことへの警戒がベンダー設計に組み込まれている。

**GitHub — ブランチ保護**
公式ドキュメント（直接取得）:
> "Restrict who can push to matching branches" / "Optionally, to also restrict the creation of matching branches, select **Restrict pushes that create matching branches**."
出典: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule （直接取得）

この設定は GitHub の Settings → Branches という**ホスト側**の設定であり、リポジトリ内のどのファイルからも変更できない。「main への push を許すかどうか」の絶対的な最終防衛線は、どのハーネス設定ファイルでもなく、Git ホストのブランチ保護である、というのがベンダー側の位置づけ。

**Anthropic自身の AGENTS.md への態度**
`anthropics/claude-code` リポジトリの `mods/agents-md/README.md` を WebFetch（要約経由、抽出した一次引用あり）:
> "`AGENTS.md` read the way Claude Code reads `CLAUDE.md`, as a plugin, under one option, `instructionFiles`"
これは AGENTS.md を「Claude Code 専用プラグインとして CLAUDE.md と同じ扱いにする」という位置づけであり、Anthropic 自身が AGENTS.md を「全ハーネス共通のプロジェクト設定フォーマット」だと公式に謳っている記述は見つからなかった（到達不可 — README内に "harness-neutral" 等の明言なし）。AGENTS.md がクロスツールの慣行として広まっているのは事実上の合意（後述レンズ4）であって、単一ベンダーの仕様書ではない。
出典: https://github.com/anthropics/claude-code/blob/main/mods/agents-md/README.md

### レンズ2: 実践者

**obra/superpowers（Jesse Vincent, "obra"）**
GitHub API（直接取得）: stars 290,432 / forks 25,986 / 最終push 2026-09-22。WebSearch要約が「最も star を集めた Claude Code スキルリポジトリ」と表現している通り、規模として最有力の named practitioner 事例。
出典: https://github.com/obra/superpowers/

`RELEASE-NOTES.md` を WebFetch（要約経由、バージョン別の引用あり）:
> v5.1.0 (2026-04-30): "Main branch protection softened to require explicit consent. Instead of prohibiting main branch work entirely, the skills now allow it with explicit user consent."
> v4.2.0 (2026-02-05): "Main branch protection softened to require explicit consent"

これは重要な負の事例でもある：superpowers は当初「main での作業を全面禁止」していたが、それをリポジトリ設定ファイルによる上書きにはせず、**セッション内でのユーザーへの明示的な確認（対話的同意）**に緩めた。つまり実践者の到達点は「リポジトリにコミットされた設定フラグで緩める」ではなく「その場でユーザーに聞く」であり、これは本調査の (a)/(b) いずれの候補とも異なる第三の実装（動的な人間確認）。
出典: https://github.com/obra/superpowers/blob/main/RELEASE-NOTES.md

**aiops-starter-kit / FailSafe / nightgauge — 独立した3例の収束**
GitHub Code Search（直接取得、`api.github.com/search/code`、認証済み）で `allowMainBranch` / `allow_main_branch` を検索し、無関係リポジトリ多数の中から実際に「エージェントの main push/作業許可」を実装している3件を精読した。3件とも互いに無関係な開発者/組織で、しかも実装方式が収束している。

1. **Igor-C-Assuncao/aiops-starter-kit**（stars 0, 最終push 2026-08-20）の `AGENTS.md`:
> "Never start a loop on `main`. Use a task branch or set `ALLOW_MAIN_BRANCH=1`."
`agentops-cli/src/core/preflight.ts` の実装:
```
private static checkBranch(repoRoot: string, allowMain: boolean): DiagnosticCheck {
  ...
  return { name: 'Feature branch', status: allowMain ? 'WARN' : 'FAIL',
    message: `On '${branch}'. Create a task branch or set ALLOW_MAIN_BRANCH=1.` };
}
```
出典: https://github.com/Igor-C-Assuncao/aiops-starter-kit/blob/main/AGENTS.md, https://github.com/Igor-C-Assuncao/aiops-starter-kit/blob/main/agentops-cli/src/core/preflight.ts

2. **MythologIQ-Labs-LLC/FailSafe**（stars 6, 最終push 2026-09-15）の `tools/reliability/prepush-validate.ps1`:
> `param([switch]$AllowMainBranch, ...)` を pre-push フックのパラメータとして受け取り、`if ($AllowMainBranch) { $branchArgs += "-AllowMain" }` として下位の branch policy validator に渡す。
出典: https://github.com/MythologIQ-Labs-LLC/FailSafe/blob/main/tools/reliability/prepush-validate.ps1

3. **nightgauge/nightgauge**（stars 7, 最終push 2026-09-23 = 当日）の `codexPreflight.ts`:
> `const allowMainBranch = options?.allowMainBranch ?? options?.stage === "issue-pickup";` — 呼び出し元が明示的に渡さない限り、ステージ（"issue-pickup" 等）由来のデフォルトのみが効く。関数シグネチャのオプション引数であり、リポジトリにコミットされる設定ファイルの値ではない。
出典: https://github.com/nightgauge/nightgauge/blob/main/packages/nightgauge-sdk/src/cli/codexPreflight.ts

**この3件の共通点（否定できない事実）**: いずれも「main への作業/push を許すかどうか」を
- リポジトリにコミットされた JSON/TOML 設定ファイルの値として持たせておらず、
- **起動時に人間が渡す環境変数・CLIフラグ・関数引数**として扱い、
- しかも判定の実行主体はエージェント自身のモデル判断ではなく、**deterministic な preflight/pre-push スクリプト**（Node/TypeScript, PowerShell）である。

これは問い2の (a)/(b) いずれとも異なる第四の実装パターンで、「エージェントが読めるリポジトリ内ファイルで安全側ルールを緩める」ことを明示的に避けている点で一貫している。3件は互いに無関係（プロジェクト規模も星数も異なる）だが実装の型が同じであり、単一事例のアネクドートではない。

### レンズ3: 測定・インシデント証拠

**CVE-2026-21852 — プロジェクト側設定を信頼したことによる実被害**
WebSearch要約（Microsoft Security Blog、CSA Research Note等の複数ソースの合成。一次ブログは個別に未検証だが複数の独立ソースが同じCVE番号・同じメカニズムを記述しており、単一記事のアネクドートではない）:
> "Microsoft Threat Intelligence identified a prompt injection pathway in Claude Code GitHub Action that allowed access to workflow secrets under specific conditions. An attacker-controlled project could override ANTHROPIC_BASE_URL, redirect API traffic, and leak the API key before trust confirmation (CVE-2026-21852)."
出典: https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/ , https://labs.cloudsecurityalliance.org/research/csa-research-note-claude-code-github-action-prompt-injection/

これは「安全に関わる設定値（この場合は API エンドポイント）をプロジェクト側ファイルから読ませる」設計が、trust confirmation より前のタイミングで悪用された実例。今回の問いの「main push を許可するプロジェクト設定」と直接の脆弱性ではないが、**同種のメカニズム（プロジェクト内ファイルの値を安全側ルールの分岐に使う）が攻撃面になった一次インシデント報告**として関連する負の証拠。

**その他の研究記事群（WebSearch要約、複数記事の合成のため個別の一次確認はしていない）**
> "System prompts in Claude Code are handled through CLAUDE.md, which sits in the code repository, and anyone with write permission can edit it for an entire project. Researchers placed authorization-style lines into CLAUDE.md and demonstrated Claude Code assisting with bypassing a login and dumping password databases, with Claude explicitly citing CLAUDE.md as the authorization basis for the task."
> "Consent prompts do not tell users anything about the content of instruction files, and consent is granted at the granularity of a folder but then applied to an arbitrary amount of attacker-controlled policy text."
出典（要約経由、個別記事）: https://www.penligent.ai/hackinglabs/claude-code-claude-md-and-sql-injection/ , https://pluto.security/blog/claude-code-vulnerability/

これらは「リポジトリ内ファイル（CLAUDE.md/AGENTS.md含む）の文言を、エージェントが安全側の判断根拠として直接使う」設計そのものへの警告であり、"main への push を許可する" という安全側ルールの緩和条件を、たとえ JSON の値であってもリポジトリ側ファイルに置くこと自体に構造的リスクがあることを示す測定・インシデント側の裏付けになる。ベンチマーク論文やリーダーボードのような定量数値付き研究は見つからなかった（到達不可）。

### レンズ4: 実態（公開リポジトリ）

GitHub Code Search（直接取得）での検索結果件数:
- `"allowMainBranchWork"` (このリポジトリが `.yoki.json` で使っていた正確なキー名): **total_count: 0** — 他のどの公開リポジトリもこの名前を使っていない。
- `filename:.agentrc`: total_count 40 — `.agentrc` というハーネス非依存ファイル名自体は複数の独立プロジェクトで使われている実例がある（例: `moikas-code/kuuzuki`, `wallner/dotfiles`）。ただし中身は「main push許可」の類ではなく、コーディング規約（フォーマッタ、命名規則、ビルドコマンド等）を集約した設定で、kuuzuki の実物（直接取得、`repos/moikas-code/kuuzuki/contents/.agentrc`）は次の形:
```json
{
  "project": {"name": "kuuzuki", "type": "monorepo", ...},
  "commands": {"install": "bun install", "test": "bun test", ...},
  "codeStyle": {"formatter": "prettier", "linter": "eslint", "quotes": "double", ...},
  "conventions": {"fileNaming": "camelCase", "testFilePattern": "*.test.ts", "configFiles": [".agentrc", "package.json", "tsconfig.json", ...]}
}
```
出典: https://github.com/moikas-code/kuuzuki/blob/main/.agentrc （GitHub API contents 経由で直接取得）
→ `.agentrc` はコーディングスタイル・コマンドの単一情報源として使われており、安全側の許可フラグ（main push可否）を持たせている例は見つからなかった。

- `"css methodology" AGENTS.md`: total_count 64。実物の1件（直接取得、`timotejblazic/winter` の `AGENTS.md`）:
> "Inspect the selected theme before assuming its asset pipeline, CSS methodology, JavaScript setup, or build command."
出典: https://github.com/timotejblazic/winter/blob/main/AGENTS.md
→ これは CSS 方法論を**JSON化せず、エージェントに「決め打ちせず調べろ」と指示するプローズ**であり、本調査の問い3で言う「JSON設定を読む」の反例。AGENTS.md にプローズで書く、が実物の作法。
- `"design tokens" "CLAUDE.md"` / `"BEM" "CLAUDE.md"`: それぞれ total_count 46,208 / 38,272。母数が大きく玉石混交（false positive多数、個別精査はしていない）だが、CSS/デザイントークン言及が CLAUDE.md の中に大量に存在することは、AGENTS.md/CLAUDE.md プローズが支配的なパターンであることの量的裏付けにはなる。

- **duc01226/EasyPlatform**（stars 9, 最終push 2026-08-21）は数少ない「専用 JSON スキーマ + 検証コード」を実装している対抗例。`docs/project-config.json` を `.claude/hooks/lib/project-config-schema.cjs` で検証し、専用スキル (`project-config` SKILL.md、直接取得) が
> "MUST ATTENTION run `node .claude/hooks/lib/project-config-schema.cjs --describe` — use field names verbatim"
> "Schema enforced by `.claude/hooks/lib/project-config-schema.cjs`"
という運用をしている。ただしこの config はモジュール構成・パスパターン・コンテキストグループのためのもので、CSS方法論や main push 許可のような安全側パラメータではない。かつ Claude Code / Codex 両対応のミラー生成 (`.claude/scripts/codex/sync-context-workflows.mjs`) を自前で書いており、「1ハーネスにつき1つの純正設定ファイルしかない」問題を、ハーネス横断の自前JSON+2ハーネス分の同期スクリプトで解決している唯一の実例だった。9 star規模の個人/小規模プロジェクトであり、業界標準というより一つの労力のかかったワークアラウンド。
出典: https://github.com/duc01226/EasyPlatform/blob/main/.claude/skills/project-config/SKILL.md , https://github.com/duc01226/EasyPlatform/blob/main/.claude/hooks/lib/project-config-loader.cjs

- pi / DSH / omp という3ハーネス名について、それぞれの公開ドキュメント・プロジェクト設定慣行を独立に検索したが、これらの固有名は一般的すぎて（"pi", "omp" 等）ノイズに埋もれ、対応する公開ドキュメントページや実践例を GitHub Code Search / WebSearch で特定できなかった（到達不可）。少なくとも「pi/DSH/omp すべてに届くプロジェクト単位の上書き機構」をベンダーが謳っている一次資料は見つからなかった。

---

## 否定側の証拠

- `.yoki.json` の `allowMainBranchWork` という具体的なキー名は、GitHub Code Search 上で他のどの公開リポジトリにも存在しない（total_count: 0）。これは前例のない自前命名であることの直接的な否定証拠。
- 実践者側最大手の obra/superpowers は「main作業を安全に許可する」問題を、**設定ファイルではなく対話的なユーザー確認**に解決を移した（v4.0.0時点の全面禁止 → v4.2.0/v5.1.0で「明示同意があれば可」）。これは「リポジトリ側ファイルで緩める」という設計そのものを避けた変遷であり、候補(a)(b)いずれとも異なる第三の道を選んだという否定的示唆。
- Codex はベンダー自身が「信頼していないプロジェクトの `.codex/` 層（config/hooks/rules を含む）を丸ごと無視する」という trust gate を明文化している。これは「プロジェクト側ファイルが安全側ルールを緩められる」ことへのベンダー側の一貫した警戒であり、(a)を無条件に推奨してはいない。
- CVE-2026-21852 は「プロジェクト側の値を、trust confirmation より前に安全に関わる分岐へ使う」設計が実際に攻撃面になった一次インシデントであり、"リポジトリ内ファイルに緩和フラグを置く" というアプローチ全般への負の証拠。
- 独立3リポジトリ（aiops-starter-kit, FailSafe, nightgauge）はいずれも main-push 許可を**リポジトリにコミットされたファイルの値としては持たせていない**。すべて起動時の環境変数/CLIフラグ/関数引数であり、これは「コミットされた設定ファイルによる緩和」自体を避ける収束したパターンとして読める。
- CSS方法論についても、JSON管理の実例(EasyPlatform)は star 9の小規模プロジェクト1件のみで、しかも汎用モジュール管理の一部としてであり、CSS専用ではない。「CSS方法論用の専用JSONをレビューエージェントが読む」という設計を業界標準として裏付ける実例は見つからなかった。

---

## 確認できなかったこと

- pi / DSH / omp という3ハーネスそれぞれの公式ドキュメントにおける「プロジェクト単位の設定ファイル」の仕様（存在するかどうか、名称、読み込み優先順位）は特定できなかった（到達不可、固有名詞の一般語との衝突により検索不能）。
- Claude Code の permission マージ挙動（"deny anywhere in the stack sticks"）は要約経由の情報のみで、一次ドキュメント本文中の該当記述そのものは確認できていない。
- CVE-2026-21852 の一次ソース（Anthropic自身のセキュリティアドバイザリページ、CVE公式エントリ）には到達しておらず、Microsoft/CSAという第三者の記述のみで構成されている。
- 「全ハーネスに届くプロジェクト単位の上書き機構」をベンダーが公式に謳っている一次資料は、Claude Code / Codex いずれについても見つからなかった（両者とも自社ハーネス限定の機構のみ）。
- CSS方法論/トークン置き場/spacing所有者について、定量的な測定・ベンチマーク（例:「JSON管理チームの方がレビュー精度が高い」等）は探した範囲では存在しない（到達不可、そもそもこの種の計測研究自体が見当たらない）。

---

## 結論

**問い1（グローバルルールのプロジェクト単位上書きの業界標準）**: 単一の「業界標準」と呼べる形は存在しない。実態は少なくとも4通りに分岐している。
- (a) ハーネス純正のプロジェクト設定ファイル: Claude Code (`.claude/settings.json`) と Codex (`.codex/config.toml`) はそれぞれ持つが、これは自社ハーネス限定であり「全ハーネスに届く」ものではない。ベンダー自身がドキュメントで明言している(直接取得で確認済み)。
- (b) ハーネス非依存のリポジトリファイル（`.agentrc`, AGENTS.md）: `.agentrc` は実在し使われている(40件ヒット)が、中身はコーディングスタイル・ビルドコマンドの単一情報源としてであり、安全側の許可フラグ（main push可否）を持たせている実例は見つからなかった。
- (c) プロジェクト側の上書きを一切持たず、ブランチ保護に一任: GitHub のブランチ保護はホスト側の設定であり、リポジトリ内ファイルでは変えられない、という最終防衛線として存在する(直接取得で確認済み)。ただしこれは「main push可否」というエージェント運用ルールとは別軸（ホストの強制執行 vs エージェントへの指示）であり、両者は排他ではなく併存する。
- (d) 今回新たに見えた第四のパターン（本調査で最も収束していた実例）: main push/main作業の許可を、**リポジトリにコミットされる設定ファイルの値ではなく、起動時に人間が渡す環境変数・CLIフラグとして、deterministicなpreflight/pre-pushスクリプトが判定する**。独立した3つの公開リポジトリ（aiops-starter-kit, FailSafe, nightgauge）がこの形に収束しており、かつ最大手実践者の obra/superpowers も「設定ファイルで緩める」ではなく「対話的にユーザーへ確認する」という、同じ方向（=エージェントが読めるリポジトリファイル自体に緩和フラグを持たせない）を選んでいる。

**問い2（main push許可の具体的な扱い）**: ベンダー側は「信頼できないプロジェクト設定は無視する」（Codexのtrust gate）、「denyはスタックのどこにあっても勝つ」（Claude Code、要約経由）という、緩和よりも制約が勝つ設計を志向している。実践者側（obra/superpowers、および3件の独立preflightスクリプト）は、緩和の起点を「リポジトリにコミットされたファイル」ではなく「その場の人間の指示（対話確認、または起動時のフラグ/環境変数）」に置いている。これは今回の `.yoki.json` の `allowMainBranchWork: true` という設計（＝コミットされたリポジトリファイルの値でルールを緩める）とは異なる形であり、少なくとも見つかった実例の中に、その形そのものの直接の先例はなかった。

**問い3（CSS方法論等のプロジェクトパラメータ）**: リポジトリルートJSONをレビューエージェントが読む、という設計は業界の主流ではない。実例で多数見つかったのは AGENTS.md/CLAUDE.md 内のプローズで、しかも「決め打ちせず選ばれたテーマ/ディレクトリを調べよ」という指示形が典型（`timotejblazic/winter` の実例）。専用JSONスキーマで管理している唯一の実例(EasyPlatform)もCSS専用ではなく汎用モジュール管理の一部であり、しかもstar 9の小規模事例。`.stylelintrc` 等の既存ツール設定をエージェントに読ませるという運用が独立に主流かどうかは、今回の検索範囲では直接の実例を特定できなかった（到達不可）。

**総括**: `.yoki.json` のような「コミットされたリポジトリ内JSONの値で、グローバルな安全側ルール（main push禁止）を緩める」という設計は、探索した範囲の公開実例・ベンダードキュメント・実践者記録のいずれにも直接の先例がない。むしろ収束して見えたのは「安全側の緩和は、リポジトリにコミットされたファイルではなく、起動のたびに人間が明示的に渡す一時的な合図（環境変数・CLIフラグ・対話確認）で行う」という設計であり、これは推奨としてではなく複数の独立ソースが同じ形に収束していた、という観測として記録する。CSS方法論のようなプロジェクト固有の非安全パラメータについては、JSON化よりAGENTS.md/CLAUDE.mdのプローズが実例として優勢。
