# 並列エージェントの worktree 隔離と、結果の合流（マージ）の業界の実態

日付: 2026-09-27。担当: worktree 隔離とマージの実態のみ（推奨は書かない）。

## 前提として読んだ既存記録（再調査していない）

- `harness/rules/research/2026-09-27-swarm-on-omp-pi.md`
- `harness/rules/research/2026-09-27-swarm/kimi-code.md`（Kimi Code Tower の `TowerMerge` 精読）
- `harness/rules/research/2026-09-27-swarm/seams.md`（omp `isolated: true` の実装、pi 側 `worktree.js` 実装例）
- `harness/rules/research/2026-09-27-swarm/references.md`（`tmustier/pi-agent-teams` の worktree 肥大化実測、Claude Code agent teams の限界表）
- `harness/rules/decisions/2026-09-27-swarm-extension.md`

以下は上記から得られた確立済み事実で、今回引用のみ行い再調査していない:

> "issue#9: 1ヶ月で1,195セッションディレクトリ・10 worktree(~2.2GB)が蓄積、対応PRが5ヶ月以上未マージ。**mainへのコミットは2026-06-12で停止、issueは9月まで継続報告**"
（`harness/rules/research/2026-09-27-swarm/references.md:150`）

> "omp の `isolated: true` は git worktree ではなく、ファイルシステムレベルのコピー・オン・ライト機構（APFS clone、btrfs/zfs snapshot、reflink等）"…"隔離実行は完了時に破棄され、再開不可"
（`harness/rules/research/2026-09-27-swarm/seams.md:520-530` 引用）

> "TowerMerge: レビューゲート付きマージ。「最新レビューが `clean`」「依存ミッションが全てマージ済み」「変更ファイルがミッションの宣言スコープ内」の3条件をストアが強制、満たさなければ拒否理由を返す。`--no-ff` マージ。"
（`harness/rules/research/2026-09-27-swarm/kimi-code.md` 該当節、`packages/agent-core-v2/src/features/tower/towerFeature.ts:44-54` を精読元とする既存記録より）

---

## 方法と検証凡例

- **直読**: WebFetch で取得したページ本文をそのまま引用（vendor 一次資料）。ページ自体は一次情報だが、WebFetch は取得後に要約モデルを通すため、"直読" と書いても字句レベルでは要約経由である点に注意。原文が長大でモデルが逐語抽出した箇所は引用符付きで示す。
- **要約経由**: WebSearch の結果（検索エンジン＋要約）のみで、原文ページを別途 WebFetch していないもの。
- **API 直読**: `curl` で GitHub REST API を直接叩いた生データ（star数・pushed_at・open_issues）。要約を通していない。
- **[unverified]**: 出典から断定できず、推測で埋めた箇所。

---

## 1. ベンダー実装

### 1-1. Claude Code — `--worktree` / `EnterWorktree` / 自動バックグラウンド隔離 / agent teams（無隔離）

出典: https://code.claude.com/docs/en/worktrees （直読、2026-09-27）

**作る単位**: `git worktree add` 相当。既定で `.claude/worktrees/<name>/` に新ブランチ `worktree-<name>` を作る。
> "Pass `--worktree` or `-w` with a name to create an isolated worktree and start Claude in it. By default, the worktree is created under `.claude/worktrees/<name>/` at your repository root, on a new branch named `worktree-<name>`"

サブエージェント隔離も同じ機構で、frontmatter 一行で恒常化できる:
> "make the isolation permanent for a custom subagent by adding `isolation: worktree` to its frontmatter"

**戻し方（対話セッション）**: ベンダーは戻し方を規定しない。「標準の git PR ワークフロー」に委ねる設計で、ドキュメント本文には `merge` コマンドの記載が無い。唯一の自動処理は「壊れていない worktree はセッション終了時に自動削除、壊れていれば残す」というクリーンアップ判断だけ。
> "**The worktree is clean**: for an unnamed session, Claude removes the worktree and its branch automatically... **The worktree has work in it**: Claude prompts you to keep or remove the worktree."

