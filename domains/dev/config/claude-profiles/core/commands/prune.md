---
name: prune
description: Delete pending instincts older than 30 days that were never promoted
command: true
---

# Prune Pending Instincts

Remove expired pending instincts that were auto-generated but never reviewed or promoted.

## When to Use

- instinctが溜まりすぎて /instinct-status がノイジーになったとき(月1目安)

## What Happens

30日以上昇格されなかったpending instinctが削除される。確定前に必ず --dry-run で対象を確認する。

## Implementation

Run the instinct CLI using the plugin root path:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" prune
```

Or if `CLAUDE_PLUGIN_ROOT` is not set (manual installation):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py prune
```

## Usage

```
/prune                    # Delete instincts older than 30 days
/prune --max-age 60      # Custom age threshold (days)
/prune --dry-run         # Preview without deleting
```
