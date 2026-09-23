---
question: "コーディングエージェントのハーネス(Claude Code / Codex / pi / omp / DSH)で、言語ごとの整形・lint・型検査をフックでどう回すのが2026年の業界の型か — (a) ハーネス側の言語→コマンド対応表を持つのか、プロジェクト自身の設定(biome.json、pyproject、lefthook/pre-commit、package.jsonのscripts、mise tasks)を検出してそれを呼ぶのか、(b) 編集ごとに走らせるもの(整形)と応答の終わりに走らせるもの(型検査・lint・テスト)の線引きは言語ごとに違うか、(c) CSS/HTML(stylelint/html-validate)やGoのstaticcheck/raceのような『整形でも型検査でもない検査』はどこに置くか。またClaude Codeの`paths:`付き条件ルールに相当するものを、ネイティブに持たないハーネス(Codex・omp・pi・DSH)へ届ける実践はあるか。"
date: 2026-09-23
verdict: "(a) 業界の主流は二層――ハーネス側は『どの言語かを見て、その言語の標準ツールを1つ呼ぶ』という薄い対応表だけを持ち(prettier/biome/ruff/gofmt/rustfmt をPostToolUseに直書きする形が公開リポジトリの数で圧倒的多数)、コマンドの中身(どのルールを適用するか)はプロジェクト自身のbiome.json/pyproject.tomlにツール自身が委ねる。『何のコマンドを呼ぶか』まで完全にプロジェクトに預ける実践(pre-commit run --files / lefthook run)は実在し大規模リポジトリにもあるが少数派。(b) 線引きは言語ではなくツールの速度で決まる――ruff(format+check)やgofmt/rustfmtのように1ファイルを数十ms未満で処理できるツールは整形も軽lintも編集ごとに置かれ、tsc/mypy/pyright/eslintのようにプロジェクト全体を読むツールはStopに置かれる。Rust/Goは整形(rustfmt/gofmt)と基本チェック(cargo check/go vet)がその境界で綺麗に割れるが、Pythonはruffが速いため整形とlintの両方が編集ごとに来ることがある。(c) staticcheck・cargo clippy・race detector・stylelint・html-validateのような『重い/任意の』検査は、編集ごとにもStopにも自動配線されない第三の置き場――エージェントがBashで呼べる許可リストに入れるだけ、または人間がCIで見る――が実測された最頻パターンで、まれにStopへ足す例もあるが0〜13スターの小規模リポジトリに偏る。stylelintはPostToolUseに乗る例が105件あるがhtml-validateは11件と一桁少ない。(d) Claude Codeの`paths:`はベンダーが2.1.198以降実装するネイティブ機能で「一致するファイルを読んだときに発火し、毎ツール呼び出しではない」と文書化されている。omp"nativeルール"も同じ`globs`フィールドを持つが、それだけでは自動発火せず"advisory"(モデルがrule://で明示的に読むまで一覧に載るだけ)――omp公式のTTSR機構でcondition(正規表現/ast-grep/question)を併用したときだけ自動発火する。Codexのフックmatcherはツール名のみでファイルパスに対応せず、pi公式サンプル(claude-rules.ts)もpaths:相当を『一覧化して読ませる』advisory実装に留まる――DSHは未調査。『フックで文脈に差し込む』は理論上pi(tool_callがpathを受け取れる)では可能だが実例は見つからず、『AGENTS.mdに畳む』はrulesyncが`globs`をネストAGENTS.mdの生成シグナルとして使う実装を公開しており、AGENTS.md仕様自体も『最も近いファイルが優先』を明記している――こちらが実在する移植先。"
unverified:
  - "DSHのpaths:相当メカニズムは未調査(DSHの公開docsに到達できず、hooks-five-eventsの決定記録もDSHの詳細を空欄にしている)"
  - "編集ごとlintのトークン/レイテンシをA/B統制で測った例はどの言語についても見つからなかった(2026-09-22 format-hook-timing.mdの既知の欠落を継承)"
  - "stylelint/html-validateのPostToolUse実例のうち何件が実際に動いているか(vs 死んだ設定)は個別検証していない――gh code searchのpath:.claude語句一致カウントは上限にすぎない"
  - "omp TTSRのcondition+globs併用によるパス限定自動発火を、実際に動かして確認していない(docsの記述のみ)"
sources_note: "URLとverbatim引用は本文中。直接fetchはdirect、要約経由の取得はlaneと明記。"
---

# 言語ごとのフック分担と`paths:`相当の配達 — 2026年の業界調査

前提として読んだ既存記録(再調査しない):