**戻し方（自動バックグラウンドセッション）**: ここは明確に規定されている。出典: https://code.claude.com/docs/en/agent-view （直読）
> "Before editing files, Claude moves the session into an isolated git worktree under `.claude/worktrees/`"
> "**Commit and push**: Claude commits without asking, and pushes the branch when the repository has a remote. **Draft pull request**: Claude opens one when the task calls for it... **Never**: pushing to `main` or `master`, force-pushing, and merging."

→ Claude Code のバックグラウンド隔離は「commit→push→draft PR」までを自動で行い、**merge 自体は自動化の対象外**（人間が最終合流を行う設計）。

**agent teams は既定で隔離しない**: 出典 https://code.claude.com/docs/en/agent-teams （直読）。teammate は worktree に分かれず同一チェックアウトで並行に書く設計で、衝突回避は「担当ファイルを分ける」という運用ルールに委ねられている:
> "**Avoid file conflicts**: Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files."
> "**Manual parallel sessions**: Git worktrees let you run multiple Claude Code sessions yourself without automated team coordination"

→ Claude Code は「worktree 隔離＋自動 commit/push/PR（マージなし）」の subagent/background 系路線と、「無隔離＋ファイル分担のみ」の agent-teams 路線を明確に分けて提供しており、両者を混同しないことを文書自身が強調している。

**衝突時の扱い**: worktree の外への書き込みは4種のチェックで機械的に拒否される（メインチェックアウトへの Edit/Write、作業ディレクトリの脱出、git リダイレクト、コマンド形状の未検証）。マージ時の衝突自体への対処法はドキュメントに記載が無い（"標準の git" 任せ）。

**片付け**: named session は保持するかどうかを毎回確認、unnamed は自動削除。非対話 (`-p`) 実行はクリーンアップ自体を行わず、`git worktree lock` を掛けたままにする——後日の「stale-lock sweep」が回収する設計:
> "Non-interactive runs with `-p` have no exit prompt, so Claude doesn't clean up their worktrees, and Claude Code leaves the lock it took on each one at creation in place until a later session's stale-lock sweep releases it."

**依存関係・ignore ファイルの用意**: worktree は「新規チェックアウト」なので `.env` 等は無い。`.worktreeinclude`（`.gitignore` 構文）で gitignore 済みファイルだけをコピーする専用機構がある:
> "A worktree is a fresh checkout, so untracked files like `.env` or `.env.local` from your main repository are not present. To copy them automatically when Claude creates a worktree, add a `.worktreeinclude` file"

**Git LFS / filter driver の落とし穴（ベンダー自身が明記する失敗モード）**:
> "If you set up Git LFS with `git lfs install --local`, a worktree that Claude Code creates contains LFS pointer files instead of the real files... Claude Code skips the repository's own filter drivers when it creates a worktree because a filter driver is a shell command, and anything that can write to the repository, including Claude, could have put one there."
→ セキュリティ上の理由でリポジトリ固有の filter driver（LFS 含む）を意図的に無効化した状態で worktree を作るため、LFS 管理ファイルは pointer のまま複製される。`git lfs pull` を worktree 内で手動実行する必要がある。

### 1-2. Codex（OpenAI）— detached HEAD の worktree、`codex apply`、`.worktreeinclude`、自動クリーンアップ

出典: https://learn.chatgpt.com/docs/environments/git-worktrees （リダイレクト先を WebFetch、要約経由）

**作る単位**: `$CODEX_HOME/worktrees` 配下に、選択したブランチの HEAD から **detached HEAD 状態**で作る（ブランチとして持たない）。
> "worktrees begin in a 'detached HEAD state,' which allows multiple worktrees to exist without creating branch conflicts."
未コミット変更があれば worktree にも適用される。

