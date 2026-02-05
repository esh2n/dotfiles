---
title: Git Config
description: Conventional Commits template と global gitignore。
---

Git の global 設定。commit message template と gitignore を共通化している。

## Commit message template

Conventional Commits 形式の template を `~/.config/git/message` に定義。`git commit` 時にテンプレートが表示される。

```text
<type>[(scope)]: <description>
```

### Type 一覧

| Type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | bug fix |
| `docs` | document のみの変更 |
| `style` | formatting, semicolon など |
| `refactor` | 機能変更を伴わないコード修正 |
| `perf` | performance 改善 |
| `test` | test の追加・修正 |
| `chore` | build, CI, 依存関係の更新 |

### Breaking Change

type の後に `!` を付けて breaking change を示す。

```text
feat(auth)!: implement OAuth2 authentication
```

footer に `BREAKING CHANGE:` を記述して詳細を説明。

## Global gitignore

`~/.config/git/ignore` で全 repository 共通の ignore pattern を定義。

### OS generated

```gitignore
.DS_Store
Thumbs.db
._*
```

### Version managers

```gitignore
.go-version
.node-version
.python-version
.ruby-version
.tool-versions
.mise.toml
```

### IDE

```gitignore
.idea/
.vscode/
*.swp
*.swo
```

### Environment / Secrets

```gitignore
.env
.env.local
.envrc
```

### Local config

```gitignore
makefile.local
docker-compose.local.yml
config.local.*
*.local.json
*.local.yaml
```

### Dependencies

```gitignore
node_modules/
vendor/
.bundle/
```

### Claude Code

```gitignore
**/.claude/settings.local.json
**/.claude/telemetry/
```

## 設定ファイル

| File | 内容 |
|------|------|
| `~/.config/git/config.local` | user.name, user.email |
| `~/.config/git/message` | commit template |
| `~/.config/git/ignore` | global gitignore |
