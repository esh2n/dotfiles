---
title: Jujutsu (jj)
description: Aliases and workspace management for the next-gen VCS.
---

A next-generation VCS that coexists with git. The `j` prefix mirrors git's `g` prefix.

## git to jj mapping

| Concept | git | jj |
|---------|-----|-----|
| Branch | `git branch` | `jj bookmark` |
| Checkout | `git switch` | `jj edit` / `jj new` |
| Staging | `git add` | Not needed (working copy = stage) |
| Stash | `git stash` | Not needed (just `jj new`) |
| Amend | `git commit --amend` | `jj describe` / `jj squash` |
| Revert | `git revert` | `jj backout` |
| Reflog | `git reflog` | `jj operation log` |
| Worktree | `git worktree` | `jj workspace` |
| Blame | `git blame` | `jj file annotate` |
| Remote | `git push/fetch` | `jj git push/fetch` |

## Basics

| Alias | Command | Note |
|-------|---------|------|
| `j` | `jj` | Base command |
| `jl` | `jj log` | Log |
| `jll` | `jj log --template builtin_log_oneline` | One-line log |
| `jla` | `jj log -r "all()"` | All revisions |
| `js` | `jj status` | Status |
| `jd` | `jj diff` | Working copy diff |
| `jds` | `jj diff --stat` | Diff stat |
| `jD` | `jj diff -r @-` | Parent diff |

## Commit / Edit

| Alias | Command | Note |
|-------|---------|------|
| `jc` | `jj commit` | Finalize current change |
| `jci` | `jj commit --interactive` | Interactive commit |
| `jn` | `jj new` | Create new empty change |
| `je` | `jj edit` | Edit existing change |
| `jde` | `jj describe` | Edit description |

## History rewriting

| Alias | Command | Note |
|-------|---------|------|
| `ja` | `jj abandon` | Abandon change |
| `ju` | `jj undo` | Undo last operation |
| `jsq` | `jj squash` | Squash into parent |
| `jsi` | `jj squash --interactive` | Interactive squash |
| `jsp` | `jj split` | Split change |
| `jr` | `jj rebase` | Rebase |

## Restore / Show

| Alias | Command |
|-------|---------|
| `jrt` | `jj restore` |
| `jsh` | `jj show` |

## Bookmarks (git branch equivalent)

| Alias | Command | Note |
|-------|---------|------|
| `jb` | `jj bookmark list` | List |
| `jbc` | `jj bookmark create` | Create |
| `jbd` | `jj bookmark delete` | Delete |
| `jbm` | `jj bookmark move` | Move |
| `jbrn` | `jj bookmark rename` | Rename |

## Git operations

| Alias | Command | Note |
|-------|---------|------|
| `jf` | `jj git fetch` | Fetch |
| `jp` | `jj git push` | Push |
| `jfr` | `jj git fetch && jj rebase -d "trunk()"` | Fetch and rebase |

## File / Operation

| Alias | Command | Note |
|-------|---------|------|
| `jbl` | `jj file annotate` | Like `git blame` |
| `jfl` | `jj file list` | Like `git ls-files` |
| `jop` | `jj operation log` | Like `git reflog` |
| `lj` | `lazyjj` | TUI |

## Interactive (skim-based)

| Command | What it does |
|---------|-------------|
| `jsw [change]` | Pick change and edit |
| `jpso [bookmark]` | Pick bookmark and push |
| `jPso [bookmark]` | Pick bookmark and force push |
| `jifit` | Pick 2 changes and view diff |
| `jdif [N]` | Diff from N ancestors back |
| `jswc [name]` | Create bookmark at @ |
| `jrn [old] [new]` | Rename bookmark |
| `jnew [change]` | New change from selected |
| `jedit [change]` | Edit selected change |
| `jrb` | Interactive rebase |
| `jsquash [target]` | Squash into selected target |
| `jbd_sk` | Delete bookmark (fuzzy pick) |
| `jbm_sk` | Move bookmark to @ (fuzzy pick) |

## Workspace management (jwt)

| Command | What it does |
|---------|-------------|
| `jwt` | Interactive menu |
| `jwt list` | List workspaces |
| `jwt cd [name]` | Switch to workspace (interactive if no args) |
| `jwt add` | Create workspace |
| `jwt rm` | Remove workspace |

Shortcuts: `jwtcd`, `jwtadd`, `jwtrm`, `jwtls`