**戻し方**: "Handoff" というローカル間（Local ⇔ Worktree）の移動機能があり、Codex 自身が git 操作を代行する。クラウド task の場合は `codex apply`（別名 `codex a`）が `git apply` を裏で実行してパッチを取り込む——マージでもチェリーピックでもなく **パッチ適用**:
> "The `codex apply` command... applies a cloud task's diff to your local working tree. This runs `git apply` under the hood. It prints patched files on success and exits non-zero if the apply fails due to conflicts."

**衝突時**: `git apply` が失敗すれば非ゼロ終了。git のワンブランチ・ワンワークツリー制約を理由に挙げ、詳細な衝突解決手順はドキュメント上は明記されない:
> "Git prevents the same branch from being checked out in more than one worktree at a time." — これを "ambiguity and race conditions" の回避策として説明。

**片付け**: 直近 15 個の Codex 管理 worktree のみ保持する自動ローテーション、削除前にスナップショットを取る:
> "Codex maintains automatic cleanup, keeping 'your most recent 15 Codex-managed worktrees' by default. Before deletion, the system 'saves a snapshot of the work,' allowing later restoration."

**依存関係**: Codex も `.worktreeinclude` で gitignore 済みファイル（`.env` 等）をコピーする、Claude Code と同名同構文の機構を持つ。ディスク使用について明示の注意書きがある:
> "Worktrees can take up a lot of disk space. Each one has its own set of repository files, dependencies, build caches, etc."

### 1-3. Kimi Code Tower — 既出（再引用のみ）

`.tower/worktrees/wt-N` にミッション毎の専用 git worktree を割り当て、`TowerMerge` が「最新レビュー clean」「依存ミッション全マージ済み」「変更ファイルがスコープ内」の3条件を強制し、満たさなければ拒否理由を返す `--no-ff` マージ。既定 off の実験機能で、専用の常時可視化 UI は無い（`kimi-code.md` 精読、詳細は同ファイル参照）。

### 1-4. omp `isolated: true` — 既出（再引用のみ）

git worktree ではなくファイルシステムレベルの copy-on-write（APFS clone / btrfs・zfs snapshot / reflink 等）でワークスペースを作り、**パッチ取り込み**か **`omp/task/<id>` ブランチへコミットしてチェリーピック**のどちらかで親に合流。隔離実行は完了時に破棄され再開不可（`seams.md` 精読）。

### 1-5. Superset・Conductor・Crystal・emdash（デスクトップ GUI 系、ベンダー寄りの一次資料）

- **Conductor**: 出典 https://www.conductor.build/docs/guides/git-worktrees/run-claude-code-with-git-worktrees （直読、要約経由）。ワークスペース＝独自の git worktree＋ブランチ。ベースブランチから origin fetch して作る:
  > "Conductor creates the new workspace as its own git worktree and branch. It bases that workspace on the repository's configured base branch and fetches from `origin` first"
  マージ自体の具体的な手順（squash/rebase/PR の詳細）はこのページには **記載が無い**——"Review and PR flow attached to the same workspace" とだけ書かれ、実装の詳細は別ページに委ねられている。[要約経由、未到達の下位ページあり]
- **Superset**: 出典 WebSearch 要約経由（https://superset.sh/blog/working-with-worktrees-in-superset 等、原文 WebFetch 未実施）。「タスクごとに worktree＋ブランチ、diff viewer でレビュー後にマージ、または2案を試して気に入った方だけ残す」という説明。**「worktree はファイルを隔離するだけでプロセスをサンドボックス化せずマージ衝突も防がない」**という限定を Superset 自身が述べている、という要約が得られた（原文未確認）。
- **Crystal → Nimbalyst**: 出典 WebSearch 要約 + API 直読。「squash and rebase to main」「archive folders on merge」という機能名は要約止まりで、原文の実装詳細は未取得。**2026年2月に deprecated、後継 Nimbalyst に切替**という否定側の事実は複数ソースで一致。
- **emdash**: 出典 WebSearch 要約経由。`.emdash.json` にタスク単位の setup/run/teardown スクリプトを書き、`$EMDASH_PORT` でポート衝突を回避。「Review diffs, create pull requests... and merge from one place」— PR 経由が前提。

---

## 2. 実践者（名前のある人・実名アカウント）

