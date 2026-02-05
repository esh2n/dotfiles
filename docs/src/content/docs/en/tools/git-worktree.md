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

# Specify a custom path
wtp add feature/api-refactor ../project-api-refactor

# Remove after merging
wtp remove feature/user-auth

# Switch to a worktree
wtp switch feature/user-auth

# Clean up stale entries
wtp prune
```

## Directory naming convention

```text
../project-<type>-<description>
```

Types: `feature`, `bugfix`, `hotfix`, `experiment`, `refactor`

## Config

Create `.wtp.local.yml` for personal overrides (already gitignored):

```yaml
default_path: "../worktrees"
auto_cleanup: true
```

## Recipes

### Hotfix during feature work

```bash
# Working on a feature
cd ~/project-feature-auth

# Urgent bug comes in
wtp add hotfix/critical-bug
cd ../project-hotfix-critical-bug

# Fix, push, go back to feature
cd ~/project-feature-auth

# Clean up after merge
wtp remove hotfix/critical-bug
```

### Comparing approaches

```bash
# Approach A
wtp add experiment/approach-a
cd ../project-experiment-approach-a

# Approach B
wtp add experiment/approach-b
cd ../project-experiment-approach-b

# Compare and keep the better one
```

### Local PR review

```bash
wtp add review/pr-123 origin/pull/123
cd ../project-review-pr-123

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
