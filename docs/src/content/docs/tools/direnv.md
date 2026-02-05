---
title: direnv
description: Directory ごとに環境変数を自動で load/unload する。
---

direnv は directory に入ると環境変数を自動で load し、離れると unload する。project ごとに独立した環境を持てる。

## 基本

project root に `.envrc` を作成:

```bash
# 環境変数を設定
export DATABASE_URL="postgresql://localhost/mydb"
export API_KEY="development-key"

# .env があれば load
dotenv_if_exists .env

# project の bin を PATH に追加
PATH_add ./bin

# mise の言語 version を使う
use mise
```

初回 (と変更後) は approve が必要:

```bash
direnv allow
```

## mise integration

mise と組み合わせて言語 runtime を自動で切り替える:

```bash
# .envrc
use mise
```

version は `.mise.toml` で指定:

```toml
[tools]
node = "20.10.0"
python = "3.12"
go = "1.21"
```

`cd` するだけで正しい version が activate される。

## よくある pattern

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

- `.envrc.local` は machine 固有の secret 用。必ず gitignore する
- `.envrc` に本物の secret を置かない。placeholder を使う
- `direnv allow` は明示的な trust mechanism
- PR で `.envrc` の変更は慎重に review する

## direnv + wtp workflow

worktree ごとに独立した環境を持たせる:

```bash
# feature worktree を作成
wtp add feature/new-api
cd ../project-feature-new-api

# この worktree 用の環境を setup
cat > .envrc << EOF
export FEATURE_FLAG_NEW_API=true
export API_VERSION=v2
use mise
EOF

direnv allow

# main worktree は影響を受けない
```
