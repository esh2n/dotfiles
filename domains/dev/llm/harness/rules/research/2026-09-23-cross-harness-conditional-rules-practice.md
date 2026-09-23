---
question: "複数のコーディングエージェント(Claude Code / Codex / pi / omp / DSH / Cursor 等)を一つの設定で使う人と各ベンダーは、『特定の言語・パスのときだけ効く指示(Claude Code の `paths:` ルール、Cursor の `globs` ルールに相当)』を2026年にどう扱っているか — (a) 各ハーネスへ変換して届ける(変換ツール/自作注入)、(b) 共通の器(AGENTS.md、ネストAGENTS.md、skill)に畳んで条件付けを捨てる、(c) ハーネス固有の機能として片方だけに残す、のどれが業界で認められた型か。『良かれと思って自作した注入が裏目に出た』事例・警告はあるか。"
date: 2026-09-23
verdict: "三択のどれか一つが『業界の型』ではなく、階層になっている。ベース(c)はどの調査対象ハーネスでも維持されている――固有の条件付け機能(Claude Codeのpaths:、Cursorのglobs、ompのTTSR、DSHのdsh-agent-instructions)はどれも自分のハーネス上では自分の形のまま残る。2ハーネス以上に届けたい場合の実在する主流は(b)――AGENTS.mdのネスト配置に畳んで条件付けの表現力(任意globの1ファイル内条件)を捨てる――であり、ベンダー自身(Codexの公式docsが『上限に達したらネストディレクトリに分割せよ』と明記)・仕様(agents.md『最も近いファイルが優先』)・rulesyncの実装(globsをagentsmd.subprojectPathというネストAGENTS.md生成シグナルに変換)・実地のコミット(『Cursor rulesをAGENTS.mdへconsolidate』が複数の独立リポジトリで実行済み)の4方向が揃って裏付ける。(a)自作注入は技術的な口(CodexのhookSpecificOutput.additionalContext、piのtool_result content patch)としては存在するが、実際にそれを使って`paths:`相当を再現しようとした唯一の実測例(openai/codex issue #21675)は、Codexにネイティブの重複抑止が無いため同じルール本文(~10KB)を毎ターン再注入し続け、小規模プロジェクトで200KB超の冗長文脈を生んだ――自前でセッションキャッシュを実装してようやくClaude Codeの無料機能に追いついた、という文字通り『良かれと思って自作した注入が裏目に出た』事例。もう一件(issue #22861)は自作メモリプラグインがCodexの2,500トークン安全上限に黙って切り詰められ設計の前提が壊れた事例。さらにClaude Code自身のネイティブpaths:機能でさえ、ベンダー自身のissueトラッカーに『auto modeがBashを優先させるためpaths:が実質発火しない』(#93706)、『同一内容のルールファイルなのにパスによって登録されない』(#93435)、『excludeが無くnode_modules/distにも誤爆する』(#93249)という運用上の脆さが記録されている――自作するかどうか以前に、条件付き注入という設計そのものが年間を通じて壊れやすい領域だという警告になる。"
unverified:
  - "piでの自作additionalContext注入(tool_resultのcontent patch)の実地の成功/失敗事例 — 公式サンプルにも実地検索にも実装例が見つからず、良否を判定する材料自体が無い(前回記録から継承する欠落)"
  - "ompのTTSR globs+condition併用の実地失敗例 — zerx-lab/FluxDownとjoshuaswarren/remnicで実働例は確認できたが、失敗した事例は見ていない"
  - "DSHのdsh-agent-instructionsを使った複数ハーネス折り畳みの実地の成功/失敗事例 — README記述のみで、DSHを含む公開マルチハーネスリポジトリ自体が見つかっていない(既存記録から継承)"
  - "paths:条件ルール vs AGENTS.mdへの折り畳み vs skill化を、アウトカムやトークンコストで統制比較した測定 — どの調査記録にも存在しない"
  - "Cursor rules自体の公開issueトラッカー(closed-source、フォーラムのみ)での globs 誤爆報告 — フォーラムへの到達を試みていない"
sources_note: "URLとverbatim引用は本文中。直接fetchはdirect、要約経由の取得(WebFetchのサマライザ)はlaneと明記。gh API検索件数は上限値であって配線検証ではない(既存記録から継承する限界)。"
---

# 条件付きルール(`paths:`/`globs`)をクロスハーネスでどう届けるか — 2026年の業界実践

## 0. 前提として読んだ既存記録(再調査しない)

