---
title: Jujutsu (jj)
description: 次世代 VCS Jujutsu の alias, revset-aliases, workspace 管理。
---

Git と共存する次世代 VCS。Git の `g` prefix に対応させて `j` prefix で alias を揃えている。

## git → jj 対応表

| 概念 | git | jj |
|-----|-----|-----|
| branch | `git branch` | `jj bookmark` |
| checkout | `git switch` | `jj edit` / `jj new` |
| staging | `git add` | 不要 (working copy = stage) |
| stash | `git stash` | 不要 (`jj new` するだけ) |
| amend | `git commit --amend` | `jj describe` / `jj squash` |
| revert | `git revert` | `jj backout` |
| reflog | `git reflog` | `jj operation log` |
| worktree | `git worktree` | `jj workspace` |
| blame | `git blame` | `jj file annotate` |
| remote | `git push/fetch` | `jj git push/fetch` |

## 設定 (config.toml)

| 項目 | 値 |
|------|------|
| Default command | `log` |
| Pager | `less -FRX` |
| Diff editor | `:builtin` |
| Merge editor | `:builtin` |
| Auto local bookmark | `false` |

## 基本操作

| Alias | Command | 説明 |
|-------|---------|------|
| `j` | `jj` | base command |
| `jl` | `jj log` | log |
| `jll` | `jj log --template builtin_log_oneline` | 1 行 log |
| `jla` | `jj log -r "all()"` | 全 revision |
| `js` | `jj status` | status |
| `jd` | `jj diff` | working copy の diff |
| `jds` | `jj diff --stat` | diff の stat |
| `jD` | `jj diff -r @-` | 親の diff |

## Commit / 編集

| Alias | Command | 説明 |
|-------|---------|------|
| `jc` | `jj commit` | 現在の変更を確定 |
| `jci` | `jj commit --interactive` | interactive commit |
| `jn` | `jj new` | 新しい空の変更を作成 |
| `je` | `jj edit` | 既存の変更を edit |
| `jde` | `jj describe` | description を編集 |

## 履歴の変更

| Alias | Command | 説明 |
|-------|---------|------|
| `ja` | `jj abandon` | 変更を破棄 |
| `ju` | `jj undo` | 直前の操作を取り消し |
| `jsq` | `jj squash` | 親に squash |
| `jsi` | `jj squash --interactive` | interactive squash |
| `jsp` | `jj split` | 変更を分割 |
| `jr` | `jj rebase` | rebase |

## 復元 / 表示

| Alias | Command |
|-------|---------|
| `jrt` | `jj restore` |
| `jsh` | `jj show` |

## Bookmark (git branch 相当)

| Alias | Command | 説明 |
|-------|---------|------|
| `jb` | `jj bookmark list` | 一覧 |
| `jbc` | `jj bookmark create` | 作成 |
| `jbd` | `jj bookmark delete` | 削除 |
| `jbm` | `jj bookmark move` | 移動 |
| `jbrn` | `jj bookmark rename` | rename |

## Git 操作

| Alias | Command | 説明 |
|-------|---------|------|
| `jf` | `jj git fetch` | fetch |
| `jp` | `jj git push` | push |
| `jfr` | `jj git fetch && jj rebase -d "trunk()"` | fetch して rebase |

## File / Operation

| Alias | Command | 説明 |
|-------|---------|------|
| `jbl` | `jj file annotate` | blame 相当 |
| `jfl` | `jj file list` | file 一覧 |
| `jop` | `jj operation log` | reflog 相当 |
| `lj` | `lazyjj` | TUI |

## Revset aliases

`config.toml` に定義した revset aliases。`jj log -r "wip"` のように使う。

| Alias | 定義 | 説明 |
|-------|------|------|
| `wip` | `description(regex:"^\\[(wip\|WIP\|todo\|TODO)\\]")` | `[wip]` や `[TODO]` で始まる変更 |
| `recent` | `committer_date(after:"1 month ago")` | 直近 1 ヶ月の変更 |
| `today` | `committer_date(after:"today 00:00")` | 今日の変更 |
| `unpushed` | `mine() & mutable()` | 自分の未 push の変更 |
| `ready` | `mutable() & ~wip & ~empty()` | push 可能な変更 (WIP でなく空でもない) |
| `immutable_heads()` | `trunk() \| tags()` | immutable な先頭 |

```bash
# WIP な変更だけ表示
jj log -r "wip"

# 今日の作業を確認
jj log -r "today"

# push 準備できた変更
jj log -r "ready"

# 未 push の自分の変更
jj log -r "unpushed"
```

## Interactive 操作 (skim ベース)

| Command | 説明 |
|---------|------|
| `jsw [change]` | 変更を選択して edit |
| `jpso [bookmark]` | bookmark を選択して push |
| `jPso [bookmark]` | bookmark を選択して force push |
| `jifit` | 2 つの変更を選択して diff 表示 |
| `jdif [N]` | N 世代前からの diff |
| `jswc [name]` | bookmark を @ に作成 |
| `jrn [old] [new]` | bookmark を rename |
| `jnew [change]` | 選択した変更から新規作成 |
| `jedit [change]` | 選択した変更を edit |
| `jrb` | interactive rebase |
| `jsquash [target]` | 選択した target に squash |
| `jbd_sk` | bookmark を選択して削除 |
| `jbm_sk` | bookmark を @ に移動 |

## Workspace 管理 (jwt)

| Command | 説明 |
|---------|------|
| `jwt` | interactive menu |
| `jwt list` | workspace 一覧 |
| `jwt cd [name]` | workspace に移動 (引数なしで interactive 選択) |
| `jwt add` | workspace を作成 |
| `jwt rm` | workspace を削除 |

短縮形: `jwtcd`, `jwtadd`, `jwtrm`, `jwtls`
