---
title: Git Aliases
description: 最小 keystroke で git 操作するための alias。
---

小文字が通常操作、大文字が強力/破壊的な操作、というruleで統一。

## 基本操作

| Alias | Command |
|-------|---------|
| `ga` | `git add` |
| `gA` | `git add --all` |
| `gc` | `git commit` |
| `gC` | `git commit --amend` |
| `gcm` | `git commit -m` |
| `gCm` | `git commit --amend -m` |

## Push / Pull / Fetch

| Alias | Command | 備考 |
|-------|---------|------|
| `gpso [branch]` | `git push origin` | 引数なしでinteractive選択 |
| `gPso [branch]` | `git push --force origin` | 引数なしでinteractive選択 |
| `gpl` | `git pull` | |
| `gf` | `git fetch` | |

## Branch

| Alias | Command | 備考 |
|-------|---------|------|
| `gb` | `git branch` | 一覧表示 |
| `gsw [branch]` | `git switch` | 引数なしでinteractive選択 |
| `gswc` | `git switch -c` | 新規作成 |
| `grn` | `git branch -m` | rename |

## Merge

| Alias | Command | 備考 |
|-------|---------|------|
| `gm` | `git merge` | |
| `gM` | `git merge --no-ff` | 履歴を残す |
| `gma` | `git merge --abort` | |

## Diff

| Alias | Command | 備考 |
|-------|---------|------|
| `gd` | `git diff` | |
| `gD` | `git diff --cached` | stagedのdiff |
| `gds` | `git diff --stat` | |

## Rebase

| Alias | Command | 備考 |
|-------|---------|------|
| `gr` | `git rebase` | |
| `gR` | `git rebase -i` | interactive mode |
| `grc` | `git rebase --continue` | |
| `gra` | `git rebase --abort` | |

## Reset

| Alias | Command |
|-------|---------|
| `grs` | `git reset` |
| `grs1` | `git reset --hard HEAD~1` |
| `grs2` | `git reset --hard HEAD~2` |
| `grs3` | `git reset --hard HEAD~3` |

## Restore

| Alias | Command | 備考 |
|-------|---------|------|
| `grt` | `git restore` | |
| `gRt` | `git restore --staged` | stage解除 |

## Stash

| Alias | Command |
|-------|---------|
| `gst` | `git stash` |
| `gSt` | `git stash pop` |
| `gsta` | `git stash apply` |
| `gstl` | `git stash list` |
| `gstd` | `git stash drop` |

## Interactive操作 (skimベース)

引数ありで直接指定、引数なしでskimによるinteractive選択に切り替わるalias。

| Alias | 引数なし | 引数あり |
|-------|---------|---------|
| `gsw` | branchを選択してswitch | 指定branchにswitch |
| `gpso` | branchを選択してpush | 指定branchをpush |
| `gPso` | branchを選択してforce push | 指定branchをforce push |

skim専用のinteractive alias。

| Alias | 説明 |
|-------|------|
| `gbd` | local branchを選択して削除 |
| `gme` | branchを選択して`--no-ff --edit` merge |
| `gmesq` | branchを選択して`--squash` merge |
| `gpr` | base branchを選択してPR作成 |
| `glo` | branchを選択してlog表示 |
| `gtr` | 全branchのlogをgraph表示 |

## その他

| Alias | Command |
|-------|---------|
| `gs` | `git status -sb` |
| `gg` | `git grep` |
| `gi` | `git init` |
| `gcl` | `git clone` |

## Code review (difit + skim)

| Command | 説明 |
|---------|------|
| `gifit` | 2つのcommitを選択してdifitでdiff表示 |
| `gdif [N]` | 直近N commitのdiffを表示 (default: 1) |

```bash
# interactive に commit 範囲を選択
gifit

# 直前の commit を確認
gdif

# 直近 3 commit を確認
gdif 3
```
