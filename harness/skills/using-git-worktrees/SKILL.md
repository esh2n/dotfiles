---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates the one worktree layout every harness shares (.claude/worktrees/<name>, branch <name>) and leaves the merge to the owner
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Every harness isolates the same way: a git worktree at `.claude/worktrees/<name>` on a branch named `<name>`, made with plain git.

**Core principle:** Detect existing isolation first. Then create the one layout with plain git. The owner merges.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Step 0: Detect Existing Isolation

**Before creating anything, check if you are already in an isolated workspace.**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Submodule guard:** `GIT_DIR != GIT_COMMON` is also true inside git submodules. Before concluding "already in a worktree," verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule, not a worktree — treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**If `GIT_DIR != GIT_COMMON` (and not a submodule):** You are already in a linked worktree. Skip to Step 2 (Project Setup). Do NOT create another worktree.

Report with branch state:
- On a branch: "Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD: "Already in isolated workspace at `<path>` (detached HEAD, externally managed). Branch creation needed at finish time."

**If `GIT_DIR == GIT_COMMON` (or in a submodule):** You are in a normal repo checkout.

Has the user already indicated their worktree preference in your instructions? If not, ask for consent before creating a worktree:

> "Would you like me to set up an isolated worktree? It protects your current branch from changes."

Honor any existing declared preference without asking. If the user declines consent, work in place and skip to Step 2.

## Step 1: Create Isolated Workspace

**One way, in every harness.** Claude Code, Codex, pi, omp and the Swarm all isolate the same way, so the owner never has to remember which harness does what: a git worktree at `.claude/worktrees/<name>` on a branch named `<name>`, made with plain git. Do not use a harness's own isolation (Codex's detached-HEAD worktrees, omp's `isolated` copies, a native `EnterWorktree` that names things differently) — the owner's ruling of 2026-09-27 trades that convenience for one layout everywhere.

```bash
root=$(git rev-parse --show-toplevel)
name=<short-kebab-name>          # also the branch name
# keep .claude/worktrees/ out of git status without touching the committed .gitignore
git -C "$root" check-ignore -q .claude/worktrees/probe \
  || echo '.claude/worktrees/' >> "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
git -C "$root" worktree add -b "$name" "$root/.claude/worktrees/$name" HEAD
cd "$root/.claude/worktrees/$name"
```

A branch or directory with that name already existing is a stop, never a reuse: it may hold someone's work. Pick another name.

**Files git ignores but the work needs** (`.env` and the like) are copied only when the project lists them in `.worktreeinclude` (gitignore syntax, the file Claude Code and Codex read for the same purpose):

```bash
[ -f "$root/.worktreeinclude" ] && git -C "$root" ls-files --others --ignored --exclude-from=.worktreeinclude \
  | while read -r f; do mkdir -p "$(dirname "$f")"; cp "$root/$f" "$f"; done
```

**Sandbox fallback:** If `git worktree add` fails with a permission error (sandbox denial), tell the user the sandbox blocked worktree creation and you're working in the current directory instead. Then run setup and baseline tests in place.

## Step 2: Project Setup

Auto-detect and run appropriate setup:

```bash
# Node.js — the lockfile names the package manager; never guess
if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile
elif [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile
elif [ -f package-lock.json ]; then npm ci
elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python — uv only, never pip or poetry
if [ -f pyproject.toml ] || [ -f uv.lock ]; then uv sync; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

Install runs third-party build scripts. Run it only inside the harness's sandbox or after the worktree consent above; if the project has no lockfile, stop and ask instead of resolving dependencies fresh.

## Step 3: Verify Clean Baseline

Run tests to ensure workspace starts clean:

```bash
# Use project-appropriate command
npm test / cargo test / pytest / go test ./...
```

**If tests fail:** Report failures, ask whether to proceed or investigate.

**If tests pass:** Report ready.

### Report

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Step 4: Finish — the owner decides the merge

Commit the work on the worktree's branch. Merging it back is the owner's decision, never automatic (Claude Code's background sessions, Codex and named practitioners all leave the merge to a person; a merge that git calls clean can still be wrong in meaning). When the owner says to merge, from the main checkout:

```bash
git merge --no-ff <name>               # the branch stays visible as one unit in history
git worktree remove .claude/worktrees/<name>
git branch -d <name>                   # -d, not -D: refuses if anything is unmerged
```

A worktree with uncommitted changes, or a branch that is not merged, is left in place and reported — never force-removed.

## Quick Reference

| Situation | Action |
|-----------|--------|
| Already in linked worktree | Skip creation (Step 0) |
| In a submodule | Treat as normal repo (Step 0 guard) |
| Any harness | `.claude/worktrees/<name>`, branch `<name>`, plain git (Step 1) |
| Name already taken | Pick another name; never reuse |
| Directory not ignored | Add `.claude/worktrees/` to the repo's `info/exclude`, not `.gitignore` |
| Ignored files needed (`.env`) | Only those listed in `.worktreeinclude` |
| Work done | Commit on the branch; merge only when the owner says (Step 4) |
| Permission error on create | Sandbox fallback, work in place |
| Tests fail during baseline | Report failures + ask |
| No package.json/Cargo.toml | Skip dependency install |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'm obviously not in a worktree — no need to check" | Run Step 0. Harness-created isolation and submodules both fool eyeballing; the detection commands settle it. |
| "This harness has its own isolation, it's easier" | Every harness uses the same `.claude/worktrees/<name>` + branch `<name>`, so the owner sees one layout. A harness-specific form is exactly what the owner ruled out. |
| "The branch is done, I'll merge it" | Merging is the owner's call. Commit, report the branch, and wait. |
| "The worktree directory is surely ignored already" | Run `git check-ignore`. An unignored worktree directory commits the whole tree into the repo. |
| "`.worktrees/` is the usual place" | Here it is `.claude/worktrees/<name>`, in every harness. |
| "The workspace is fresh — baseline tests can wait" | A dirty baseline makes every later failure ambiguous. Run the tests now; proceeding past failures is your human partner's call. |
