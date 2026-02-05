---
title: Git Config
description: Conventional Commits template and global gitignore.
---

Global git configuration. Shared commit message template and gitignore across all repositories.

## Commit message template

Conventional Commits template defined in `~/.config/git/message`. Displayed when running `git commit`.

```text
<type>[(scope)]: <description>
```

### Types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, semicolons, etc. |
| `refactor` | Code change without feature change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Build, CI, dependency updates |

### Breaking changes

Append `!` after the type to indicate a breaking change.

```text
feat(auth)!: implement OAuth2 authentication
```

Add `BREAKING CHANGE:` in the footer for details.

## Global gitignore

`~/.config/git/ignore` defines ignore patterns shared across all repositories.

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

## Config files

| File | Contents |
|------|----------|
| `~/.config/git/config.local` | user.name, user.email |
| `~/.config/git/message` | Commit template |
| `~/.config/git/ignore` | Global gitignore |