- `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` — WHEN(整形は編集ごと無音、型検査/lintはStopの関門)は既に裁定済み。本記録はWHAT(言語ごとに何を走らせるか)とWHO(ハーネスかプロジェクトか)を扱う。
- `rules/research/2026-09-22-format-hook-timing.md` — WHENの一次調査。marmelabのA→B→gated-C移行、Claude Codeのmtime衝突バグ族(#3513等)、`gh search code`によるPostToolUse/Stopの実地件数はここで確立済みなので再掲のみ引用する。
- `rules/decisions/2026-09-22-hooks-five-events.md` — フックは5イベントに畳む方針。監査・予算・固定注入は対象外。
- `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` — 16行目:「`paths:`の条件付きルール(Codex・pi・DSHはフックで差し込む)」と一度だけ触れているが設計はまだない、という宣言が本記録の出発点。
- `rules/research/2026-09-22-rulesync-function-read.md` — rulesyncのpaths:/globs実装(`claudecode.paths`エスケープハッチ、`agentsmd.subprojectPath`によるネストAGENTS.md生成)を既に精読済み。本記録は(d)でこれを再利用する。
- `rules/research/2026-09-22-omp-hook-surface.md` — omp v.s. Claude Codeのフック面の差は精読済み。本記録はompの"rules"機構(`globs`/TTSR)を新たに掘った。

現地事実(再導出しない、発注者から検証済みとして提供): jigの`format.ts`はts/js/json/css→biome-or-prettier、`.go`→gofmt、`.py`→ruff format、`.rs`→rustfmtの直書きswitch。`gate.ts`はプロジェクトマーカーで`tsc --noEmit`/`go vet ./...`/`ruff check .`/`cargo check`のどれか1つをcwdで選ぶ直書きswitch。C++/C#/Java/Kotlin/Perl/PHP/Swift/SCSS/HTMLは無音でスキップ。退役したyokiフックは編集ごとの`go vet`+`staticcheck`、Stop時の`go test -race`、編集ごとの`ruff check`、eslint/oxlintの段階、stylelint/html-validateを持っていたが、jigはこれらを持たない。

追加で確認した現地事実(本調査で発見、既存記録にない):

- jigの`gate.ts`はプロジェクトの`package.json`/`lefthook.yml`/`.pre-commit-config.yaml`を一切読まない。マーカーは`tsconfig.json`/`go.mod`/`pyproject.toml`/`ruff.toml`/`.ruff.toml`/`Cargo.toml`のみで、「プロジェクトが自分の検査コマンドを持っているかどうか」を見る発想がそもそも入っていない。これは(a)で「ハーネス側対応表」型に完全に振っていることを意味する。
- jigの`format.ts`は`biome.json`の**存在**だけを見てbiome/prettierを切り替える(`root`のbiome.jsonを`exists`で判定)――これは「対応表の中に軽い検出を1個混ぜる」ハイブリッドで、後述する業界の主流パターンと一致する。
- `apply-omp.ts`のコメント(direct, ソースコード)に「Skills and the instructions file reach omp natively (`~/.agents/skills`, `~/.claude/CLAUDE.md`); the conditional `paths:` rules do not reach omp in this milestone, and the dry-run names that gap.」――jig自身がomp向けpaths:配達の欠落を認識済みで、未実装であることをコード内コメントで明言している。
- `catalog.ts`(jig, direct)の`paths:`パーサーはSKILL.mdのフロントマター用で、rules用ではない。rules用の`paths:`はClaude Code向けに`.claude/rules/*.md`をそのまま`planRulesDir`でmanaged-dirコピーするだけ(`apply-claude.ts`)――**paths:の実際のマッチングと発火はjigのコードではなくClaude Codeランタイム自身が行っている**。jigは翻訳していない、単にファイルを置いているだけ。

---

## 1. ベンダー

### 1.1 Claude Codeの`.claude/rules/` `paths:`――ネイティブ機能、advisoryではない

(direct, https://code.claude.com/docs/en/memory)

> Rules can be scoped to specific files using YAML frontmatter with the `paths` field. These conditional rules only apply when Claude is working with files matching the specified patterns.

> Rules without a `paths` field are loaded unconditionally and apply to all files. **Path-scoped rules trigger when Claude reads files matching the pattern, not on every tool use.** As of v2.1.198, matching also works when Claude reaches a file through a symlinked path to the project directory, for example in a symlinked checkout.

パターン予算の上限も明記:

> a rule's whole `paths` list shares one budget of 1,000 expanded patterns and 4 MiB, and patterns without braces don't count against it. ... Before v2.1.217, a `paths` value with many brace groups stalled or crashed the CLI at startup.

サイズ指針とルールの使い分け:

> Rules load into context every session or when matching files are opened. For task-specific instructions that don't need to be in context all the time, use [skills] instead, which only load when you invoke them or when Claude determines they're relevant to your prompt.

**結論**: `paths:`はjigやこのリポジトリの発明ではなく、Claude Code自身のランタイム機能(v2.1.198+)。マッチングはClaude Code内部の「ファイルを読んだ」イベントに乗る自動発火で、モデルの自由意志に頼らない。これが以降の(d)比較の基準線になる。

### 1.2 lefthook / pre-commit / mise — 「プロジェクトが自分のコマンドを持つ」層のベンダー側自己定義

**pre-commit** (lane, https://pre-commit.com/) — フックの選択はプロジェクトの`.pre-commit-config.yaml`が持ち、`pre-commit run --files <FILES>`で特定ファイルだけに対して実行できる。ドキュメントの例:

> `git ls-files -- '*.py' | xargs pre-commit run --files`: run all hooks against all `*.py` files in the repository.

外部の呼び出し元(エージェント含む)が個別ファイルに対して「プロジェクトが定義した通りの」フォーマッタ/リンタを実行できることをドキュメント自身が示している。CIでの利用も明記されるが、単一ファイル実行の速度についての言及は無い。

**lefthook** (lane, https://lefthook.dev/) — 404だったトップページの代わりを読んだ結果、`lefthook run {hook-name}`の存在は確認できたが、単一ファイル実行やエージェントからの呼び出しについての文章は見つからなかった [not found、not absent]。

**mise tasks** (lane, https://mise.jdx.dev/tasks/) —

> "A task is a named command or script that runs with your project's tools and environment variables." ... "Use tasks for builds, tests, linters, development servers, and other commands you want teammates and CI to run consistently."

`mise run format`のように名前で呼ぶ設計で、ハーネス側は「`mise run <task>`を呼ぶ」ことだけを知っていればよく、taskの中身(何を整形するか)はプロジェクトの`mise.toml`が持つ。ドキュメントはCI利用を明記するが、コーディングエージェントからの呼び出しへの言及はない。

**結論**: 3ツールとも「プロジェクトが自分のコマンドを定義し、呼び出し元は名前だけ知っていればいい」という設計思想をベンダー自身が明言している。ただしどのツールも「コーディングエージェントのPostToolUseフックから呼ぶ」という用途をドキュメントで想定していない――業界の実践(§3)が先に進んでいて、ベンダードキュメントが追いついていない領域。

### 1.3 フォーマッタ・リンタ自身の「設定検出」と速度の公開数値

- **Biome**(lane, https://biomejs.dev/, https://biomejs.dev/guides/configure-biome/) — 設定ファイル自動探索: "Biome attempts to discover the configuration file in the following order: 1. The current working directory[,]" 続けて親ディレクトリ・ホームディレクトリへ遡る。速度: **"~35x faster than Prettier when formatting 171,127 lines of code in 2,104 files"**、"97% compatibility with Prettier"。CSS/HTML対応: "Formatter supports: JavaScript, TypeScript, JSX, TSX, JSON, HTML, CSS, and GraphQL"。
- **Oxlint**(lane, https://oxc.rs/docs/guide/usage/linter.html) — "Our benchmarks show Oxlint is 50 to 100 times faster than ESLint." ESLint設定の自動読み込みは明言されず、`@oxlint/migrate`で変換する別ツールが要る。
- **Stylelint**(lane, https://stylelint.io/) — "A mighty CSS linter that helps you avoid errors and enforce conventions." 整形は主目的でないと自認: "We recommend using a pretty printer like Prettier alongside Stylelint. Linters and pretty printers are complementary tools that work together..." — つまりstylelintは`(c)`の「整形でも型検査でもない検査」の代表例だとベンダー自身が位置付けている。
- **html-validate**(lane, README, https://github.com/html-validate/html-validate) — "Offline HTML5 validator. Validates either a full document or a smaller (incomplete) template..." フォーマッタでもリンタでもなく検証器(validator)という第三分類を自称。エディタ/CI/pre-commitへの優先順位の言及なし。
- **staticcheck**(lane, https://staticcheck.dev/docs/) — "Just run `staticcheck ./...` on your code **in addition to** `go vet ./...`"(`go vet`の代替ではなく追加)、"It's the ideal candidate for running in CI without risking spurious failures."、"can be used from the command line, in CI, and even directly from your editor" — ベンダー自身がCI/エディタを主戦場と位置付け、コーディングエージェントのStopゲートへの言及はない。race detectorへの言及は見つからなかった。

**結論**: (c)の検査群(stylelint/html-validate/staticcheck)はベンダー自身が「フォーマッタでもtypecheckerでもない、CI/エディタ向けの第三分類」だと自認している。これはjigのgate.tsが型検査4種のみを対象にしている設計と整合する――ベンダーの自己定義がすでに「これらは整形/型検査ループの外」と言っている。

### 1.4 Codex hooksのmatcherはファイルパスを見ない

(direct, https://learn.chatgpt.com/docs/hooks 経由WebFetch要約 — lane扱い)

> "Only some current Codex events honor `matcher`" — PreToolUse/PostToolUseはツール名(`Bash`, `apply_patch`, `Edit|Write`)のみでフィルタ可能。UserPromptSubmit/Stop/Interruptは"not supported"。ファイルパス/globでのフィルタ機構はどのイベントにも存在しない。

これは`2026-09-22-format-hook-timing.md`の§1.2(Codexのhooks docに`matcher`の`tool_name`のみが載っている)と一致する追加確認で、Claude Codeの`paths:`に相当するネイティブ機構がCodexには存在しないことを直接裏付ける。

### 1.5 omp — 独自の"globs"付きルール機構はあるが、既定はadvisory

(direct, `raw.githubusercontent.com/can1357/oh-my-pi/main/docs/context-files.md` と `docs/rulebook-matching-pipeline.md`)

ompの`native`プロバイダは`.omp/rules/*.{md,mdc}`にClaude Codeと**同じフィールド名**`globs`を持つルールファイルを置ける。GitHub Copilotの`.github/instructions/*.instructions.md`の`applyTo`フィールドも同じ`globs`に正規化して取り込む:

> GitHub's `applyTo` is additionally normalized as follows: a comma-separated string (or tolerated YAML array) becomes `globs`; `*`, `**`, or `**/*` makes the rule always-apply and clears `globs`; any other glob makes the rule non-always-apply...

しかし発火の仕方はClaude Codeと違う。`globs`だけを持つルールは"rulebook"バケツに入り:

> Rulebook bucket: must have description, must not be TTSR, must not be `alwaysApply`. Listed in system prompt by name+description; content read on demand via `rule://`.
>
> `globs` ... Not used to automatically select rulebook rules for `rule://`; **rulebook matching remains advisory prompt behavior.**

自動発火(Claude Codeの"trigger when a matching file is read"相当)に近づけるには、omp独自のTTSR(Time Traveling Stream Rules)機構で`condition`(正規表現)/`astCondition`(ast-grep)/`question`のいずれかを併用する必要がある。ドキュメントは`condition`欄にファイルglob風の値を書くと自動変換される特殊挙動も明記する:

> Important caveat: `condition` values that look like file globs are converted into `tool:edit(...)` / `tool:write(...)` scope shorthands with catch-all condition `.*`.

**結論**: ompはClaude Codeより**語彙は先取り**している(`globs`という同名フィールド、GitHub Copilotの`applyTo`変換まで内蔵)が、素の`globs`だけでは自動発火せずadvisoryに留まる――Claude Codeの`paths:`の自動発火に相当させるにはTTSRのcondition欄を併用する追加の一手間が要る。これは"フックで差し込む"よりは軽いが、"ネイティブでそのまま使える"とも言い切れない中間の答え。config-layout決定がompをCodex/pi/DSHのグループから外して言及しなかったのは、この非対称性(omp独自の近い機構がある)と符合する。

### 1.6 pi — 公式サンプルはadvisory実装、pathマッチの土台コードはある

(direct, `earendil-works/pi` リポジトリ)

公式example拡張`claude-rules.ts`(`.claude/rules/`をスキャンしてシステムプロンプトに一覧を注入する実装)のコード内コメント:

> Use conditional rules sparingly: Only add paths frontmatter when rules truly apply to specific file types

しかし同じ拡張の実装自体は`paths:`フロントマターを一切パースしない。`session_start`でファイル一覧を集め、`before_agent_start`でファイル名の一覧だけをシステムプロンプトに足し、「関連しそうならreadツールで読め」とモデルに委ねる:

```
return {
  systemPrompt: event.systemPrompt +
    `## Project Rules
     The following project rules are available in .claude/rules/:
     ${rulesList}
     When working on tasks related to these rules, use the read tool to load the relevant rule files for guidance.`
};
```

一方、同リポジトリの別サンプル`protected-paths.ts`は`tool_call`イベントで`event.input.path`を受け取り、パス文字列マッチでブロックする実装を示している:

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
  const path = event.input.path as string;
  const isProtected = protectedPaths.some((p) => path.includes(p));
  if (isProtected) return { block: true, reason: `Path "${path}" is protected` };
  return undefined;
});
```

**結論**: piの`tool_call`イベントはファイルパスを受け取れる――技術的にはglobマッチで`additionalContext`相当を注入する拡張は書ける(config-layout決定が言う「フックで差し込む」はここでは実装可能)。しかしpi公式自身のサンプル集(90超のexample、`2026-09-22-format-hook-timing.md`で既に精読済み)にそれを実装した例は無く、公式の`paths:`相当サンプルはadvisory(一覧化してモデルの判断に委ねる)止まり。「フックで差し込む」はpiでは**理論的に可能だが実例のない**選択肢。

### 1.7 AGENTS.md仕様 — ネスト構造がベンダー横断の"パス限定"の代替経路

(direct, https://agents.md/ 経由WebFetch要約 — lane扱い)

> "Agents automatically read the nearest file in the directory tree, so the closest one takes precedence"

仕様は60,000超のOSSプロジェクトが採用していると主張し、対応ツール一覧にOpenAI Codex, Google Jules, Aider, Goose, OpenCode, Zed, Cursor, Gemini CLI, GitHub Copilot Coding Agent等を挙げる。omp独自の`agents-md`プロバイダ(§1.5, `context-files.md`)も「standalone AGENTS.md files, discovered by walking up from the current directory to the repository root」と同じ挙動を実装している。

**結論**: `paths:`の1ファイル内glob条件とは違うが、「ディレクトリごとにAGENTS.mdを分割して置く」ことでほぼ同じ効果(ディレクトリ配下でだけ有効な指示)をベンダー横断で得られる、という代替経路がAGENTS.md仕様自体に明記されている。

---

## 2. 実践者(named practitioners)

### 2.1 ハーネス側対応表を直書きする側

`2026-09-22-format-hook-timing.md` §3.1で既に精読済みの実例を再掲(既存記録の引用のみ、再調査なし):

- `anthropics/claude-code-action`(8,921★, Anthropic自身のリポジトリ)— `bunx prettier@3.5.3 --no-config --write .`をEdit|Write|MultiEditで直書き
- `wealthfolio/wealthfolio`(9,019★)— `.rs`→rustfmt、`.ts/tsx/js/jsx/css/md`→prettierのインラインcase分岐
- `streamlit/streamlit`(45,812★)— `post_edit_autofix.sh`: `.py`のみ`uv run ruff check --fix` + `ruff format`、コメント "any additions must be very fast since this runs on every file edit/write"

### 2.2 プロジェクトの検査ツール(pre-commit)に委ねる側

新規に確認(本調査):

- **dragonflydb/dragonfly**(31,664★, 2026-09-23プッシュ、直近アクティブな大規模Redis互換DB)— `.claude/hooks/format-after-edit.sh`(direct, raw fetch):
  ```bash
  # Run pre-commit on the file
  pre-commit run --files "$FILE_PATH"
  # Always exit 0 to not block the operation even if formatting fails
  exit 0
  ```
  フックのコード自体は言語を一切知らない。`src/redis`配下だけ除外する以外、判断は全部`.pre-commit-config.yaml`任せ。
- **ray-project/ray**(43,903★)— `.claude/skills/lint/SKILL.md`(direct):
  ```
  Run pre-commit on the files you changed:
  pre-commit run --files $(git diff --name-only HEAD)
  ```
  こちらはフック(自動)ではなくSKILL(エージェントが判断して呼ぶ、on-demand)――変更されたファイル**全部**をまとめて1回渡す設計で、「編集ごと」ではなく「タスクの区切りごと」に相当する。RayはPythonの`ruff`設定を`pyproject.toml [tool.ruff]`に持ち、除外リストも`pyproject.toml`の`per-file-ignores`/`extend-exclude`任せ――ハーネス側は何も知らない。

`gh code search`の粗い件数比較(word共起カウント、上限値として扱う):

| クエリ | 件数 |
|---|---|
| `"pre-commit run --files" path:.claude` | 186 |
| `"lefthook run" PostToolUse path:.claude` | 4 |
| `"mise run" PostToolUse path:.claude` | 85(ただし大半はSKILL.md/CLAUDE.md内の指示文で、実際のフック自動配線ではない) |
| (参考、既存記録より)`PostToolUse prettier filename:settings.json` | 1,724 |

**結論**: プロジェクト検出型(pre-commit/lefthook/mise)は実在し、dragonflydb(3万★超、フック自動実行)とray-project(4万★超、SKILL経由でオンデマンド)という大規模リポジトリの実例が見つかったが、件数比較では直書き型が一桁多い。両者は共存可能な設計(dragonflydbのように「フックの中でpre-commitを呼ぶ」ことで、ハーネス対応表とプロジェクト検出のハイブリッドになる)。

### 2.3 「重い検査」の置き場所――実践者2例の対比

- **lookatitude/beluga-ai**(13★, Go, direct raw fetch)— `permissions.allow`に`Bash(staticcheck:*)`, `Bash(golangci-lint:*)`, `Bash(gosec:*)`, `Bash(govulncheck:*)`を並べ、エージェントが**任意に呼べる**状態にする一方、自動フックは`PostToolUse`が`gofmt -w`のみ、`Stop`が`go vet ./...`のみ。staticcheckは自動配線されていない――許可はするが強制しない、という第三の層。
- **tilsley/loom**(0★, Go, direct raw fetch)— `Stop`フックが`.claude/hooks/go/stop-check.sh`を呼び、その説明に"Block agent finishing if go vet / staticcheck errors exist in touched packages"とある。staticcheckをStopに含める例は実在するが、見つかったのはスター0の個人リポジトリのみ。

`go test -race`は`gh code search`で2,088件ヒットしたが、開いたサンプルはすべて`docs/`, `rules/`, `skills/`配下の**指示文**(エージェントに「テストは`-race`付きで走らせろ」と教える)であり、PostToolUse/Stopの自動フックとして直書きされた例は見つからなかった [negative, but not exhaustively searched]。

**結論**: staticcheck/clippy/race detectorのような「重い/任意の」検査は、(1)許可リストに入れてエージェントの裁量に委ねる、(2)指示文(AGENTS.md/skill)で「これも走らせろ」と教える、の2つが実測された主要パターンで、(3)Stopフックに自動配線する例は存在するが低星リポジトリに偏る。marmelabの既存記録(§2.4 in format-hook-timing.md)が示した「Stopフックの空回りが60〜150秒/回のコスト」という実測は、まさにこの種の重い検査をStopに入れることへの警告として機能する。

---

## 3. 測定された証拠

`2026-09-22-format-hook-timing.md`から再掲(既存の実測、再調査しない):

- marmelabの記録: 編集ごとprettierフックで"Edit→prettier loop cost 4+ min twice"、Stopフックの空回りで"bloated wall-clock by 60-150s per pause"、Stopフックのループで"35k tokens of pure post-completion spin"(#78121)。
- Claude CodeのEdit/Write mtime衝突: 1ユーザーで3週間に22セッションがヒット(#3513コメント)、別ユーザーで2,280 Edit中29件(1.3%)がmodified-since-read失敗(#76361)。

新規に確認した速度の公開数値(本調査、vendor自己申告、統制比較ではない):

- Biome: "~35x faster than Prettier when formatting 171,127 lines of code in 2,104 files"(biomejs.dev, lane)
- Oxlint: "50 to 100 times faster than ESLint"(oxc.rs, lane)
- Claude Codeのフックタイムアウト既定値(direct, https://code.claude.com/docs/en/hooks 経由要約): "Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`. Claude Code lowers the `command`, `http`, and `mcp_tool` default to 30 on `UserPromptSubmit`, `PreModelSwitch`, and `PostModelSwitch`, and to 10 on `MessageDisplay`." — PostToolUse/Stopは600秒の余裕があり、eslintのコールドスタートやclang-tidyのような重いリンタでもタイムアウト自体が編集ごとの障害になる可能性は低い(トークン/UXコストは別問題)。

**欠落**(既存記録から継承、再確認): 編集ごと整形/lintの言語別レイテンシをA/B統制で比較した測定はどこにも無い。Biome/Oxlintの倍数はいずれもベンダー自己申告で、コーディングエージェントのループに組み込んだ場合のトークン/賃金コストへの換算は存在しない。

---

## 4. 実態(in the wild、`gh search code`、2026-09-23)

方法: 認証済み`gh api search/code`(`curl -H "Authorization: Bearer $(gh auth token)"`、`gh` CLI自体はこの環境でx509エラーのため不可)。`search/code`は30req/min制限、`code_search`インデックスはデフォルトブランチのみ・サイズ上限あり・forkを除外――`2026-09-22-format-hook-timing.md`が既に確立した限界(word共起カウントは上限値であって配線検証ではない)を継承する。

| クエリ | 件数 | 備考 |
|---|---|---|
| `stylelint PostToolUse path:.claude` | 105 | `philhoyt/wp-site-editor-theme-scaffold`, `thorsten/phpMyFAQ`など実配線を含む |
| `"html-validate" PostToolUse path:.claude` | 11 | stylelintの1/10以下 |
| `staticcheck path:.claude` | 1,239 | 大半は`CLAUDE.md`/`rules/`の指示文 |
| `staticcheck PostToolUse path:.claude` | 71 | 多くは`rules/golang/hooks.md`という同一テンプレ由来のドキュメントで、実配線ではない |
| `staticcheck Stop path:.claude filename:settings.json` | 13 | 実際のsettings.json内語句一致。開いた2件(loom, beluga-ai)は用途が割れる(§2.3) |
| `"go test -race" path:.claude` | 2,088 | 開いたサンプルは全て指示文、PostToolUse/Stop自動配線は未確認 |
| `"pre-commit run --files" path:.claude` | 186 | dragonflydb(31,664★)ほか実配線あり |
| `"lefthook run" PostToolUse path:.claude` | 4 | lefthookは編集ごとの単発呼び出し用途では稀 |
| `"mise run" PostToolUse path:.claude` | 85 | 大半はSKILL.md/CLAUDE.mdの指示文 |
| `"tool_call" glob systemPrompt extension:ts`(pi拡張のpaths相当検索) | 17,312 | クエリが広すぎてノイズ(無関係リポジトリが大半)――pi拡張での`paths:`相当実装を狙った検索は有効なクエリ設計に至らなかった [inconclusive] |
| `"PreToolUse" glob filename:hooks.json`(Codex hooks.jsonのpath条件検索) | 908 | サンプルは全てClaude Code由来のプラグイン/マーケットプレイス`hooks.json`で、Codex独自のpath-glob機構の実例ではなかった [inconclusive] |

**結論**: stylelintは実配線が二桁件数で見つかる一方、html-validateは一桁少なく、実践の厚みに明確な差がある。staticcheckとgo test -raceは「指示文で教える」が主流で「自動フックに配線する」は少数、かつ低星リポジトリに偏る――§2.3の2事例と整合する。pi/Codexの`paths:`相当実装を狙ったin-the-wild検索は、有効なクエリを作れず不確定(前例が無いのか、検索の失敗なのか区別できない)。

---

## 5. まとめの表

| 観点 | 結果 | タスク種別 | 数値 | 既知の失敗様式 |
|---|---|---|---|---|
| (a) 整形コマンドの決め方 | ハーネス側の薄い対応表(言語拡張子→1コマンド)が数の上で主流。中には「biome.jsonの存在」のような軽い検出を1個混ぜるハイブリッドがある(jig自身がそう) | フォーマッタ選択 | prettier直書き1,724件 vs pre-commit委譲186件 vs lefthook委譲4件(gh code search、上限値) | 直書き型はプロジェクトのignore/exclude設定を再実装しない限り二重管理になる |
| (a) 型検査/lintコマンドの決め方 | プロジェクトマーカー(go.mod, pyproject.toml等)でハーネス側が1コマンドを選ぶ(jigのgate.ts)方式と、`pre-commit run --files`/SKILL経由で丸ごと委譲する方式が両方実在 | 型検査・lint | ray-project 43,903★(SKILL委譲)、dragonflydb 31,664★(フック委譲) | プロジェクトのpre-commit未インストール時にray-projectのSKILLはpip installを促す文言を持つ(委譲側の前提コストが露出する例) |
| (b) 編集ごと/Stopの線引き | 言語ではなくツールの速度で割れる。ruffは速いので整形+lintが両方編集ごとに来ることがある(streamlit)。tsc/mypy/pyright/eslintは重いのでStop | 整形速度 | Biome ~35x vs Prettier、Oxlint 50-100x vs ESLint(ベンダー自己申告) | 統制されたA/B測定はどこにもない |
| (c) 「整形でも型検査でもない検査」の置き場 | 許可リストに入れて任意実行、または指示文で教える、が実測の主流。自動フック配線(特にStop)は少数かつ低star | staticcheck/clippy/race/stylelint/html-validate | staticcheck+PostToolUse 71件(大半は指示文)、+Stop実配線13件、うち検証2件(loom 0★=実配線、beluga-ai 13★=許可のみ) | 重い検査をStopに置くと空回りコストが乗る(marmelabの60-150秒/回、既存記録) |
| (d) paths:相当の配達 | Claude Code(ネイティブ自動発火)>omp(globsフィールドはあるがadvisory、TTSR併用で自動化可)>pi(tool_callでpath取得可能だが公式サンプルはadvisory実装のみ)>Codex(matcherにpath条件が無い)。AGENTS.mdのネスト配置が唯一の実在するベンダー横断代替経路 | ルール配達 | agents.md「60,000超のOSSプロジェクト」採用主張(自己申告数値) | omp/pi両方で「globsを書いても自動発火しない」ことに気づかず、Claude Codeと同じ挙動を期待して設計するのが最有力の落とし穴 |

---

## 6. 結論(平易な言葉で)

**(a) どちらか一方ではなく、二層になっている。** ハーネス(あるいはjigのようなハーネス生成器)は「この拡張子ならこのツールを1つ呼ぶ」という薄い対応表だけを持ち、そのツール自身がプロジェクトの設定(biome.json、pyproject.toml、rustfmt.toml)を見て中身を決める。これはjigの現状の実装そのものと一致する。もう一段プロジェクトに寄せて「コマンド選びそのものをpre-commit/lefthook/mise任せにする」実践も存在し、31,000★超のdragonflydbや43,000★超のray-projectのような大規模リポジトリで実際に動いているが、件数で見るとハーネス側対応表の方が一桁多い。jigがgate.tsで`.pre-commit-config.yaml`や`lefthook.yml`の存在を一切見ないのは、業界の少数派だが実在する側を切り捨てている、というのが正確な言い方になる。

**(b) 言語ではなくツールの速度が線を引いている。** 「Go/Rustは整形と型検査がきれいに割れ、Pythonは整形とlintの両方が編集ごとに来ることがある」という非対称は、ruffが速いから(ベンダー自己申告のBiome/Oxlintの倍数がその傍証)であって、Pythonという言語の性質ではない。tscやmypyやeslintがStopに残るのは、プロジェクト全体を読む必要があって速くならないからで、この境界は将来ツールが速くなれば動く。

**(c) 「その他の検査」は自動化されない第三の場所に置かれている。** staticcheck、cargo clippy、race detector、stylelint、html-validateは、ベンダー自身が「CI/エディタ向け」と位置付け(staticcheckの"ideal candidate for running in CI")、実践者はエージェントの許可リストに入れて任意実行にするか、指示文で「これも走らせろ」と教えるかのどちらかを選んでいる。Stopフックへの自動配線は実在するが低star寄りで、jigが今これらを持たないのは業界の主流に沿っている――ただしstylelintは実配線が二桁件数あるので、CSS/HTMLを本気で対象にするならjigの「silently skip」対象からstylelintだけは外す価値がある(html-validateはさらに薄いので後回しでよい)。

**(d) `paths:`は輸出が難しいClaude Code固有の機能で、代替は「畳む」方が現実的。** Claude Codeの`paths:`は2.1.198以降のネイティブ自動発火機能であり、omp・pi・Codex・DSHのどれにもそのままの形では存在しない。ompは同名の`globs`フィールドを持つがadvisory(モデルが`rule://`で明示的に読むまで一覧止まり)で、Claude Code並みの自動化にはTTSRのcondition併用という追加の作り込みが要る。piは`tool_call`がファイルパスを受け取れるので技術的には「フックで差し込む」実装が書けるが、pi公式サンプル自身がadvisory実装に留まっており、実例は見つからなかった。Codexのフックmatcherはツール名のみでファイルパス条件を持たない。一方、AGENTS.mdの「最も近いファイルが優先」という仕様(agents.md公式)と、rulesyncが実装している`globs`→ネストAGENTS.md生成という変換パターンは、4ハーネス全部が読むAGENTS.mdという共通の器を使って似た効果を得る、実在する移植先になっている。config-layout決定が書いた「Codex・pi・DSHはフックで差し込む」は、pi限定でなら理論上可能だが実例のない選択肢であり、Codexでは不可能(ネイティブにpath条件が無い)。実際に前例があるのは「ネストAGENTS.mdへ畳む」方だと言える。

---

## 7. 前例なし・未検証のリスト

1. DSHの`paths:`相当メカニズム――DSHの公開docsに到達できず、config-layout決定・hooks-five-events決定のどちらもDSHの詳細を空欄にしたまま。
2. 編集ごとlint/整形の言語別レイテンシ・トークンコストをA/B統制で比較した測定――どの言語についても見つからなかった(既存記録から継承)。
3. Codexのフックスクリプト内で`tool_input`の`file_path`/`cwd`を読んでglobマッチを自前実装し、`additionalContext`を注入する実例――理論上可能(1.4節)だが公開リポジトリで見つからなかった。
4. pi拡張で`paths:`相当(globマッチによる自動的な`additionalContext`注入)を実装した実例――`protected-paths.ts`が示す技術的な土台はあるが、ブロック用途以外(ルール本文の条件付き注入)での実例は見つからなかった。
5. omp TTSRの`condition`にglobを書く自動変換パターンを実際に使ってpaths:相当の自動発火を実現した実例――ドキュメントに機構の記載はあるが、使用例は見つからなかった。
6. staticcheck/clippyをStopフックに自動配線したリポジトリの規模別分布――tilsley/loom(0★)以外のサンプルを増やせていない。
7. lefthookをコーディングエージェントのPostToolUseフックから呼ぶ実例――4件ヒットしたが、開いて配線を確認する時間予算が尽きた。

---

## 出典一覧(直接引用したURL)

- Claude Code memory / rules: https://code.claude.com/docs/en/memory (direct)
- Claude Code hooks reference(タイムアウト既定値): https://code.claude.com/docs/en/hooks (lane, WebFetch要約)
- Codex hooks: https://learn.chatgpt.com/docs/hooks (lane)
- pre-commit: https://pre-commit.com/ (lane)
- mise tasks: https://mise.jdx.dev/tasks/ (lane)
- Biome設定探索・速度: https://biomejs.dev/ , https://biomejs.dev/guides/configure-biome/ (lane)
- Oxlint速度: https://oxc.rs/docs/guide/usage/linter.html (lane)
- Stylelint: https://stylelint.io/ (lane)
- html-validate README: https://github.com/html-validate/html-validate (lane)
- staticcheck: https://staticcheck.dev/docs/ (lane)
- AGENTS.md仕様: https://agents.md/ (lane)
- omp context-files: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/context-files.md (direct)
- omp rulebook matching pipeline: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/rulebook-matching-pipeline.md (direct)
- pi公式サンプル `claude-rules.ts` / `protected-paths.ts`: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/claude-rules.ts , https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/protected-paths.ts (direct)
- dragonflydb format-after-edit hook: https://github.com/dragonflydb/dragonfly/blob/main/.claude/hooks/format-after-edit.sh (direct)
- ray-project lint skill: https://github.com/ray-project/ray/blob/master/.claude/skills/lint/SKILL.md (direct)
- lookatitude/beluga-ai settings.json: https://github.com/lookatitude/beluga-ai/blob/main/.claude/settings.json (direct)
- tilsley/loom stop-check hook wiring: https://github.com/tilsley/loom/blob/main/.claude/settings.json (direct)
- jigソース(現地事実の確認): `domains/dev/llm/harness/jig/src/domain/hooks/format.ts`, `.../gate.ts`, `.../src/infra/skills/catalog.ts`, `.../src/app/apply/apply-omp.ts`, `.../src/app/apply/apply-claude.ts`(direct、リポジトリ内)