### 2-1. Petr Baudis（`pasky`、git/notmuch 界隈で知られる開発者）— `pi-side-agents`

出典: https://github.com/pasky/pi-side-agents （直読、要約経由）。API 直読で本人確認: `curl https://api.github.com/users/pasky` → `{'name': 'Petr Baudis', 'followers': 374}`。リポジトリ自体は 193★、`pushed_at: 2026-09-24`（API 直読、現役）。

**戻し方**: 人間承認後にエージェント自身が git 操作を行う、という会話駆動フロー:
> "Users confirm completion by typing 'LGTM, merge,' after which 'the agent will merge its work into your main repo.'"
> "using `git show` for quick code review before approving the merge."

**片付け**: worktree を作り直さず**再利用**する設計（Kimi/Conductor 系の「タスクごとに使い捨て」とは異なる方針）:
> "Old worktrees are kept around and reused and updated by new agents." / "Old branches are auto-pruned during reuse by a new agent."

**明記された制約**: "avoid editing in the main tree while side agents are active"（メインツリーの並行編集は避けよ、という運用上の注意）。

### 2-2. brtkwr.com — worktree の実測肥大化と一括清掃（実践者ブログ）

出典: https://brtkwr.com/posts/2026-03-06-bulk-cleaning-stale-git-worktrees/ （直読、要約経由）

数十リポジトリに渡って「1チケット=1 worktree」で運用し、蓄積した実測値:
> "256 of them consuming 28GB of disk, 700+ stale local branches"（約7割はマージ後数か月放置）

清掃方法は自作の2本の bash スクリプト（`git fetch --prune` → `git rev-parse --verify refs/remotes/origin/$branch` で残存確認 → `git worktree remove`、`git branch -vv | grep ': gone]'` → `git branch -D`）。結果:
> "Reduced worktrees from 256 to 28, deleted approximately 700 stale branches across 46 repositories, and recovered roughly 27GB of disk space in under two minutes."

→ 標準の `git worktree prune` だけでは削除されない「リモートブランチは消えたがローカル worktree ディレクトリは残る」パターンが実測されている（ベンダーのクリーンアップ機構がカバーしない領域）。

### 2-3. Laurent Kempé — Windows での git bare clone + Worktrunk

出典: https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/ （直読、要約経由）

`git bare clone` + サードパーティ Worktrunk（`git-wt switch --create <name>` で新ブランチ＋ワークツリーを作成、post-create/post-start フックで `dotnet restore`/`dotnet build` を自動実行）。`merge`/`remove`（マージ済みなら worktree を削除）というコマンドの**存在**は確認できたが、衝突解決やマージ戦略の詳細、ディスク使用量やクリーンアップの具体的トラブルは本文に記載が無い。ターミナルタブを誤って閉じてエージェントを失う事故から `psmux`（セッション永続化）に移行した、という運用上の失敗談のみ確定。

### 2-4. rollnuts（DEV Community、否定側）— worktree は実行問題は解くがマージ問題は解かない

出典: https://dev.to/rollnuts/git-worktrees-arent-enough-for-parallel-ai-agents-38b7 （直読、要約経由）

> "Two agents in two isolated worktrees can still change related code — code that reads clean in each branch on its own, and only clashes when both branches land on main."

worktree はファイルシステムの衝突は防ぐが、**意味的な衝突（semantic conflict）**は検出しないと主張し、AgenticFlict の 27.67% という数字（§3 参照）を根拠に引用。提案する対策は「PR 横断で監視する助言レイヤー」（著者が関わる Veripsa Core という製品の宣伝を兼ねる点に留意——中立な実践者報告ではなく製品ブログの可能性が高い）。

### 2-5. `tmustier/pi-agent-teams` — 既出（再引用のみ）

