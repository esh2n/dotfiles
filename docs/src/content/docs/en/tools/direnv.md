---
title: direnv
description: Automatic per-directory environment variables.
---

direnv loads and unloads environment variables automatically when you enter and leave directories. Each project gets its own isolated environment.

## Basics

Create `.envrc` in your project root:

```bash
# Set env vars
export DATABASE_URL="postgresql://localhost/mydb"
export API_KEY="development-key"

# Load .env if it exists
dotenv_if_exists .env

# Add project bin to PATH
PATH_add ./bin

# Use language versions from mise
use mise
```

You need to approve it the first time (and after any change):

```bash
direnv allow
```

## mise integration

Combine with mise for automatic language runtime switching:

```bash
# .envrc
use mise
```

Specify versions in `.mise.toml`:

```toml
[tools]
node = "20.10.0"
python = "3.12"
go = "1.21"
```

Just `cd` into the directory and the right versions activate.

## Common patterns

### Database credentials

```bash
# .envrc
export DATABASE_URL="postgresql://localhost/dev_db"
export REDIS_URL="redis://localhost:6379"
```

### AWS profile

```bash
# .envrc
export AWS_PROFILE="development"
export AWS_REGION="us-west-2"
```

### Project PATH

```bash
# .envrc
PATH_add ./scripts
PATH_add ./node_modules/.bin
```

### Secrets

```bash
# .envrc (committed)
dotenv_if_exists .env.local

# .env.local (never committed)
OPENAI_API_KEY="sk-..."
STRIPE_SECRET_KEY="sk_test_..."
```

## Security

- Always gitignore `.envrc.local` for machine-specific secrets
- Never put real secrets in `.envrc` — use placeholders
- `direnv allow` is an explicit trust mechanism
- Review `.envrc` changes carefully in PRs

## direnv + wtp workflow

Give each worktree its own isolated environment:

```bash
# Create a feature worktree
wtp add feature/new-api
cd ../project-feature-new-api

# Set up environment for this worktree
cat > .envrc << EOF
export FEATURE_FLAG_NEW_API=true
export API_VERSION=v2
use mise
EOF

direnv allow

# Main worktree stays unaffected
```
