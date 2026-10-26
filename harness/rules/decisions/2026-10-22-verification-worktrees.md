# 確認用のworktreeはブランチを持たせずに作り、作り直せるファイルだけなら持ち主に聞かずに消す

Status: accepted — 持ち主の裁定（2026-10-22）。2026-09-27-one-worktree-layout.mdの「隔離はブランチ`<名前>`付き」と、80-pstack.mdのworktreeの行のうち「ignoreされたファイルがあれば消さない」を、確認用のworktreeと作り直せるファイルについて置き換える

rule: An agent that makes a worktree only to read, build or run code — reviewing a PR head, checking main — makes it at `.claude/worktrees/<name>` with `git worktree add --detach`, not on a branch unless a tool it runs needs a branch name (then the branch is left to the owner), and removes it itself when done. Any worktree may be removed without asking when it has no commits that no branch or remote holds, no tracked changes, no untracked files, and every ignored file is either under a rebuildable path (`node_modules/`, `dist/`, `build/`, `out/`, `target/`, `.venv/`, `.next/`, `.turbo/`, `coverage/`, `__pycache__/`) or a `.worktreeinclude` copy identical to the main checkout's file; remove it with `git worktree remove` and no `--force`, never `rm -rf`. Any other ignored file keeps the worktree in place and is reported with its path.

## Problem

レビューのたびに、エージェントが自分で作った確認用のworktreeが残る。

- PRのheadを確かめるためにブランチを作ると、そのブランチはmainにマージされない。80-pstack.mdの行は「マージ済みのものだけ消す」なので、エージェントは消せない。`git branch -d`も失敗し、消すには`-D`が要る。
- `pnpm install`やビルドを実行すると、`node_modules`と`dist`が残る。80-pstack.mdの行は「ignoreされたファイルがあれば消さない」なので、ここでも消せない。

どちらの場合も、消すには持ち主の許可が毎回要る。しかも中身は、エージェントが作ったものと、作り直せるファイルだけである。

## Decision

- 読む、ビルドする、実行するだけのworktreeは、`git worktree add --detach .claude/worktrees/<名前> <コミット>`で作る。detached HEADはブランチではなくコミットを直接指す状態で、ブランチを作らないので、マージの条件も`branch -D`も関係しなくなる。
- 確認が終わったら、エージェントが自分で消す。消してよい条件は次のすべてを満たすことである。
  1. どのブランチにもリモートにも無いコミットが無い（`git log HEAD --not --branches --remotes`が空）。
  2. trackedファイルの変更が無く、未追跡のファイルも無い（`git status --porcelain`が空）。
  3. `git status --porcelain --ignored`が出すignoreされたファイルが、どれも作り直せる場所の下にあるか、`.worktreeinclude`で写したもので、mainのチェックアウトにある元のファイルと中身が同じ（`cmp`で一致）。作り直せる場所はrule行の一覧に限る。
- 消すときは`git worktree remove <path>`を使い、`--force`は付けない。`rm -rf`は使わない。
- 条件3を満たさないファイルが一つでもあれば、消さずにそのファイルのパスを持ち主に伝える。
- 確認に使うツールがブランチ名を読む場合（detached HEADでエラーになるか、違う動きをする場合）だけ、確認用でもブランチ`<名前>`付きで作る。そのブランチの片付けは持ち主に任せる。
- 作業用のworktree（ブランチ`<名前>`付き）にも同じ条件を使う。ブランチの片付け（`git branch -d`）は、これまでどおりマージのあとに持ち主が決める。

## Alternatives considered

- **ignoreされたファイルを判定から外す（git本体と同じ）**: 一番単純だが、worktreeの中で作った`.env`やローカルのデータベースファイルも黙って消える。git本体はignoreされたファイルを守らない（https://git-scm.com/docs/git-worktree の「Only clean worktrees (no untracked files and no modification in tracked files) can be removed.」、2026-10-21に手元で確認）。採らない。
- **今のまま、毎回持ち主に聞く**: レビューのたびに同じ確認が要り、中身は作り直せるものだけである。採らない。
- **pstackの手順どおり、ビルド結果が残るなら`rm -rf`**: pstackの`worktree-cleanup`は「If the dir survives on ignored build artifacts, `rm -rf` it」と書く。ignoreされたファイルの中身を見ずに消すので、作り直せないファイルも消える。この経路は https://github.com/cursor/plugins/issues/449 で報告され、2026-10-21時点でopen。採らない。

## Consequences

- `rules/common/80-pstack.md`のworktreeの行を、rule行に合わせて書き換える。
- `pstack-adapter`のworktreesの節と、`using-git-worktrees`に、確認用のworktreeの作り方と、消してよい条件の確かめ方（上の3つのコマンド）を足す。
- 2026-09-27-one-worktree-layout.mdのStatusに、確認用のworktreeについてはこの記録が置き換えると書く。
- guardの`ask-git-worktree-remove-force`はそのまま残す。`--force`は条件を満たすworktreeでは要らないからである。

## Sources

- gitの公式ドキュメントは、ブランチを持たないworktreeをこの用途に勧めている（https://git-scm.com/docs/git-worktree 、「If you just plan to make some experimental changes or do testing without disturbing existing development, it is often convenient to create a throwaway worktree not associated with any branch.」、手元の`git help worktree`で2026-10-22に確認）。
- Claude Codeは、自分が作ったworktreeを、変更が無ければ終了時に自動で消し、変更があれば消すか残すかを人に聞く（https://code.claude.com/docs/en/worktrees）。ignore されたファイルの扱いは書かれていない。
- Codexアプリは、直近15個を超えたworktreeを消す前にスナップショットを残す（https://learn.chatgpt.com/docs/environments/git-worktrees）。
- 後始末で作業が消えた報告は、どれも未コミットの変更、未追跡のファイル、pushしていないコミットが消えたものである（Claude Codeの https://github.com/anthropics/claude-code/issues/29110 、https://github.com/anthropics/claude-code/issues/35862 、Codexの https://github.com/openai/codex/issues/48196 、https://forum.cursor.com/t/archiving-an-agent-deletes-its-dirty-worktree-without-confirmation/167129 ）。ignoreされたファイルが消えて困った報告は見つからなかった。
