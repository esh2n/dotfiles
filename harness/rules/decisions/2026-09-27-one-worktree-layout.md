# 作業の隔離はどのハーネスでも一つの形にし、合流は持ち主が決める

Status: accepted — 持ち主の裁定（2026-09-27）。隔離の形をハーネスごとに変えず、専用のコマンドも足さない

rule: Work in the current checkout by default; parallel workers whose files overlap wait instead of sharing them. When isolation is needed, every harness (Claude Code, Codex, pi, omp, the Swarm) makes the same thing with plain git — a worktree at `.claude/worktrees/<name>` on a branch named `<name>`, ignored through the repository's `info/exclude`, with only `.worktreeinclude`-listed ignored files copied in — never a harness's own isolation form. Merging back is the owner's decision, done with `git merge --no-ff <name>`, then `git worktree remove` and `git branch -d`; nothing merges automatically, no dedicated command is added, and unmerged or dirty worktrees are never force-removed.

## Problem

隔離の形がハーネスごとに違っていた。Claude Code は `.claude/worktrees/<名前>` にブランチ付きの worktree、Codex はブランチを持たない worktree（detached HEAD）、omp は git の worktree ではなくファイルを写した一時的な場所。スキル `using-git-worktrees` も「そのハーネスのやり方を優先する」と書いていた。どのハーネスで何が起きるかを覚えておく必要があった。

## Decision

- 基本は今のチェックアウトで作業する。一つのセッションの中で作業役を動かす場合は同じチェックアウトが実践の基本（Claude Code の agent teams、omp の子の既定、@voidwarriorchan の `direct · changes immediate`）。範囲が重なる作業役は順番待ちにする。
- 隔離が要るときは、どのハーネスでも `.claude/worktrees/<名前>` にブランチ `<名前>` を普通の git で作る。`.claude/worktrees/` はリポジトリの `info/exclude` で無視し、コミットされる `.gitignore` は触らない。git が無視しているファイルは `.worktreeinclude` に書かれたものだけを写す（Claude Code と Codex が同じ名前・同じ書き方で使う）。
- 戻すのは持ち主が決めたときだけ。`git merge --no-ff <名前>`、そのあと `git worktree remove` と `git branch -d`。専用のコマンドは作らない。
- 未マージのブランチや、コミットしていない変更のある worktree は消さない。

## Alternatives considered

- **ハーネスごとの隔離をそのまま使う**: 覚えておく負荷の原因そのもの。却下。
- **`jig worktree` のような入り口を足す**: 覚えるコマンドが一つ増える。却下。
- **条件を満たせば自動でマージする（Kimi Code の Tower 型）**: 自動でマージして使われている実装は見つからず（Tower は既定 off の試験機能、Crystal は製品終了）、ベンダー（Claude Code、Codex）も実践者（Petr Baudis の pi-side-agents）もマージを人に任せている。git がきれいにマージできても意味の上で壊れる例がある（https://dev.to/rollnuts/git-worktrees-arent-enough-for-parallel-ai-agents-38b7 、https://arxiv.org/abs/2604.03551 ）。採らない。

## Consequences

- スキル `using-git-worktrees` を書き直した（ネイティブの道具を優先する記述をやめ、一つの形と、持ち主が決める合流の手順を書いた）。
- Swarm の隔離（`harness/jig/src/app/swarm/worktree.ts`）も同じ形で、Swarm 自身が作ったマージ済みのものだけを片付ける。
- Claude Code の `EnterWorktree` などネイティブの道具が別の名前を付ける場合は、使わずに普通の git で作る。

## Sources

- https://dev.to/rollnuts/git-worktrees-arent-enough-for-parallel-ai-agents-38b7 、https://arxiv.org/abs/2604.03551 、https://arxiv.org/abs/2607.04697
- `rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`（Steinberger、Bun の書き直し）
