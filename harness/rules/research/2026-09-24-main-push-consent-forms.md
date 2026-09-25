# main への push を「このセッションだけ許可する」形の調査

対象: jig の guard hook（プログラム/argv/path のみで判定する決定論的ルールテーブル、tool call ごとに別プロセスで評価。ask は Claude Code と DSH のみが解釈し、Codex/pi/omp では ask は deny に落ちる）に対して、「人間が今回のセッションに限り main への push を許可した」という信号を、(1) リポジトリまたはハーネス内セッションに紐づき、(2) コミットされるリポジトリファイルではなく、(3) モデル自身が設定できない、形で持たせられるかを調べた。

## 方法と検証の凡例

- 「直接取得」: WebFetch/Bash(curl)で一次ソース（ベンダー公式ドキュメント、GitHub API 経由のファイル本文・issue本文）を直接読んだもの。
- 「要約経由」: WebFetch/WebSearch がページ全文ではなく要約・抜粋を返したもの。明示的に「要約経由」と記す。
- 「未到達」: JS レンダリングや空コンテンツで本文を取得できなかったもの（例: omp.sh のドキュメントページは README断片のみで、GitHub 上の raw markdown に切り替えて取得した）。
- gh CLI の認証は壊れていたが `gh auth token` は有効なトークンを返したため、`curl -H "Authorization: token $(gh auth token)"` で api.github.com / raw.githubusercontent.com を直接叩いた（前エージェントの手法を踏襲）。

対象ハーネスの実体（調査で確認できた範囲）:
- pi = earendil-works/pi（旧 mariozechner/pi-coding-agent）https://github.com/earendil-works/pi
- omp = can1357/oh-my-pi（“omp — a coding agent with the IDE wired in”, omp.sh）https://github.com/can1357/oh-my-pi
- DSH = deepseek-harness（DeepSeek AI, “Everything is a Plugin”）https://github.com/deepseek-ai/deepseek-harness

---

## A. セッション内同意コマンド（`/allow-main` 的スラッシュコマンド）

### ベンダー: Claude Code

- Hook 入力 JSON には `session_id` が常に含まれる。直接取得（https://code.claude.com/docs/en/hooks）:
  > `session_id`: "Current session identifier"
  > `agent_id` — "Unique identifier for the subagent. Present only when the hook fires inside a subagent call."
- Skill の frontmatter `disable-model-invocation: true` は「人間だけが呼べる」を明示的にサポートする。直接取得（https://code.claude.com/docs/en/skills）:
  > "`disable-model-invocation: true`: Only you can invoke the skill. Use this for workflows with side effects or that you want to control timing, like `/commit`, `/deploy`, or `/send-slack-message`. You don't want Claude deciding to deploy because your code looks ready."
  同ページの表:
  > `disable-model-invocation: true` | You can invoke: Yes | Claude can invoke: No
- ただし PreToolUse hook の返り値は `allow`/`deny` の2値のみで、`ask` という値は無い（直接取得、同 hooks ページの例と本文）:
  > "There is no `"ask"` value." （要約経由の言い換えだが、例のJSONは `permissionDecision: "deny"` のみを示す一次資料）
  一方、**permission rule** レベル（hook とは別レイヤー）には `allow`/`ask`/`deny` の3値があり、これは `.claude/settings.local.json` のようなファイルに保存できる。直接取得（https://code.claude.com/docs/en/permissions）:
  > "**Allow** rules let Claude Code use the specified tool without manual approval. **Ask** rules prompt for confirmation whenever Claude Code tries to use the specified tool. **Deny** rules prevent Claude Code from using the specified tool."
  > "Permission rules are enforced by Claude Code, not by the model. Instructions in your prompt or `CLAUDE.md` shape what Claude tries to do, but they don't change what Claude Code allows."
- **git push はベンダー自身の deny 例で使われている**（直接取得、permissions ページ）:
  > "With this configuration, Claude Code runs npm scripts and git commits without asking and refuses commands that begin with `git push`."
  ```json
  { "permissions": { "allow": ["Bash(npm run *)", "Bash(git commit *)"], "deny": ["Bash(git push *)"] } }
  ```
  permission-modes ページでも同じコマンドが ask の代表例として再度使われている（直接取得, https://code.claude.com/docs/en/permission-modes）:
  > "Ask rules that match on a command's content, such as `Bash(git push *)`, fall back to a permission prompt"
