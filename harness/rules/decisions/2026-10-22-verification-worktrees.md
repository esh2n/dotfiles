# 確認用の worktree はブランチを持たせずに作り、作り直せるファイルだけなら持ち主に聞かずに消す

Status: accepted — 持ち主の裁定（2026-10-22）。2026-09-27-one-worktree-layout.md の「隔離はブランチ `<名前>` 付き」と、80-pstack.md の worktree の行のうち「ignore されたファイルがあれば消さない」を、確認用の worktree と作り直せるファイルについて置き換える

rule: An agent that makes a worktree only to read, build or run code — reviewing a PR head, checking main — makes it at `.claude/worktrees/<name>` with `git worktree add --detach`, not on a branch unless a tool it runs needs a branch name (then the branch is left to the owner), and removes it itself when done. Any worktree may be removed without asking when it has no commits that no branch or remote holds, no tracked changes, no untracked files, and every ignored file is either under a rebuildable path (`node_modules/`, `dist/`, `build/`, `out/`, `target/`, `.venv/`, `.next/`, `.turbo/`, `coverage/`, `__pycache__/`) or a `.worktreeinclude` copy identical to the main checkout's file; remove it with `git worktree remove` and no `--force`, never `rm -rf`. Any other ignored file keeps the worktree in place and is reported with its path.

## Problem

レビューのたびに、エージェントが自分で作った確認用の worktree が残る。

- PR の head を確かめるためにブランチを作ると、そのブランチは main にマージされない。80-pstack.md の行は「マージ済みのものだけ消す」なので、エージェントは消せない。`git branch -d` も失敗し、消すには `-D` が要る。
- `pnpm install` やビルドを実行すると、`node_modules` と `dist` が残る。80-pstack.md の行は「ignore されたファイルがあれば消さない」なので、ここでも消せない。

どちらの場合も、消すには持ち主の許可が毎回要る。しかも中身は、エージェントが作ったものと、作り直せるファイルだけである。

## Decision

- 読む、ビルドする、実行するだけの worktree は、`git worktree add --detach .claude/worktrees/<名前> <コミット>` で作る。detached HEAD はブランチではなくコミットを直接指す状態で、ブランチを作らないので、マージの条件も `branch -D` も関係しなくなる。
- 確認が終わったら、エージェントが自分で消す。消してよい条件は次のすべてを満たすことである。
  1. どのブランチにもリモートにも無いコミットが無い（`git log HEAD --not --branches --remotes` が空）。
  2. tracked ファイルの変更が無く、未追跡のファイルも無い（`git status --porcelain` が空）。
  3. `git status --porcelain --ignored` が出す ignore されたファイルが、どれも作り直せる場所の下にあるか、`.worktreeinclude` で写したもので、main のチェックアウトにある元のファイルと中身が同じ（`cmp` で一致）。作り直せる場所は rule 行の一覧に限る。
- 消すときは `git worktree remove <path>` を使い、`--force` は付けない。`rm -rf` は使わない。
- 条件 3 を満たさないファイルが一つでもあれば、消さずにそのファイルのパスを持ち主に伝える。
- 確認に使うツールがブランチ名を読む場合（detached HEAD でエラーになるか、違う動きをする場合）だけ、確認用でもブランチ `<名前>` 付きで作る。そのブランチの片付けは持ち主に任せる。
- 作業用の worktree（ブランチ `<名前>` 付き）にも同じ条件を使う。ブランチの片付け（`git branch -d`）は、これまでどおりマージのあとに持ち主が決める。

## Alternatives considered

- **ignore されたファイルを判定から外す（git 本体と同じ）**: 一番単純だが、worktree の中で作った `.env` やローカルのデータベースファイルも黙って消える。git 本体は ignore されたファイルを守らない（https://git-scm.com/docs/git-worktree の「Only clean worktrees (no untracked files and no modification in tracked files) can be removed.」、2026-10-21 に手元で確認）。採らない。
- **今のまま、毎回持ち主に聞く**: レビューのたびに同じ確認が要り、中身は作り直せるものだけである。採らない。
- **pstack の手順どおり、ビルド結果が残るなら `rm -rf`**: pstack の `worktree-cleanup` は「If the dir survives on ignored build artifacts, `rm -rf` it」と書く。ignore されたファイルの中身を見ずに消すので、作り直せないファイルも消える。この経路は https://github.com/cursor/plugins/issues/449 で報告され、2026-10-21 時点で open。採らない。

## Consequences

- `rules/common/80-pstack.md` の worktree の行を、rule 行に合わせて書き換える。
- `pstack-adapter` の worktrees の節と、`using-git-worktrees` に、確認用の worktree の作り方と、消してよい条件の確かめ方（上の 3 つのコマンド）を足す。
- 2026-09-27-one-worktree-layout.md の Status に、確認用の worktree についてはこの記録が置き換えると書く。
- guard の `ask-git-worktree-remove-force` はそのまま残す。`--force` は条件を満たす worktree では要らないからである。

## Sources

- git の公式ドキュメントは、ブランチを持たない worktree をこの用途に勧めている（https://git-scm.com/docs/git-worktree 、「If you just plan to make some experimental changes or do testing without disturbing existing development, it is often convenient to create a throwaway worktree not associated with any branch.」、手元の `git help worktree` で 2026-10-22 に確認）。
- Claude Code は、自分が作った worktree を、変更が無ければ終了時に自動で消し、変更があれば消すか残すかを人に聞く（https://code.claude.com/docs/en/worktrees）。ignore されたファイルの扱いは書かれていない。
- Codex アプリは、直近 15 個を超えた worktree を消す前にスナップショットを残す（https://learn.chatgpt.com/docs/environments/git-worktrees）。
- 後始末で作業が消えた報告は、どれも未コミットの変更、未追跡のファイル、push していないコミットが消えたものである（Claude Code の https://github.com/anthropics/claude-code/issues/29110 、https://github.com/anthropics/claude-code/issues/35862 、Codex の https://github.com/openai/codex/issues/48196 、https://forum.cursor.com/t/archiving-an-agent-deletes-its-dirty-worktree-without-confirmation/167129 ）。ignore されたファイルが消えて困った報告は見つからなかった。
