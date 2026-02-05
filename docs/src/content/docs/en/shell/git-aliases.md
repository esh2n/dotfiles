---
title: Git Aliases
description: Minimal-keystroke aliases for everyday git operations.
---

The convention: lowercase for normal operations, uppercase for powerful or destructive ones.

## Basics

| Alias | Command |
|-------|---------|
| `ga` | `git add` |
| `gA` | `git add --all` |
| `gc` | `git commit` |
| `gC` | `git commit --amend` |
| `gcm` | `git commit -m` |
| `gCm` | `git commit --amend -m` |

## Push / Pull / Fetch

| Alias | Command | Note |
|-------|---------|------|
| `gpso [branch]` | `git push origin` | Interactive picker when no args |
| `gPso [branch]` | `git push --force origin` | Interactive picker when no args |
| `gpl` | `git pull` | |
| `gf` | `git fetch` | |

## Branch

| Alias | Command | Note |
|-------|---------|------|
| `gb` | `git branch` | List |
| `gsw [branch]` | `git switch` | Interactive picker when no args |
| `gswc` | `git switch -c` | Create |
| `grn` | `git branch -m` | Rename |

## Merge

| Alias | Command | Note |
|-------|---------|------|
| `gm` | `git merge` | |
| `gM` | `git merge --no-ff` | Preserve history |
| `gma` | `git merge --abort` | |

## Diff

| Alias | Command | Note |
|-------|---------|------|
| `gd` | `git diff` | |
| `gD` | `git diff --cached` | Staged changes |
| `gds` | `git diff --stat` | |

## Rebase

| Alias | Command | Note |
|-------|---------|------|
| `gr` | `git rebase` | |
| `gR` | `git rebase -i` | Interactive |
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

| Alias | Command | Note |
|-------|---------|------|
| `grt` | `git restore` | |
| `gRt` | `git restore --staged` | Unstage |

## Stash

| Alias | Command |
|-------|---------|
| `gst` | `git stash` |
| `gSt` | `git stash pop` |
| `gsta` | `git stash apply` |
| `gstl` | `git stash list` |
| `gstd` | `git stash drop` |

## Interactive (skim-based)

These aliases switch between direct and interactive mode depending on whether you pass an argument.

| Alias | No args | With args |
|-------|---------|-----------|
| `gsw` | Pick branch and switch | Switch to named branch |
| `gpso` | Pick branch and push | Push named branch |
| `gPso` | Pick branch and force push | Force push named branch |

Interactive-only aliases:

| Alias | What it does |
|-------|-------------|
| `gbd` | Pick a local branch to delete |
| `gme` | Pick a branch to merge with `--no-ff --edit` |
| `gmesq` | Pick a branch to squash merge |
| `gpr` | Pick a base branch for PR creation |
| `glo` | Pick a branch and show log graph |
| `gtr` | Show all branches as a log graph |

## Misc

| Alias | Command |
|-------|---------|
| `gs` | `git status -sb` |
| `gg` | `git grep` |
| `gi` | `git init` |
| `gcl` | `git clone` |

## Code review (difit + skim)

| Command | What it does |
|---------|-------------|
| `gifit` | Pick 2 commits and view diff in difit |
| `gdif [N]` | View diff for last N commits (default: 1) |

```bash
# Interactive commit range selection
gifit

# Review the last commit
gdif

# Review the last 3 commits
gdif 3
```