- **「Yes, and don't ask again」の保存先はリポジトリ直下の `.claude/settings.local.json`** で、これは (1)リポジトリ紐付け (2)コミットされない (3)人間の承認UI操作でのみ書かれる、という条件にほぼそのまま一致する一次資料。直接取得（settings ページ）:
  > "When you choose "Yes, and don't ask again" and the approval saves permanently, such as for a Bash command or a WebFetch domain, Claude Code saves the rule to `.claude/settings.local.json` at the root of the git repository, resolved through worktrees to the main checkout."
  自動 gitignore についての要約経由の裏付け（WebSearch, 一次ドキュメントの言い換え）:
  > "The first time Claude Code writes the file in a git repository that doesn't already ignore it, it adds `**/.claude/settings.local.json` to your global git excludes file"
  モデル自身がこのファイルを直接 Edit/Write で書き換えることについては、`.claude` は protected path 扱いで Manual モードでは常にプロンプトが出る（bypassPermissions/auto モードでは弱まる余地がある）。直接取得（permission-modes ページ）:
  > "Writes to [protected paths](#protected-paths) are never auto-approved except in `bypassPermissions` mode"
  → 「モデル自身が設定できない」は厳密な保証ではなく、「Manual モードでは人間の承認が要る」という条件付きの保証である点に注意。

### ベンダー: Codex CLI

- Codex にも hook の `session_id` フィールドはある（要約経由、Endor Labs の Codex hooks ドキュメントの言い換え。https://docs.endorlabs.com/agent-governance/codex/index）:
  > "Session events include a session_id field (uuid-string) along with transcript_path, cwd, hook_event_name, model, permission_mode, and source parameters."
  ただし OpenAI 自身の公式 hooks リファレンスページを直接開けておらず、この文はサードパーティ製ガバナンスツールのドキュメント経由の記述であることに注意（一次資料ではない）。
- Codex の **プロジェクト信頼はリポジトリのファイルではなく、ユーザーのグローバル設定にリポジトリの絶対パスをキーとして持つ**という形で存在する。要約経由（複数の非公式解説記事の一致する記述。一次ドキュメントは https://developers.openai.com/codex/config-basic ／ https://developers.openai.com/codex/config-advanced だが本文取得はリダイレクト経由で断片のみ）:
  > "Project trust is stored in the global config via entries like: `[projects."/absolute/path/to/repo"] trust_level = "trusted"`"
  > "For security, Codex loads project `.codex/` layers only when you trust the project. If the project is untrusted, Codex ignores project `.codex/` layers, including `.codex/config.toml`, project-local hooks, and project-local rules."
  これは「リポジトリ（絶対パス）に紐づくが、リポジトリ内ファイルではない」永続状態の実例であり、質問の (1)(2) を満たす形として Codex 自身が実装している唯一確認できた例。ただし対象は「push 許可」ではなく「そのリポジトリの `.codex/` 設定・hook・ルールを読み込むかどうか」というより広い信頼境界である。
- Codex の `requirements.toml`（管理者/組織側の強制ポリシー）は実在するが、これは個人ユーザーが自分で設定する仕組みではなく、組織管理者が MDM やクラウド管理経由で配布する制約レイヤーである（要約経由、複数の非公式解説記事）:
  > "requirements.toml is an admin-enforced configuration file that constrains security-sensitive settings users can't override."
  > "Precedence: cloud-managed requirements → MDM requirements_toml_base64 → system `/etc/codex/requirements.toml`."
  個人リポジトリでの「今回だけ push を許す」という粒度のユースケースには対応しない。

### 実践者: obra/superpowers