`main` への新規コミットが 2026-06-12 で停止（3.5か月超）。API 直読: 108★、`pushed_at: 2026-06-20`（依存更新PRのみ、mainの停止とは別）、open issues 18。ディスク肥大化の一次報告:
> "On a machine with moderate daily usage over ~1 month: 1,195 session directories under `~/.pi/agent/teams/`... One session with 10 active worktrees still registered against the parent repo (~2.2 GB)... The parent repo's `git worktree list` showed 11 stale entries"
（`references.md:137` 引用、対応 PR #40 は5ヶ月以上未マージ）

---

## 3. 測定エビデンス

### 3-1. AgenticFlict（arXiv 2604.03551）— AI エージェント PR のマージ衝突率 27.67%

出典: https://arxiv.org/abs/2604.03551 （直読、要約経由）。142K+ の agentic PR・59K+ リポジトリから 107K+ を決定論的マージシミュレーションで処理:
> "merge conflict rate: 27.67%"、"29K+ PRs exhibiting merge conflicts"、"336K+ fine-grained conflict regions"

WebSearch 要約（原文未確認、二重チェック未了）では「Copilot 15.43%が最低、Codex 32.31%が最高」というエージェント別内訳が報告されているが、この数値は WebFetch での abstract 直読では確認できず、WebSearch の要約のみに依拠する[要約経由、未検証]。

タスク種別: これは**コーディングタスクそのもの**（実リポジトリへの実 PR）についての測定であり、研究・チャットタスクへの汎化ではない点は明確。

### 3-2. AI Agent Pull Requests on GitHub（arXiv 2607.04697、AIDev-pop データセット）

出典: https://arxiv.org/abs/2607.04697 （直読、要約経由）。33,596 PR・2,807 リポジトリ（OpenAI Codex, GitHub Copilot, Devin, Cursor, Claude Code を含む、2024年12月〜2025年7月）。

マージ再生（merge replay）による衝突率:
> "cross-agent PR pairs: 41.7% vs. 19.8%, respectively [for intra-agent pairs]"

同時活動の重なり:
> "40.2% of repositories contain co-active agent-authored PR pairs" with exact temporal overlap, increasing to "53.4%" within a one-week window.

→ **異なるエージェント同士が同じリポジトリで同時に走った場合の衝突率(41.7%)は、同一エージェント同士(19.8%)のほぼ2倍**という測定結果。これは worktree で個々の作業を隔離しても、統合段階の衝突率そのものは下がらないことを示す数字であり、rollnuts（§2-4）の主張と方向が一致する。

### 3-3. AgentRoom（arXiv 2608.23740）— worktree/ファイル隔離の代替（CRDT共有ワークスペース）

出典: https://arxiv.org/abs/2608.23740 （直読、要約経由）。git worktree に名指しで言及はしていないが、「フェーズ分割 or 独立サンプルのプールのどちらか」という既存の並列コーディング手法（worktree 隔離もこの後者に含まれる）に対する代替として、CRDT でマージされる共有ファイルシステム上に file-level claim/status/broadcast を MCP tool として公開する設計を提案。測定結果:
> "For CLI-stable models, AgentRoom with 2 agents abandons fewer tasks than Solo and has less run-to-run variation. At matched-compute, one positive mean LLM-judge contrast puts AgentRoom over parallel-merge."
> "Coordination, not parallelism or CRDT-merge, bears the load."

→ 著者自身の結論は「並列性そのものや CRDT マージ機構が効いているのではなく、エージェント間の調整（coordination）が効いている」というもので、**worktree 隔離＋事後マージという型自体を積極的に否定する結果ではない**（比較対象は "parallel-merge" という一手法で、Claude Code/Codex/omp の実装と同一かは不明[unverified]）。

---

## 4. 実態（in the wild）— API 直読の星数・活動状況

