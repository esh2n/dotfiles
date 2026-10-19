---
title: Git Worktree (wtp)
description: Parallel development with git worktrees.
---

wtp is a CLI for managing git worktrees. Work on multiple branches at the same time without stashing or switching.

## When to use it

- Working on multiple branches simultaneously
- Comparing two implementations side by side
- Reviewing a PR in a separate directory

## Basics

```bash
# List worktrees
wtp list

# Add a worktree for a feature branch
wtp add feature/user-auth

# Create a new branch and its worktree
wtp add -b feature/api-refactor

# Remove after merging
wtp remove feature/user-auth

# Switch to a worktree
cd "$(wtp cd feature/user-auth)"
```

## Where worktrees go

Worktrees are created under `base_dir` (default `../worktrees`), named after the branch. Move into one with `cd "$(wtp cd <branch>)"`.

Branch types: `feature`, `bugfix`, `hotfix`, `experiment`, `refactor`

## Config

Settings live in `.wtp.yml` at the repository root (`wtp init` writes a template):

```yaml
version: "1.0"
defaults:
  base_dir: ../worktrees
```

## Recipes

### Hotfix during feature work

```bash
# Working on a feature
cd ~/project-feature-auth

# Urgent bug comes in
wtp add -b hotfix/critical-bug
cd "$(wtp cd hotfix/critical-bug)"

# Fix, push, go back to feature
cd ~/project-feature-auth

# Clean up after merge
wtp remove hotfix/critical-bug
```

### Comparing approaches

```bash
# Approach A
wtp add -b experiment/approach-a
cd "$(wtp cd experiment/approach-a)"

# Approach B
wtp add -b experiment/approach-b
cd "$(wtp cd experiment/approach-b)"

# Compare and keep the better one
```

### Local PR review

```bash
wtp add -b review/pr-123 origin/pull/123
cd "$(wtp cd review/pr-123)"

# Review, then clean up
wtp remove review/pr-123
```

## Interactive mode (wt + skim)

| Command | What it does |
|---------|-------------|
| `wt` | Interactive menu (also `Alt+W`) |
| `wt list` | List worktrees |
| `wt cd` | Switch to worktree (interactive) |
| `wt add` | Create worktree |
| `wt rm` | Remove worktree (with confirmation) |

Shortcuts: `wtcd`, `wtadd`, `wtrm`, `wtls`

Keybinding: `Alt+W` opens the menu.

The preview shows recent commits and git status.