- superpowers の唯一の「同意」に関する記述は `skills/using-git-worktrees/SKILL.md` にあり、**会話内での質問と回答のみで、状態ファイルへの永続化は一切ない**。直接取得（https://raw.githubusercontent.com/obra/superpowers/main/skills/using-git-worktrees/SKILL.md、GitHub API 経由）:
  > "Has the user already indicated their worktree preference in your instructions? If not, ask for consent before creating a worktree:
  > 
  > > "Would you like me to set up an isolated worktree? It protects your current branch from changes."
  > 
  > Honor any existing declared preference without asking. If the user declines consent, work in place and skip to Step 2."
  「既存の宣言済み選好を尊重する」の "instructions" は会話コンテキストやユーザーの CLAUDE.md 相当を指しており、機械的に強制される session-id keyed のステートファイルではない。コードサーチ（`repo:obra/superpowers consent`, GitHub Code Search API）で "consent" を含むファイルはこの SKILL.md のみがヒットし（9件中でこのファイルが該当）、main push 用の同意フローは repo 内に存在しない。
  → 設問「superpowers の "explicit user consent" は会話のみで機械的強制がないのか」への回答: **その通り。会話のみで、hook や session-id keyed state による強制はない。**

### 実践者/実装: pi / omp のコマンド機構

- pi: `pi.registerCommand()` でスラッシュコマンドを登録でき、`pi.appendEntry()` でセッションに紐づく永続状態を保存できる（モデルのコンテキストからは除外される「durable data」）。直接取得（https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md、WebFetch 要約混じり）:
  > "Persist non-context session data | `pi.appendEntry()`"
  > "Durable data excluded from model context" belongs in entries created via `pi.appendEntry()`.
  ただし **スラッシュコマンドがモデル自身から呼び出し不能であることを明示する記述は見つからなかった**（未確認、`[unverified]`）。`session_id` が hook/extension コンテキストに渡るかどうかも公式ドキュメントに明記が無い（未確認）。