| リポジトリ | 星数 | 最終 push | 備考 |
|---|---|---|---|
| `generalaction/emdash` | 5,850 | 2026-09-27 | open issues 93、活発 |
| `superset-sh/superset` | 14,670 | 2026-09-27 | open issues 787、活発 |
| `stravu/crystal` | 3,122 | 2026-02-26 | **2026年2月に deprecated、後継 Nimbalyst へ移行**（WebSearch 要約による、原文未確認） |
| `pasky/pi-side-agents` | 193 | 2026-09-24 | 実名実践者（Petr Baudis）、活発 |
| `wweir/tower-do` | 0 | 2026-09-23 | Kimi Tower の pi 移植、採用実績ゼロ |
| `tmustier/pi-agent-teams` | 108 | 2026-06-20（依存更新PRのみ、mainは6/12で停止） | worktree 肥大化 issue #9 未修正、issue #50 クラッシュ未修正 |

（emdash は `jasonkneen/emdash` / `tkohout/emdash` / `generalaction/emdash` の少なくとも3つのフォーク名がヒットしており、どれが canonical か・fork 関係かは今回未確認[unverified]。上表は最も star 数の多かった `generalaction/emdash` の数値。）

`Conductor` は GitHub 上に公開リポジトリが見当たらず（クローズドソースの Mac アプリと見られる）、star 数等の API 直読はできなかった[未到達]。

---

## 5. git 公式ドキュメントによる制約の確認

出典: https://git-scm.com/docs/git-worktree （直読、要約経由）

**同一ブランチの二重チェックアウト**: 既定で拒否される。
> "By default, `add` refuses to create a new worktree when `<commit-ish>` is a branch name and is already checked out by another worktree" — `--force` でのみ上書き可能。

**`git worktree prune`**: 手動削除された worktree の管理ファイル（`$GIT_DIR/worktrees` 配下）を掃除するコマンド。
> "Remove worktree information in `$GIT_DIR/worktrees` for worktrees whose working trees are missing... but use 'git worktree remove' next time you want to do so."
`-n`（dry-run）、`--expire <time>` オプションあり。

**`lock`/`unlock`**: lock は自動 prune・move・delete を防ぐ。
> "If a worktree is on a portable device or network share which is not always mounted, lock it to prevent its administrative files from being pruned automatically. This also prevents it from being moved or deleted."

**サブモジュール**: 複数チェックアウトは実験的機能で、サブモジュールとの併用は「推奨されない」と明記。
> "Multiple checkout in general is still experimental, and the support for submodules is incomplete. It is NOT recommended to make multiple checkouts of a superproject."
サブモジュールを含む worktree は `git worktree move` で移動できない、という制約も別途ある。

**管理ファイルの残留**: `git worktree remove` を使わず手動でディレクトリを消すと、管理ファイルは自動 gc（`gc.worktreePruneExpire`）まで残り続ける。
> "If a working tree is deleted without using `git worktree remove`, then its associated administrative files... will eventually be removed automatically... or you can run `git worktree prune`"

---

## 比較表（作る単位／戻し方／衝突時／片付け／依存の準備／失敗例）

