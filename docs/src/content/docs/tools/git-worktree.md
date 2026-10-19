---
title: Git Worktree (wtp)
description: Git worktree で parallel に開発する CLI。
---

wtp は git worktree を管理する CLI。stash や branch switch なしで、複数の branch を同時に作業できる。

## いつ使うか

- 複数の branch を同時に作業する場合
- 2 つの実装を side by side で比較する場合
- 別の directory で PR を review する場合

## 基本

```bash
# worktree 一覧
wtp list

# feature branch の worktree を追加
wtp add feature/user-auth

# 新しい branch を作って追加
wtp add -b feature/api-refactor

# merge 後に削除
wtp remove feature/user-auth

# worktree に switch
cd "$(wtp cd feature/user-auth)"
```

## Directory の置き場所

worktree は `base_dir`（既定は `../worktrees`）の下に branch 名で作られる。移動は `cd "$(wtp cd <branch>)"`。

branch の type: `feature`, `bugfix`, `hotfix`, `experiment`, `refactor`

## Config

リポジトリ直下の `.wtp.yml` に書く（`wtp init` が雛形を作る）:

```yaml
version: "1.0"
defaults:
  base_dir: ../worktrees
```

## Recipes

### Feature 作業中の hotfix

```bash
# feature で作業中
cd ~/project-feature-auth

# 緊急の bug が来た
wtp add -b hotfix/critical-bug
cd "$(wtp cd hotfix/critical-bug)"

# 修正、push、feature に戻る
cd ~/project-feature-auth

# merge 後に cleanup
wtp remove hotfix/critical-bug
```

### Approach の比較

```bash
# Approach A
wtp add -b experiment/approach-a
cd "$(wtp cd experiment/approach-a)"

# Approach B
wtp add -b experiment/approach-b
cd "$(wtp cd experiment/approach-b)"

# 比較して良い方を残す
```

### Local PR review

```bash
wtp add -b review/pr-123 origin/pull/123
cd "$(wtp cd review/pr-123)"

# review 後に cleanup
wtp remove review/pr-123
```

## Interactive mode (wt + skim)

| Command | 操作 |
|---------|------|
| `wt` | interactive menu (`Alt+W` でも起動) |
| `wt list` | worktree 一覧 |
| `wt cd` | worktree に switch (interactive) |
| `wt add` | worktree を作成 |
| `wt rm` | worktree を削除 (confirmation 付き) |

短縮形: `wtcd`, `wtadd`, `wtrm`, `wtls`

Keybinding: `Alt+W` で menu を開く。

preview に最近の commit と git status が表示される。