- omp（can1357/oh-my-pi）: `tool_call` / `session_stop` 等の hook イベントがあり、拡張は `ctx.ui.confirm()` で**対話的確認**を出せる。直接取得（raw.githubusercontent.com/can1357/oh-my-pi/main/docs/hooks.md）:
  > "if any handler returns `{ block: true }`, execution stops"
  > `const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`); if (!ok) return { block: true, reason: "user denied command" }`
  これは重要な区別で、**omp の拡張機構自体には人間向け確認UIがある**（jig の外部 guard hook プロセスとは別レイヤー）。ただし前提研究が言う「omp に ask が無い」は、guard hook サブプロセスが返せる決定値のことであり、矛盾しない: `ctx.ui.confirm` はエージェント本体プロセス内の拡張コードが持つUIであって、別プロセスの決定論的 guard hook からは呼べない。
  hook 入力に `session_id` が含まれるかは、取得できた `docs/hooks.md` の範囲では確認できなかった（未確認）。

### 測定/実態レンズ（issue tracker 由来のインシデント）

- anthropics/claude-code issue #94971（「push bez svolení」＝「同意なしの push」を含むタイトル、2026-08-25 の事故報告として提出）は、**内容が取り下げられ本文が非公開化されていた**。直接取得（GitHub API, https://github.com/anthropics/claude-code/issues/94971）:
  > "This report was filed in error by an automated script and has been withdrawn by its author. The original content was a private project's internal work log and was not intended for publication."
  → 技術的な詳細は得られず証拠として使えないが、「エージェントの無許可 push」というインシデント報告のカテゴリ自体が issue tracker 上に実在することは確認できた。

---

## B. リポジトリ識別（git remote の owner/org で判定）

### 実践者/実測パターン

- `pre-push` hook が `$1`（remote名）と `$2`（URL）を受け取れることは git 自体の標準仕様であり、複数の実践者ブログ/gist がこのパターンで「保護ブランチへの push を確認する」フックを書いている。直接取得（gist、https://gist.github.com/mosra/19abea23cdf6b82ce891c9410612e7e1）:
  ```bash
  #!/bin/bash
  protected_branches='master|main'
  if read local_ref local_sha remote_ref remote_sha; then
    if [[ "$remote_ref" =~ ($protected_branches) ]]; then
      echo -en "You're about to push to $remote_ref, is that what you intended? [y|n] "
      read -n 1 -r < /dev/tty
      ...
      if echo $REPLY | grep -E '^[Yy]$' > /dev/null; then exit 0; fi
      exit 1
    fi
  fi
  ```
  このパターンは「ブランチ名」で判定しており「remote の owner/org」での判定ではない点に注意。owner/org 判定（`git remote get-url` の出力に対する正規表現マッチ）は WebSearch の要約でのみ確認でき（「組織限定でフォークへの push を拒否する」用途）、実物のスクリプト例を一次ソースとして開けたのはブランチ名判定のもののみだった。
- GitHub の Rulesets はリポジトリ側（ホスト側）の強制であり、エージェント側の guard hook とは独立した層。組織 (organization) にのみチーム前提の rule が使える。直接取得（要約経由、docs.github.com の複数ページ）:
  > "For repository-level rules, the team must belong to the organization that owns the repository. This rule is not available on user-owned repositories as they do not contain teams." (docs.github.com/en/repositories/.../available-rules-for-rulesets)

### 既知の弱点（設問が指摘した通り、裏付けあり）

- モデルは `git remote set-url` や新規 remote の追加で判定対象そのものを書き換えられる。これは一般的な git の性質であり、個別の一次資料は見つからなかったが、C節の `destructive_command_guard` の issue が示す「`.git/config` への書き込みルートの多さ」がそのまま remote URL 変更にも当てはまる（`.git/config` に `[remote "origin"] url = ...` が書かれているため）。
- フォーク・複数 remote の場合、「どの remote への push か」を argv だけから判定するには `git push` の引数（remote名の省略時は `git config branch.<name>.remote` や `remote.pushDefault` に依存）まで解決する必要があり、guard hook が「プログラム/argv/path のみで判定する」という制約と食い合わせが悪い（argv だけでは remote 名が省略されているケースを解決できない）。この点は本調査で一次資料を見つけられず、規則の設計上の推論として `[unverified]` に留める。

---

## C. リポジトリローカルかつ非コミットのマーカー（git config --local / gitignore済みファイル）

### 前例: Claude Code の `.claude/settings.local.json`（A節で詳述、再掲）

これはこの設問の C にもっとも近いベンダー公式の実例である: リポジトリ直下・gitignore対象・人間の承認UI操作でのみ書き込み。A節のURL・引用を参照。

### 前例: Codex の `[projects."<path>"] trust_level`

こちらは「git config --local」ではなく「ハーネスのユーザー設定ファイル内、リポジトリの絶対パスをキーとする表」という形。A節のURL・引用を参照。git config でもリポジトリ内ファイルでもない第三の形として記録する。

### 前例: git-lfs が `git config --local` に設定を持つこと

直接取得はできなかったが、要約経由で複数の一次記述と一致（WebSearch, git-lfs 公式 man ページの言い換え, https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-config.adoc）:
> "git-lfs reads its configuration from any file supported by `git config -l`, including all per-repository, per-user, and per-system Git configuration files."
> ".lfsconfig at the root of the repository" is an alternative, but that file **is** typically committed (shared config), which is the opposite of what this question wants (uncommitted).
→ git-lfs は「`git config --local` にツールが状態を持つ」の前例にはなるが、それは通常 **ユーザーが `git lfs install` 等のコマンドで能動的に設定するもの**であり、「人間だけが設定できる」ことを保証する仕組みそのものではない（保証しているのは「モデルにそのコマンドを打たせない」という guard 側の話になる）。

### 「git config への書き込みをガードする」実例と、その既知の不完全性（重要な否定的証拠）

- `Dicklesworthstone/destructive_command_guard`（愛称 dcg）はエージェントによる危険な git/shell コマンドの実行をブロックする実在のツールで、2026-09-23 時点で **star 6045、直近 push が同日**（＝活発に保守されている）。直接取得（GitHub API）:
  ```
  stars: 6045, pushed_at: 2026-09-23T10:12:18Z, open_issues: 10
  ```
  このツールは `cat > .git/config` のような単純な書き込みは deny するが、**issue #457（closed, GitHub API で直接取得）が「`.git/config` へのガードは 12種類の書き込み手段のうち 5種類しかカバーしていない」ことを開発者自身が記録している**:
  > "`cat > .git/config` is denied. `tee .git/config`, `sed -i s/a/b/ .git/config`, `cp /tmp/x .git/config`, `install /tmp/x .git/config` and `cat >> .git/config` are all allowed. Same file, same corruption, and the target is recognised in every spelling — so this is not a path-resolution problem."
  > "Five of twelve covered for `.git/config`; eleven of twelve for `.bashrc`."
  → **「`git config` への書き込みをガードすることは、業界で実際に試みられているが、購入可能な最良の実装（6000+ star）でも構造的に抜け漏れが残る」**という強い否定的証拠。
- `zetlen/falconet` issue #29（closed, GitHub API で直接取得）は別角度から同じ弱点を指摘する: ファイル書き込みしかできない（bash実行権限を持たない）エージェントでも、`.git/` 配下への書き込みを通じて `core.pager` や `core.hooksPath`、`filter.*.clean/smudge`、`diff.*.textconv` 等の git 設定に外部コマンド実行を仕込み、後続の `git status`/`git diff`/`git add`/`git commit` の実行時にコード実行へエスカレーションできる:
  > "several git configuration settings cause git to run an external command during ordinary operations like `git status`, `git diff --cached`, `git add` and `git commit`."
  > "a file-only agent can get code execution in the `implement` job before the allowlist can refuse anything."
  → guard hook が「プログラム/argv/path のみ」で判定するなら、`git config` 自体をガードしても `.git/config` へのファイル書き込みは Edit/Write ツール経由で素通りする可能性が高く、C案は「ファイル書き込みツールの guard も同時に .git/ を保護しないと成立しない」という構造的要件を持つ。

---

## D. ハーネス組み込みの対話的 ask（push ごとの確認）

- **Claude Code**: permission rule の `ask` は「一致するたびに確認を求める」もので、`Bash(git push *)` はベンダー自身の例で ask/deny の代表として繰り返し使われている（A節参照）。
- **DSH**: 公式ドキュメント（deepseek-harness.github.io）は JS レンダリングのためコンテンツを取得できず、`ask` 相当の機構の有無を一次資料で確認できなかった（**未到達**）。README（GitHub API 経由で直接取得）には「everything is a plugin」という設計思想のみが書かれており、permission/ask の記述はなかった。
- **Codex CLI**: hook レイヤーには ask 相当が無いとする前提研究と整合する記述が複数の非公式解説記事にある一方、**CLI 自体の `approval_policy`**（`untrusted`/`on-request`/`on-failure`/`never` など）は対話的な承認プロンプトを持つ、という記述が複数の非公式記事にある（要約経由、一次ドキュメントの本文は取得できず）。これは「guard hook サブプロセスの決定値としての ask」と「ハーネス自身が持つ承認UI」が別物であることを示しており、A節の omp の `ctx.ui.confirm` と同じ構造。
- **pi / omp**: 前例のとおり、omp の拡張は `ctx.ui.confirm` という対話的確認を持つ（A節）。これが「push ごとの ask」として使えるかは、拡張が `PreToolUse` 相当のタイミングで `tool_call` イベントをフックできるかに懸かっており、`docs/hooks.md` の記述からは技術的に可能に見えるが、jig の外部 guard hook プロセスとは別のコード（拡張内で書く必要がある）である。
- 「ask を持たないハーネスで実践者がどうしているか」について、代替が「会話での同意のみ」（superpowers 型）なのか「deny 一択」なのかを直接述べた実践者記事は見つからなかった（**未確認**）。

---

## E. 「個人リポジトリ vs 組織リポジトリ」のポリシー分離についてのベンダー指針

- GitHub 側: **チームベースの承認ルールは個人アカウント所有のリポジトリでは使えない**（チームは組織にしか存在しないため）。直接取得と要約経由の混在（docs.github.com, available-rules-for-rulesets）:
  > "For repository-level rules, the team must belong to the organization that owns the repository. This rule is not available on user-owned repositories as they do not contain teams."
  組織レベルの Ruleset は Team/Enterprise プランのみで使え、個人アカウントには相当機能がない（要約経由, github.blog changelog, docs.github.com discussions）。
- ただしブランチ保護そのもの（force-push禁止・削除禁止など）は個人リポジトリでも所有者が有効化できる（要約経由）:
  > "If you create a repo with a personal account, you can use branch protections according to the personal account plan."
  → つまり「個人リポジトリにはホスト側の保護が一切ない」わけではなく、「個人リポジトリの持ち主自身が能動的に設定すれば持てる」が「組織のように管理者が一括強制する層は個人アカウントには存在しない」という分離。
- Codex 側: `requirements.toml` は **組織管理者向けの強制レイヤー**であり、個人ユーザーが自分のためにこれを書く運用は想定されていない（A節参照）。Claude Code の **managed settings** も同様に「組織」向けと明記されている（settings precedence の表、直接取得）:
  > `Managed settings` | `who`: `Your organization`
- 以上から、**「エージェント側の main-push ガードは、組織所有リポジトリではホスト/管理者側の強制で実現するのが業界の型であり、個人リポジトリ向けの “エージェント側ガード” 自体の実践例（ベンダー推奨・実践者の確立した型）は見つからなかった**。今回の設問が要求する「個人リポジトリでもエージェント側で main push を止める」という要件自体は、探した範囲のベンダー文書・実践者記事のどちらにも直接の型が存在しない。これは前回の調査記録（env var 拒否の裁定の前提となった調査）と整合する「委員会レベルの合意された実践は無い」という結論を、E の角度からも裏付ける。

---

## 否定側の証拠（まとめ）

1. **superpowers の "consent" は会話のみで機械的強制がない**（obra/superpowers, SKILL.md 直接取得）。「explicit user consent」を謳う唯一の実践者記録が、実は state file も session-id keyed hook も持たない、という否定的事実。
2. **`.git/config` へのガードは、6000+ star の専用ツールでも 12種の書き込み手段中 5種類しかカバーできていない**（destructive_command_guard issue #457, 直接取得）。C案（git config --local マーカー）を選んでも、guard がその key への書き込みだけを狙って塞ぐのは構造的に漏れが出る。
3. **ファイル書き込みのみのエージェントでも `.git/` への書き込みから git 設定経由のコード実行に到達できる**（falconet issue #29, 直接取得）。「argv だけを見る guard hook」という設計制約そのものが、この種の攻撃面に対して原理的に弱い。
4. **Claude Code のモデル自身による `.claude/settings.local.json` への書き込みは「常に」阻止されるわけではない**。protected path のルールは bypassPermissions/auto モードで弱まる（permission-modes ページ、直接取得）。「モデル自身が設定できない」は permission mode 依存の条件付き保証にとどまる。
5. **実際のインシデント報告（issue #94971）は内容が取り下げられ、技術的な裏付けとしては使えない**。issue tracker に「無許可 push」カテゴリの報告が存在すること自体は確認できたが、件数・頻度についての測定的な数字は得られなかった。
6. **個人リポジトリ向けの「エージェント側 main-push ガード」という実践そのものに、ベンダー推奨・実践者の確立した型が見当たらない**（E節）。GitHub Rulesets もCodex `requirements.toml` も Claude Code managed settings も、いずれも「組織」を主語にしている。

---

## 確認できなかったこと

- DSH（deepseek-harness）公式ドキュメントは JS レンダリングのため本文を取得できず、ask/session_id/git config 状態保持に関する一次資料は得られなかった（未到達）。
- pi・omp の hook/extension コンテキストに `session_id` が渡るかどうかは、取得できた範囲の公式ドキュメントに明記がなかった（未確認、`[unverified]`）。
- pi・omp のスラッシュコマンドが「モデル自身からは呼び出し不能」であることを明言する一次資料は見つからなかった（未確認）。Claude Code の `disable-model-invocation` のような明示的保証は pi/omp では確認できていない。
- Codex CLI 公式の hooks リファレンスページ本文は直接取得できず（リダイレクトと JS レンダリングのため）、hook の `session_id` に関する記述はサードパーティ（Endor Labs）のドキュメント経由の要約に留まる。
- 「git remote の owner/org を guard hook の argv/path 判定だけで見分ける」実装例を、一次資料（実際の guard 実装コード）としては見つけられなかった。ブランチ名判定の pre-push hook 例は見つかったが、owner/org 判定の実物は要約経由の記述のみ。
- CVE-2026-21852 について、本調査で追加検索した際に得られた1件のサードパーティ要約（cvereports.com）は、この CVE を Codex ではなく Claude Code のキー流出に関する記述として紹介しており、前提研究が言う「Codex が untrusted .codex/ を無視する」という文脈と一致しない可能性がある。ただしこれは既に確立された事実として扱う指示のため、本調査では再検証していない。齟齬がある場合は別途確認が必要。

---

## 結論

### 支持される結論

- 質問の3条件（リポジトリ/セッションに紐づく・非コミット・モデル非設定）をもっとも厳密に満たす**ベンダー公式の前例は Claude Code の `.claude/settings.local.json`**（A/C節）である。これは「Yes, and don't ask again」という人間の承認UI操作を経てのみ書かれ、`.git` と並ぶ protected path 相当の扱いを受け、リポジトリ直下に置かれながら自動的に gitignore される。git push の deny/ask は同じ仕組みの中でベンダー自身が繰り返し例示する代表的ユースケースである。
- **Codex の `[projects."<path>"].trust_level`** は、質問の条件をやや異なる形（ハーネスのユーザー設定ファイル内、絶対パスキー）で満たす、もう一つの実在する前例である。ただし対象は「push許可」ではなく「プロジェクト全体の信頼」であり、粒度が粗い。
- **セッションID keyed の「/allow-main」コマンド**という形自体（設問Aの原型）は、Claude Code なら `disable-model-invocation: true` + `session_id` を使えば技術的に組める材料は揃っているが、**この正確な形を実装した実践者の前例は見つからなかった**。obra/superpowers はこの種の用途で「会話のみ」に留まっている唯一確認できた著名な実践者であり、これは「機械的な状態保存より会話的合意の方が実際に選ばれている」ことを示す一点の証拠である（ただし一点であり、一般化はできない）。
- **git remote 判定（B案）**は概念としては pre-push hook の標準的な用法の延長だが、「owner/org を見る」形の実物は見つからず、`git remote set-url` に対するガードが別途必要という設計負債を伴う。
- **`git config` 書き込みガード（C案の一部）は、業界最大級の実装ですら構造的に漏れる**、という強い否定的知見が得られた。この案を採る場合、guard は `git config` コマンドだけでなく `.git/` 配下へのあらゆるファイル書き込み経路（Edit/Write/`>`/`>>`/`tee`/`sed -i`/`cp`/`install` 等）を塞ぐ必要があり、「プログラム/argv/path のみで判定する」という現行 guard hook の設計方針と正面から衝突する。
- **D案（ハーネス組み込み ask）は Claude Code と DSH（未確認）以外では存在せず**、Codex/pi/omp では「ハーネス自身の承認UI」（Codex の approval_policy、omp の `ctx.ui.confirm`）と「外部 guard hook プロセスの決定値」が別レイヤーである点が明確になった。外部 guard hook を主語にする限り、これらのハーネスでは ask は使えない。
- **E案（個人 vs 組織の分離）は「組織は host/管理者側で強制、個人は本人が能動的に設定しない限り無保護」という分離が実在する**が、これは「エージェント側の main-push ガードを個人リポジトリでは要らない」という結論を支持する証拠ではなく、単に「個人リポジトリ向けのエージェント側ガードという実践自体が業界にまだ無い」ことを示すに留まる。

### 支持されない結論

- 「session-id keyed の同意コマンド」がハーネス横断で確立された実践だという主張は支持されない。Claude Code 以外での実例が見つからなかった。
- 「git config --local への書き込みで十分に守れる」という主張は支持されない。6000+ star のツールの issue 自体がそれを否定している。
- 「remote の owner/org 判定だけで守れる」という主張は支持されない。`git remote set-url` という書き換え経路自体を別途塞ぐ必要があり、その実装例も見つからなかった。

### 欠けているもの

- pi・omp・DSH で「人間だけが呼べるコマンド」「session_id の hook 露出」を保証する一次資料。
- 「個人リポジトリでエージェントの main push を止める」を実践した具体的な事例（実践者ブログ、OSS の guard 実装）。今回の4レンズ探索では見つからなかった。
- CVE-2026-21852 の対象ハーネスに関する齟齬の再確認（本調査のスコープ外として未実施）。