| 対象 | 作る単位 | 戻し方 | 衝突時 | 片付け | 依存・ignore ファイルの用意 | 失敗例（同じ重みで） |
|---|---|---|---|---|---|---|
| Claude Code `--worktree`/subagent | 実 git worktree（`.claude/worktrees/<name>`、新ブランチ） | 規定なし。人間が標準 git/PR で戻す | 4種のツールコールブロックでメインチェックアウトへの越境自体を拒否。マージ衝突自体は git 任せ | クリーンなら自動削除、汚れていれば確認。`-p` は放置し stale-lock sweep 任せ | `.worktreeinclude`（gitignore構文）で `.env` 等を自動コピー | LFS/filter driver は意図的に無効化されpointerのまま残る（vendor自身が明記） |
| Claude Code バックグラウンドセッション | 同上（自動で worktree に移動） | **commit→push→draft PR まで自動、merge/force-push/mainへのpushは絶対にしない** | 同上 | 同上 | 同上 | 記載なし |
| Claude Code agent teams | **隔離しない**（同一チェックアウト） | teammate は直接コミット可能、明示のマージ工程は無い | 「担当ファイルを分けよ」という運用ルールのみ、機構的な防止なし | セッション終了で team config 自動削除、task list は保持 | 該当なし（隔離自体が無い） | mailbox不正エントリでv2.1.207未満は配送全停止（vendor既知バグ）、in-processは resume/rewind非対応 |
| Codex worktree | 実 git worktree、**detached HEAD** | クラウド task は `codex apply`（`git apply`）、Handoffでローカル⇔worktree間を移動 | `git apply` が衝突で非ゼロ終了。詳細な解決手順は非公開 | 直近15個のみ自動保持、削除前にスナップショット | `.worktreeinclude`（Claude Codeと同名同構文） | ディスク使用量の増大をvendor自身が注意書き |
| Kimi Code Tower | 専用 git worktree（`.tower/worktrees/wt-N`） | `TowerMerge`＝レビューgate＋依存関係チェック＋スコープ検査、`--no-ff` | 3条件のいずれか未達で拒否理由を返す（マージ自体を止める） | `TowerTeardown` ツールあり（詳細未精読） | 未確認 | 既定 off の実験機能、専用UIなし、コスト上限機構が見当たらない[unverified] |
| omp `isolated: true` | git worktree **ではない**、FS copy-on-write | パッチ取り込み or `omp/task/<id>` へコミットしてチェリーピック | 未確認 | 完了時に自動破棄、再開不可 | 未確認 | 待っている子はAgent Hubに出ない、費用/トークンをAPIから取得不可（既存記録） |
| Petr Baudis pi-side-agents | git worktree、**タスクごとの使い捨てではなく再利用** | 人間が"LGTM, merge"と入力→エージェントがgit merge実行 | 未確認（"メインツリーの並行編集を避けよ"という予防策のみ） | 再利用時に古いブランチを自動prune | 未確認 | 未確認（README上の既知issueは "docs/recovery.md" の存在のみ示唆） |
| Conductor | git worktree＋ブランチ、origin fetch後に作成 | "Review and PR flow"としか記載なし、詳細不明 | 未確認 | 未確認 | 未確認 | 未確認 |
| Crystal（→Nimbalyst） | git worktree | "squash and rebase to main"（要約経由、詳細未確認） | 未確認 | "archive folders on merge"（要約経由） | 未確認 | **2026年2月に製品自体が終了、後継への切替を強制**（最も重い失敗例） |

---

## まとめ表（四方向）

| レンズ | 対象 | タスク種別 | 結果 | コスト数値 | 名指しの失敗モード |
|---|---|---|---|---|---|
| ベンダー | Claude Code worktrees/agent-view | コーディング全般 | worktree隔離＋commit/push/draft PR自動、merge手動 | no numbers | LFS pointer残留、`-p`実行のlock放置 |
| ベンダー | Codex worktrees | コーディング全般 | detached HEAD worktree、`codex apply`でパッチ適用 | no numbers | `git apply`衝突で非ゼロ終了、ディスク肥大化の自己警告 |
| ベンダー | Kimi Code Tower | コーディング全般 | レビューゲート付き`--no-ff`マージ | no numbers | 既定off、専用UI無し、コスト上限なし[unverified] |
| ベンダー | omp `isolated: true` | コーディング全般 | copy-on-write＋パッチ/チェリーピック | no numbers | 待機中の子が不可視、費用取得不可 |
| 実践者 | Petr Baudis (pi-side-agents) | コーディング全般 | 人間承認後にエージェントがmerge実行、worktree再利用 | no numbers | メインツリー並行編集の注意のみ |
| 実践者 | brtkwr.com | コーディング全般 | 自作スクリプトで一括清掃 | **256→28 worktree、28GB→27GB回収、700+古いブランチ削除、46リポジトリ** | 標準機構では消えない残骸の実測 |
| 実践者 | Laurent Kempé | コーディング全般（.NET/Windows） | Worktrunk＋git bare clone | no numbers | ターミナルタブ誤クローズでエージェント消失 |
| 実践者 | rollnuts（否定） | コーディング全般 | worktreeは実行問題のみ解決、マージ問題は未解決と主張 | AgenticFlictの27.67%を援用 | 意味的衝突がGit上は「クリーンにマージ」されて発覚しない |
| 実践者 | tmustier/pi-agent-teams | コーディング全般 | worktree自動GCが不十分 | **1ヶ月で1,195セッションdir・10 worktree(~2.2GB)** | mainコミット3.5ヶ月超停止、修正PR5ヶ月超未マージ |
| 測定 | AgenticFlict (arXiv 2604.03551) | 実PR（コーディング） | マージ衝突率 27.67% | 142K+ PR、59K+ repo、29K+ 衝突PR | 「クリーンにマージされて後で壊れる」静かな失敗の指摘 |
| 測定 | AIDev-pop (arXiv 2607.04697) | 実PR（コーディング） | cross-agent衝突41.7% vs intra-agent 19.8% | 33,596 PR、2,807 repo | 同時活動重複40.2%→53.4%(1週間) |
| 測定 | AgentRoom (arXiv 2608.23740) | コーディング（ベンチマーク環境） | 調整機構がworktree型より効くという主張 | no numbers（LLM-judge比較のみ） | 「並列性やCRDTマージ自体は効かない」という自己否定的結論 |
| 実態 | emdash/Superset | — | 活発（★5,850/14,670、直近push） | — | open issues 93/787（未精査） |
| 実態 | Crystal→Nimbalyst | — | **製品終了・移行** | — | 2026年2月deprecated |
| 実態 | wweir/tower-do | — | 採用実績ゼロ | — | ★0 |
| 実態 | pi-agent-teams | — | 事実上メンテ停止 | — | main停止3.5ヶ月超、issue放置 |

