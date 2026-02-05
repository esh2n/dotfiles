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

# custom path を指定
wtp add feature/api-refactor ../project-api-refactor

# merge 後に削除
wtp remove feature/user-auth

# worktree に switch
wtp switch feature/user-auth

# stale な entry を cleanup
wtp prune
```

## Directory naming convention

```text
../project-<type>-<description>
```

Types: `feature`, `bugfix`, `hotfix`, `experiment`, `refactor`

## Config

`.wtp.local.yml` で個人設定 (gitignore 済み):

```yaml
default_path: "../worktrees"
auto_cleanup: true
```

## Recipes

### Feature 作業中の hotfix

```bash
# feature で作業中
cd ~/project-feature-auth

# 緊急の bug が来た
wtp add hotfix/critical-bug
cd ../project-hotfix-critical-bug

# 修正、push、feature に戻る
cd ~/project-feature-auth

# merge 後に cleanup
wtp remove hotfix/critical-bug
```

### Approach の比較

```bash
# Approach A
wtp add experiment/approach-a
cd ../project-experiment-approach-a

# Approach B
wtp add experiment/approach-b
cd ../project-experiment-approach-b

# 比較して良い方を残す
```

### Local PR review

```bash
wtp add review/pr-123 origin/pull/123
cd ../project-review-pr-123

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