- `rules/research/2026-09-23-per-language-hooks-and-rule-delivery.md` §(d) — Claude Codeの`paths:`はv2.1.198+のネイティブ自動発火、ompの`globs`はadvisory止まり(TTSR併用で自動化可)、Codexのフックmatcherはツール名のみでパス条件が無い、pi公式サンプルはadvisory実装止まり、ネストAGENTS.mdが唯一の実在する横断代替という結論を既に確立済み。本記録はこれを覆さず、「では業界はこの4つの選択肢のうちどれを実際に選んでいるか」を問う。
- `rules/research/2026-09-23-path-rule-injection-seams.md` — 4ハーネスの(1)パス受信(2)文脈追加の口(3)重複抑止を精読済み。Codexの`hookSpecificOutput.additionalContext`が(2)の口として一次資料で確定していること、omp/DSHがネイティブに重複抑止を持つ一方Codex/piは自前実装が前提であることを既に確立済み。本記録の§3(測定)はこの「自前実装が前提」という結論の裏付け・実例(openai/codex #21675/#22861)を新たに提供する。
- `rules/research/2026-09-22-rulesync-function-read.md` — rulesyncの`globs`処理が(a)文字通りの変換(Cursorのalways Apply/globs、Claude Codeの`claudecode.paths`)と(b)ネストAGENTS.md生成シグナル(`agentsmd.subprojectPath`)の二重使いであることを既に精読済み。本記録の§2.1で再利用する。
- `rules/research/2026-09-22-industry-config-delivery.md` — AGENTS.mdが「実地で最も標準化された成果物」であることを複数の実在リポジトリ(anywhere-agents、domengabrovsek/agent-config、source-agents、sno-ai/mda等)で確立済み。ただしこの記録は「ルール本体の共有」を扱っており、「`paths:`のような条件付けをどうするか」までは踏み込んでいない――本記録が埋める。
- `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` 16行目 — 「`paths:`の条件付きルール(Codex・pi・DSHはフックで差し込む)」という一文が本記録の出発点の一つ。この一文が示す(a)案(フックで差し込む)が実際にどれだけ業界に根拠を持つかを、本記録が検証する。

## 現地事実(発注者から検証済みとして提供、再導出しない)

`domains/dev/llm/harness/rules/golang/`は5ファイル計232行、全て`paths: ["**/*.go", "**/go.mod", "**/go.sum"]`のフロントマターを持つ(direct、リポジトリ内)。`rules/typescript/`は5ファイル計402行、同様に`paths:`で`*.ts/*.tsx/*.js/*.jsx/*.mts/*.cts/package.json/tsconfig*.json`をゲートしている。一方`skills/golang-patterns/SKILL.md`(510行)は`paths:`を持たずjevの選択に委ねる設計で、`rules/golang/coding-style.md`や`patterns.md`と同じ主題(エラーラップ、インターフェース設計、ゼロ値、命名)を独立に教えている――実際に読み比べると、両者は同じ「Goのエラーハンドリングパターン」を別々の文書として持っている。`typescript`には対応するskillが存在しない(`skills/`配下に`typescript-patterns`ディレクトリは無い)。この非対称(Goは rules+skill の二重、TypeScriptは rules のみ)が、本記録の§6での「畳むとはこのリポジトリでは具体的に何を意味するか」の土台になる。

---

## 1. ベンダー

### 1.1 Cursor — globsは4モードのうちの1つ、`Agent Requested`はskill的な「モデルに選ばせる」を同じ器の中に持つ

(lane, https://cursor.com/docs/context/rules 経由WebFetch要約 — cursor.comへの308リダイレクト後に取得)

> 四つのルール適用モード: "Always Apply"(毎チャットに適用)/"Auto Attached (globs)"(ファイルがパターンに一致したとき)/"Agent Requested"(=「Apply Intelligently」、エージェントがdescriptionから関連性を判断したとき)/"Manual"(`@my-rule`で明示メンションしたとき)

> globsフィールドは "scope a rule to specific files or directories" と説明され、`src/**/*.tsx`のような例が挙がる。

> ネスト構造: "Cursor supports AGENTS.md in the project root and subdirectories." ネストされたファイルの指示は階層的に結合され「より具体的な指示が優先される」

**結論**: Cursor自身が「globsによるパス条件付け」を4つのモードのうち1つとして相対化しており、もう1つの`Agent Requested`はディスクリプションを見てモデル自身が判断する仕組み――Claude Codeのskill選択やこのリポジトリのjev選択と同じ発想を、Cursorは同じ`rules`という1つの器の中に共存させている。Cursorのドキュメントはポータビリティ(他ツールへの移植)について一切触れない[negative] — globs自体をCursor固有の機能として説明するだけで、他ハーネスとの互換性は視野に入っていない。

### 1.2 Claude Code memory docs — `paths:`はAGENTS.mdフォールバックには乗らない、`@AGENTS.md`インポートが「全ツール共通の1ファイル」への明示的な導線

(direct, https://code.claude.com/docs/en/memory)

`paths:`の仕様(既に前回記録で精読済み)に加え、本記録で新たに確認したのはAGENTS.md節との関係:

> "`paths` is the only field Claude Code reads from a rule; any other field is ignored without an error." — これは`.claude/rules/*.md`専用の記述で、AGENTS.md節にはpaths相当の条件付けへの言及が一切ない[negative]。

AGENTS.mdの読み込みは「At session start: every AGENTS.md and .claude/AGENTS.md in your working directory and the directories above it」「As Claude works in subdirectories: a subdirectory's AGENTS.md, when Claude opens a file there」――ディレクトリ単位の粗い条件付けはあるが、1ファイル内の任意globパターンではない。そして「全ツール共通の1ファイルにする」ための公式導線がある:

> "When Claude isn't reading your AGENTS.md directly, you can still keep it as the one file every tool shares by putting an `@AGENTS.md` import in a CLAUDE.md next to it." ... `ln -s AGENTS.md CLAUDE.md` という代替も明記。

**結論**: Claude Code自身が、「`paths:`の条件付けを保つ」道(`.claude/rules/`)と「他ツールと1ファイルを共有する」道(`@AGENTS.md`インポートまたはsymlink)を**別のメカニズムとして両立**させている――ベンダー自身が(b)の折り畳み(AGENTS.md共有)と(c)のハーネス固有維持(`.claude/rules/`のpaths:)を、二者択一ではなく併存可能な設計として提示している。ただし折り畳んだ側(AGENTS.md)にpaths:相当の条件付けは無い、という表現力の低下は明示されないまま。

### 1.3 Codex — 32 KiB上限、公式の解決策は「ネストディレクトリへ分割」であって条件構文ではない

(lane, https://learn.chatgpt.com/codex/agent-configuration/agents-md 経由WebFetch要約)

> "Codex skips empty files and stops adding files once the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)." ... "Raise the limit or split instructions across nested directories when you hit the cap."

条件付き/glob的な同一ファイル内スコープ機構への言及は無い[negative] — Codex公式が推奨する唯一の「スコープを絞る」手段はディレクトリ分割(=ネストAGENTS.md)であり、これは前回記録§1.7(ネスト連結、ルートからcwdまで全階層を連結)と整合する。Codexは条件構文を持たない代わりに、サイズ上限そのものが「分割せよ」という圧力になっている。

### 1.4 Anthropic Agent Skills — 移植可能なフィールドと移植不可能な拡張、`paths`はskillにも存在するが非移植

(lane, https://code.claude.com/docs/en/skills 経由WebFetch要約)

> "Claude Code skills follow the [Agent Skills](https://agentskills.io) open standard, which works across multiple AI tools."

移植可能(Agent Skills spec準拠)なフィールド: `name`/`description`/`license`/`compatibility`/`metadata`/`allowed-tools`。移植不可能なClaude Code拡張: `disable-model-invocation`/`user-invocable`/`context`(fork)/`agent`/`background`/**`paths`**/`shell`/`disallowed-tools`。

**結論**: `paths:`はrulesだけでなくskillのフロントマターにも存在するが、これもAgent Skills標準の一部ではなくClaude Code固有拡張――「skillが移植可能な器」という主張は、`paths:`条件付けそのものには及ばない。Skillという器を他ハーネスへ持っていっても、Claude Code上でだけ効いていた「このpathを開いたときだけ」という条件は、その移植では運ばれない。

### 1.5 OpenAI Codex Skills — `.agents/skills`は共有ディレクトリ、AGENTS.mdとは独立した器

(lane, https://learn.chatgpt.com/docs/build-skills 経由WebFetch要約)

> "Skills build on the [open agent skills standard]" ... "Codex scans `.agents/skills` in every directory from your current working directory up to the repository root."

skillとAGENTS.mdの使い分けについての明示的な比較記述は無い[negative] — ドキュメントはskillを「再利用可能なタスク手順」、AGENTS.mdを別の設定機構として並置するのみで、「`paths:`相当をどちらに持たせるべきか」への答えはベンダー側に無い。

### 1.6 まとめ(ベンダー4社+仕様1件の位置)

| ソース | 固有の条件付け機構 | 他ハーネスへの言及 |
|---|---|---|
| Claude Code | `paths:`(ネイティブ自動発火) | `@AGENTS.md`インポートで共有ファイルへの道を明示提供、ただしpaths相当は運ばれない |
| Cursor | `globs`(Auto Attached、4モードの1つ) | 言及なし |
| Codex | 無し(サイズ上限+ネスト分割が唯一の推奨) | AGENTS.md仕様自体がネスト前提 |
| omp | `globs`+TTSR `condition`(自動発火、advisoryとの二段) | GitHub Copilotの`applyTo`を`globs`に正規化して取り込む(他ベンダー形式の吸収はする) |
| Agent Skills標準 | `paths`はClaude Code拡張であり標準外 | — |

---

## 2. 実践者(named / in-the-wild)

### 2.1 rulesync(dyoshikawa)— 条件支援ターゲットには変換、非対応ターゲットにはネストAGENTS.mdへ畳む、の二本立てが実装そのもの

(前回記録から再利用、direct — `src/features/rules/rulesync-rule.ts`精読済み)

> `globs: string[]`は二通りに使われる — (a) ネイティブに条件付きルール適用をサポートするツールへのリテラルなglobメタデータとして渡す(Cursorの`alwaysApply`/`globs`、Claude Codeの`claudecode.paths`)、(b) ディレクトリネスト化のシグナルとして — `agentsmd.subprojectPath`が`globs: ["packages/api/**/*"]`を持つルールをディレクトリツリーを歩くツール向けの**ネストされた**`packages/api/AGENTS.md`に変換する

**結論**: rulesyncは(a)変換と(b)折り畳みの**両方**を実装しているが、どちらを選ぶかはターゲットの能力次第――ネイティブに条件付けを持つターゲット(Cursor、Claude Code)には(c)そのまま渡し、持たないターゲット(pi、DSH、Codex含む大多数)には(b)ネストAGENTS.md生成に自動的に切り替える。rulesyncのコードに**(a)自作フック注入**(Codex/piのhookでファイルパスを見てadditionalContextを条件付きで返す、という実装)は**存在しない**――前回記録(rulesync-function-read.md)がpi/DSHのhooks実装について確認した「pi hooksは生成TSコード、DSHはhooks機構自体が無い」という事実と符合し、rulesyncは「フックで差し込む」選択肢自体を実装していない。dyoshikawa(作者)個人の見解表明は見つからなかったが、コードの選択自体が最も強い証拠になっている。

### 2.2 jimCresswell/jimcresswell.net — 個人開発者による小規模な自作コンバータ、globs→pathsの変換とネスト化を両方実装

(direct, https://github.com/jimCresswell/jimcresswell.net/commit/ade5bd7134f72148f13f0c396b6d8013347818fd)

> コミットメッセージ: "feat(rules): generate the rules index and the rule adapters from each rule's frontmatter"

ルールを`classification`/`description`/`trigger`/任意の`globs`というfrontmatterで一度書き、`pnpm portability:fix`が`RULES_INDEX.md`・`.cursor/rules/`・`.claude/rules/`・`.agents/rules/`へ投影する。Claude向けにはpaths:リストが保持されるが、Cursor向けは`alwaysApply: true`に変換される(=Cursor側では条件付けを捨てて常時適用に倒す)、という非対称な扱いが確認できた。rulesyncの縮小版を個人が独立に再発明している例で、「(a)自作の変換ツール」自体は実在するが、これもフックでの動的注入ではなく**ビルド時の静的生成**である点はrulesyncと同型。

### 2.3 実地のコミット — 「Cursor rulesをAGENTS.mdへ畳む」が複数の独立リポジトリで実行されている

(direct, `gh api search/commits`、2026-09-23)

| リポジトリ | コミット | 内容(要約) |
|---|---|---|
| `xqe2011/saihub` | `chore: consolidate agent rules into AGENTS.md and drop local IDE configs` | "Move Cursor rules into AGENTS.md, remove committed .devcontainer/.vscode setup" |
| `tam159/next-role` | `docs: consolidate agent instruction files into AGENTS.md (#89)` | "docs: note AGENTS.md is unavailable on third-party providers" を含む、Claude Codeの機能ゲート状態への言及付き |
| `farisaziz12/portfolio-website` | `Add Cursor agent setup, PR screenshots, and lint ratchets (#28)` | "Consolidate scattered website docs into AGENTS.md, scoped Cursor rules/skills" |
| `LuizFernandoVieiraFerreira/housing-platform` | `docs: consolidate feature layers guide and slim AGENTS.md` | "cursor rules defer to" 別ファイルへの参照、AGENTS.mdは"quick reference"に縮小 |

`"cursor rules" "AGENTS.md" consolidate`の`gh api search/commits`は**1,380件**(上限値、word共起であって全件が同じ操作とは限らない)。方向はどれも「Cursor固有の条件付きルール → AGENTS.mdへ集約」で、逆方向(AGENTS.mdをCursor globsへ分解する)のコミットメッセージは検索した範囲で見つからなかった[negative, not exhaustive]。

### 2.4 omp TTSR globs+condition併用 — 前回記録の「未検証」が実地で確認できた(新規)

(direct, `raw.githubusercontent.com/zerx-lab/FluxDown/main/.omp/rules/no-unsafe-in-rust.md`)

```yaml
condition:
  - '\bunsafe\s*\{'
  - '\bunsafe\s+(fn|impl|trait|extern)\b'
astCondition:
  - 'unsafe { $$$BODY }'
globs:
  - native/**/*.rs
  - crates/**/*.rs
repeatMode: after-gap
repeatGap: 2
```

`globs`+`condition`+`astCondition`+`repeatMode`を全部併用する実働ルールファイル(Rustの`unsafe`使用を条件付きでブロック)が実際に稼働しているリポジトリで見つかった。`joshuaswarren/remnic`にも`.omp/rules/`配下に複数の同型ファイルがある。`gh api search/code`(`condition globs path:.omp/rules`)は60件――前回記録(path-rule-injection-seams.md)の「前例なし・未検証リスト」項目5「ompのTTSR実運用例は見ていない」を**本記録で解消する**。

### 2.5 実践者側での(a)自作フック注入 — Codexで実際にやって、失敗した例(次節で詳述)

§3で測定込みで扱う。実践者が意図的に「フックで差し込む」を選んだ実例は、rulesyncやjimCresswellの静的生成ではなく、openai/codex issue #21675の投稿者(実名は非公開だがコード・数値付きの一次報告)に限られた。

---

## 3. 測定された証拠(含む「自作注入が裏目に出た」事例)

### 3.1 Codex issue #21675 — `paths:`相当の自作フックが重複抑止を持たず、200KB超の冗長注入を生んだ

(direct, https://github.com/openai/codex/issues/21675, open, 2026年)

> "A common Codex hook pattern: `UserPromptSubmit` reads project rules (e.g. `.claude/rules/*.md` with `paths:` frontmatter — same convention Claude Code uses), matches them against paths mentioned in the user's prompt, and emits matched rule bodies as `hookSpecificOutput.additionalContext`."
>
> "**Problem: Codex re-injects the same rule bodies on every prompt.** If a user works on `apps/design/` for 20 turns, the same 5 rules (~10 KB of `additionalContext`) get re-injected 20 times. That's ~200 KB of redundant context for a small project — bigger projects easily exceed 1 MB per session."

投稿者はClaude Codeのネイティブ挙動(`InstructionsLoaded`イベント、`load_reason: nested_traversal | path_glob_match | session_start | compact`で「一度読み込んだら再発火しない」)と自分のCodexフックを直接比較し、自前の回避策を実装した数値を報告している:

> "We built a userland workaround: per-session cache file at `~/.codex/cache/<plugin>/<session_id>.json`, mtime-based invalidation, gitignore-semantics matching via the `ignore` library."
>
> | Turn | Action | additionalContext size |
> | 1 (cold) | `edit apps/design/foo.tsx` | **10,225 chars**(full rule bodies) |
> | 2 (warm) | `edit apps/design/bar.tsx` | **356 chars**(status only) |

**結論**: これは要求文が求める「良かれと思って自作した注入が裏目に出た」の典型例そのもの――Claude Codeの`paths:`と同じ発想(ファイルパスに応じてルール本文を注入する)をCodexのhookで再現しようとした結果、Codexにネイティブな重複抑止機構が無い(前回記録`path-rule-injection-seams.md`§1の結論と一致)ことが露呈し、セッションが長くなるほど線形に冗長文脈が積み上がった。投稿者は自前でキャッシュを実装してようやく「Claude Codeが無料で提供する挙動」に追いついた――これは(a)自作注入が技術的に可能(口はある)であることの実証であると同時に、その口だけでは不十分(重複抑止という書かれていない前提が抜け落ちる)ことの実証でもある。

### 3.2 Codex issue #22861 — 自作メモリプラグインがベンダーの安全上限に黙って切り詰められた

(direct, https://github.com/openai/codex/issues/22861, open, 2 comments)

> "Codex `0.130.0` appears to hard-limit hook-injected `additionalContext` to about 2,500 tokens per hook output. Larger hook context is written to a temp file and replaced in the model-visible context with a truncated preview"
>
> "If Codex silently replaces most of that context with a file path, the model no longer actually has the memory. It has to notice the path, decide to read it, and spend a tool call doing so. That changes memory from ambient context into an optional retrieval task, which is much weaker and less reliable."
>
> "I maintain a Codex long-term-memory plugin that injects cross-thread history and user facts through hooks, and reinjects memory after compaction. ... the new spilling behavior undermines the same use case"

**結論**: §3.1とは別の失敗様式――こちらは重複ではなく、ベンダー側の防御的な上限(2,500トークン)が自作注入の設計前提を無言で壊した例。`path-rule-injection-seams.md`が既に確認した`additionalContextLimit`(既定2,500トークン)の実害が、実地のissueとして裏付けられた。

### 3.3 Claude Codeのネイティブ`paths:`自体の脆さ — 自作かどうかを問わない、条件付き注入という設計そのものへの警告

(direct, `gh api search/issues` repo:anthropics/claude-code、2026-09-23)

| Issue | 状態 | 内容 |
|---|---|---|
| #93706 "Auto mode steers the model to Bash, which cuts path-scoped rules off at the knees" | open | "Path-scoped rules in `.claude/rules/` load on the Read tool and nothing else. Auto mode injects a system instruction telling the model to prefer Bash... So the rules mostly don't fire. I have a repo with five path-scoped rules... Across a long auto mode session not one of them loaded" |
| #93435 "A path-scoped rule file is never registered, while a byte-identical copy at any other path loads" | closed | "Reading a file its `paths:` globs match loads nothing from it, while four sibling rule files in the same directory load normally. A byte-identical copy of the same file at any other path loads correctly" |
| #93249 "Path-scoped rules and skills have no exclude field, so node_modules matches every extension glob" | open | "`paths: [\"**/*.ts\"]` ... matches `node_modules/**/*.d.ts`. Claude reads into node_modules regularly to check a library's types, and every one of those reads loads my house style rules" |

**結論**: これは(a)自作注入ではなく(c)ベンダーネイティブの`paths:`自体の話だが、要求文の「良かれと思って...裏目に出た」を一般化する重要な追加証拠になる――条件付き注入という設計は、自作かベンダー製かを問わず、①トリガー条件が他機能(auto mode)の変更で静かに無効化される、②同一内容でもパス依存の未知のバグで発火しないことがある、③除外パターンが無いため意図しないディレクトリにも誤爆する、という3種の壊れ方を持つ。jigが将来Codex/pi向けに(a)自作フック注入を実装するなら、Claude Code自身が抱えるこの3つの失敗様式を先に踏まえる必要がある。

### 3.4 `gh code search`によるin-the-wildの件数(2026-09-23、上限値)

| クエリ | 件数 |
|---|---|
| `path:.agents/skills filename:SKILL.md` | 347,648 |
| `paths path:.claude/rules extension:md` | 36,608 |
| `globs path:.cursor/rules extension:mdc` | 102,912 |
| `"cursor rules" "AGENTS.md" consolidate`(コミット検索) | 1,380 |
| `condition globs path:.omp/rules` | 60 |

**注意**: `code_search`インデックスはデフォルトブランチのみ、forkを除外、サイズ上限あり――既存記録が確立した限界を継承する。`.agents/skills`の件数の大きさは、skillという器自体の広い採用を示すのであって「`paths:`相当がskillに畳まれている」ことの直接証拠ではない――skillとrulesは別の質問である点に注意。

---

## 4. 実態(gh search、上記§2.3・2.4・3.4に統合済み)

重複を避けるため、実態調査の生データは§2.3(コミット検索)、§2.4(omp実働例)、§3.4(件数表)に統合した。追加で確認したのは以下。

- `filename:AGENTS.md path:.claude/rules`(370件)は「`.claude/rules/`配下に`agents.md`という名のファイルを置く」パターンであって、リポジトリルートのAGENTS.mdと`.claude/rules/`のpaths:を両方持つ構成の直接的な検出には至らなかった[inconclusive、クエリ設計の限界]。
- `paths:`条件ルールを持つリポジトリと`.agents/skills`を持つリポジトリの重なり(両方採用しているか)は個別に検証していない――件数の大きさの比較だけでは、同じリポジトリが両方を使っているのか、別々のリポジトリ群なのか区別できない[unverified]。

---

## 5. まとめの表

| 選択肢 | 誰が採っているか | 数値 | 既知の失敗様式 |
|---|---|---|---|
| (a) 各ハーネスへ変換して届ける(自作注入・hookベース) | Codex利用者の実地1例(issue #21675の投稿者)が`UserPromptSubmit`+`additionalContext`で自作。rulesyncやjimCresswellの「自作コンバータ」はビルド時静的生成であって動的フック注入ではないため、この選択肢には数えない | ~10KB×20ターン=~200KBの冗長注入(#21675)、2,500トークン上限による黙った切り詰め(#22861) | 重複抑止が無いと線形にコスト増(#21675)。ベンダーの安全上限に黙って壊される(#22861)。piでの実装例はゼロ(前回記録から継承) |
| (b) 共通の器(AGENTS.md)へ畳んで条件付けを捨てる | rulesync(`agentsmd.subprojectPath`)、jimCresswell(個人)、xqe2011/saihub・tam159/next-role・farisaziz12/portfolio-website(いずれも実コミット)、Codex公式docs(『ネストへ分割せよ』)、AGENTS.md仕様自体(『最も近いファイルが優先』) | consolidateコミット検索1,380件(上限値)。Codexのファイルサイズ上限32 KiB(project_doc_max_bytes) | 1ファイル内の任意glob条件という表現力を失う。ディレクトリ単位の粗い条件付けにしかならない(サブディレクトリの境界とファイル拡張子の境界が一致しない場合は再現できない) |
| (c) ハーネス固有のまま片方だけに残す | 全ハーネスがベースラインとしてこれを維持(Claude Codeのpaths:、Cursorのglobs、ompのTTSR、DSHのdsh-agent-instructions) | .claude/rules paths:採用36,608件、.cursor/rules globs採用102,912件(いずれも上限値) | 他ハーネスのユーザーには何も届かない(意図的にそれで構わない場合の選択)。ベンダーネイティブでも壊れる: auto modeとの非互換(#93706)、未知のパス依存バグ(#93435)、excludeフィールド欠如(#93249) |

---

## 6. 結論(平易な言葉で)

**三択のどれか一つが唯一の「業界の型」ではない。**むしろ「ハーネスが1つで完結するなら(c)のまま、複数ハーネスに届けたいなら(b)に畳む、(a)は理論上できるが実地でやってみた1件は失敗した」という順序が、集めた証拠から読み取れる実際の階層構造になる。

**(c)はどこでも維持される既定値。** Claude Codeのpaths:もCursorのglobsもompのTTSRも、それぞれのハーネス上ではそのまま動き続ける――他のハーネスと共有する必要が無いなら、これを崩す理由は無い。

**(b)が2ハーネス以上への配達で実際に選ばれている型。** ベンダー(Codexが『上限に達したらネストへ分割せよ』と明記)、仕様(agents.mdの『最も近いファイルが優先』)、コンバータの実装(rulesyncがglobsをネストAGENTS.md生成シグナルに使う)、実地のコミット(複数の独立リポジトリで『Cursor rulesをAGENTS.mdへconsolidate』が実行済み)の4方向が同じ方向を向いている。ただしこれは「畳む」であって「翻訳する」ではない――1ファイル内の任意glob条件という表現力そのものを失う取引だと、どのソースも隠さずに書いている(Claude Code自身の`paths:`ドキュメントも、AGENTS.md節にはpaths相当の記述を一切持たない)。

**(a)自作注入は口としては存在するが、実地でやった唯一の報告は裏目に出た。** Codexの`hookSpecificOutput.additionalContext`は文書化されており、技術的には`paths:`相当をCodex上で再現できる。しかし実際にそれをやった報告(openai/codex #21675)は、Claude Codeがネイティブに持つ「一度読んだら再発火しない」という重複抑止をCodexが持たないことに気づかないまま実装し、セッションが長くなるにつれて線形に冗長な文脈(小規模プロジェクトで200KB超)を積み上げてしまった。投稿者は自前でセッションキャッシュを実装してようやく追いついた――これは「良かれと思って自作した注入が裏目に出た」の名前と数値がついた実例であり、config-layout決定の16行目が書いた「Codex・pi・DSHはフックで差し込む」という一文を、無条件には支持できない具体的な理由になる。もう1件(#22861)は、自作注入がベンダー自身の安全弁(2,500トークン上限)に黙って壊された例で、こちらは「重複抑止を自分で書けば防げる」種類の問題ではなく、ベンダーの設計思想(注入は小さく保つべきという前提)と利用者の設計思想(注入は大きくても構わないという前提)の衝突そのものが失敗様式になっている。

**ネイティブの`paths:`自体も、自作かどうかを問わず脆い。** Claude Code自身のissueトラッカーは、ベンダー機能である`paths:`がauto modeという別のベンダー機能によって実質無効化される事例(#93706)、同一内容のファイルがパス依存の未知の理由で発火しない事例(#93435)、除外構文が無いためnode_modules/distにも誤爆する事例(#93249)を記録している。これは(a)(b)(c)いずれを選ぶ場合にも共通する警告――「条件付きで文脈を注入する」という設計そのものが、実装者が自作かベンダーかを問わず壊れやすい領域だということ。

**このリポジトリで「畳む」とは具体的に何を意味するか。** `rules/golang/`(5ファイル232行、全て`paths:`ゲート)は`skills/golang-patterns/SKILL.md`(510行、jev選択)と主題が重なっている(エラーラップ、インターフェース設計を両方が独立に教えている)。config-layout決定は既に「ルールはpaths:、スキルはjevの選択」という二本立てを採用しており、これは本記録の(b)vs(c)の緊張そのものがこのリポジトリの中に既に存在することを意味する――Goのルールをskillへ畳めば、`paths:`の「その言語のファイルを読んだ瞬間だけ効く」という保証を失い、jevが「関連しそうだと判断したときだけ」に置き換わる(前回記録`skill-router-6pct.md`が既に指摘した「skill追従率6%」問題と直結する取引になる)。一方TypeScriptには対応するskillが無いため、TypeScriptのルールを畳むのは重複削減ではなく新規作業になる――Go側とTypeScript側で「畳む」の意味とコストが違う、という点はこのリポジトリ固有の事実として記録しておく。

---

## 7. 前例なし・未検証のリスト

1. piでの(a)自作`tool_result` content patchによる`paths:`相当の実装――成功例も失敗例も見つからなかった。判定材料自体が存在しない。
2. ompのTTSR `globs`+`condition`併用の失敗例――§2.4で実働例2件(zerx-lab/FluxDown、joshuaswarren/remnic)は見つかったが、壊れた事例は探索していない。
3. DSHの`dsh-agent-instructions`を使った複数ハーネス折り畳みの実地の成功/失敗事例――DSHを含む公開マルチハーネスリポジトリ自体が見つかっていない(既存記録から継承する欠落)。
4. `paths:`条件ルール vs AGENTS.mdへの折り畳み vs skill化を、アウトカムやトークンコストで統制比較した測定――四つの調査記録(本記録含む)のどれにも存在しない。純粋な設計選好の議論はあっても、測定は無い。
5. Cursor rules自体の公開issueトラッカー(closed-sourceのためフォーラムのみ)でのglobs誤爆報告――フォーラムへの到達を試みていない。
6. 「AGENTS.mdをCursor globsへ分解する」逆方向のコミット――検索した範囲(1,380件のword共起検索)では見つからなかったが、網羅的な探索ではない。

---

## 出典一覧(直接引用・直接参照したURL)

- Claude Code memory(`paths:`、AGENTS.md節、`@AGENTS.md`インポート、症状の表): https://code.claude.com/docs/en/memory (direct)
- Claude Code skills(移植可能フィールド、`paths`の非移植拡張扱い): https://code.claude.com/docs/en/skills (lane)
- Cursor rules(4モード、globs、ネストAGENTS.md): https://cursor.com/docs/context/rules (lane)
- Codex AGENTS.md(32 KiB上限、ネスト分割推奨): https://learn.chatgpt.com/codex/agent-configuration/agents-md (lane)
- Codex build-skills(`.agents/skills`共有ディレクトリ): https://learn.chatgpt.com/docs/build-skills (lane)
- AGENTS.md仕様(ネスト、最も近いファイルが優先): https://agents.md/ (lane)
- openai/codex issue #21675(自作additionalContext注入の重複抑止欠如、実測数値): https://github.com/openai/codex/issues/21675 (direct)
- openai/codex issue #22861(2,500トークン上限による自作メモリプラグイン破壊): https://github.com/openai/codex/issues/22861 (direct)
- anthropics/claude-code issue #93706(auto modeとpaths:の非互換): https://github.com/anthropics/claude-code/issues/93706 (direct)
- anthropics/claude-code issue #93435(パス依存の未登録バグ): https://github.com/anthropics/claude-code/issues/93435 (direct)
- anthropics/claude-code issue #93249(excludeフィールド欠如): https://github.com/anthropics/claude-code/issues/93249 (direct)
- jimCresswell/jimcresswell.net commit ade5bd7(個人の自作ルールコンバータ): https://github.com/jimCresswell/jimcresswell.net/commit/ade5bd7134f72148f13f0c396b6d8013347818fd (lane)
- xqe2011/saihub、tam159/next-role、farisaziz12/portfolio-website、LuizFernandoVieiraFerreira/housing-platform の各コミット(`gh api search/commits`経由): https://api.github.com/search/commits (direct、API結果)
- zerx-lab/FluxDown `.omp/rules/no-unsafe-in-rust.md`(TTSR globs+condition+astCondition実働例): https://raw.githubusercontent.com/zerx-lab/FluxDown/main/.omp/rules/no-unsafe-in-rust.md (direct)
- 現地事実確認: `domains/dev/llm/harness/rules/golang/`, `domains/dev/llm/harness/rules/typescript/`, `domains/dev/llm/harness/skills/golang-patterns/SKILL.md` (direct、リポジトリ内)
- 前提として再利用した既存記録: `rules/research/2026-09-23-per-language-hooks-and-rule-delivery.md`, `rules/research/2026-09-23-path-rule-injection-seams.md`, `rules/research/2026-09-22-rulesync-function-read.md`, `rules/research/2026-09-22-industry-config-delivery.md`, `rules/decisions/2026-09-22-config-layout-no-personal-layer.md`