---

## 確認できなかったこと

1. AgenticFlict のエージェント別内訳（Copilot 15.43%・Codex 32.31%）は WebSearch の要約のみで、arXiv abstract の直接フェッチでは確認できなかった。本文（PDF）レベルの検証はしていない。
2. Superset・emdash・Crystal の README/ドキュメント原文（squash/rebase/archive-on-merge の実装詳細）は WebSearch 要約止まりで、個別ページを WebFetch で直読していない。
3. Conductor は公開リポジトリが見当たらず、GitHub API での星数・issue 状況が取得できなかった。
4. Kimi Tower の `TowerTeardown`（worktree の後始末）の実装詳細、コスト上限機構の有無は前回調査（`kimi-code.md`）でも `[unverified]` のまま。
5. `emdash` の `jasonkneen/emdash` / `tkohout/emdash` / `generalaction/emdash` のどれが canonical でどれがフォークかは未確認。
6. AgentRoom の比較対象 "parallel-merge" が、本記録で扱った Claude Code/Codex/omp いずれかの実装と同一かどうかは論文本文を読んでいないため不明。
7. Laurent Kempé・rollnuts 記事以外に、「worktree をやめた」と明言する実名実践者の一次記事は今回の検索範囲では見つからなかった（HN・Reddit 個別コメントは未読）。
8. omp `isolated: true` の衝突時挙動、依存関係（node_modules等）の用意方法は `seams.md` 時点でも未確認のまま引き継ぎ。

## 前例なし（no precedent found）

- **worktree 隔離＋自動マージ（人間レビューなし）を既定で行うベンダー実装**: Claude Code・Codex ともに「マージは人間の仕事」で揃っており、自動マージを既定にした一次資料は見つからなかった。
- **git worktree 隔離をレビューゲート付きで自動マージする実装が「既定 on」かつ「利用実績あり」の組み合わせ**: Kimi Tower（既定off・専用UIなし）、`wweir/tower-do`（★0）のいずれも条件を満たさない。
- **worktree 隔離の「意味的衝突」対策を統制実験で検証した研究**: AgentRoom は LLM-judge による比較のみで、統制された A/B の定量実験ではない。
- **複数の独立した実践者が同一の「戻し方の型」に収束したという証拠**: 今回集めた実践者はそれぞれ異なる型（人間承認→エージェントmerge／自作清掃スクリプト／サードパーティのworktree管理ツール）を使っており、単一の型への収束は確認できなかった。
