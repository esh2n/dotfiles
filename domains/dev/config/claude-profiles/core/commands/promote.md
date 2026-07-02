---
name: promote
description: Promote project-scoped instincts to global scope
command: true
---

# Promote Command

Promote instincts from project scope to global scope in continuous-learning-v2.

## When to Use

- 複数プロジェクトで同じinstinctが観測されたとき(まず `--dry-run` で候補確認)
- プロジェクト固有の学びをグローバルに昇格して他リポジトリでも使いたいとき

## What Happens

昇格したinstinctは `~/.claude/homunculus/projects/<id>/` からグローバル
(`~/.claude/homunculus/instincts/`)へ移動し、以後すべてのプロジェクトの
observe/評価対象になる。実行後は `/instinct-status` で結果を確認する。

## Implementation

Run the instinct CLI using the plugin root path:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" promote [instinct-id] [--force] [--dry-run]
```

Or if `CLAUDE_PLUGIN_ROOT` is not set (manual installation):

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py promote [instinct-id] [--force] [--dry-run]
```

## Usage

```bash
/promote                      # Auto-detect promotion candidates
/promote --dry-run            # Preview auto-promotion candidates
/promote --force              # Promote all qualified candidates without prompt
/promote grep-before-edit     # Promote one specific instinct from current project
```

## What to Do

1. Detect current project
2. If `instinct-id` is provided, promote only that instinct (if present in current project)
3. Otherwise, find cross-project candidates that:
   - Appear in at least 2 projects
   - Meet confidence threshold
4. Write promoted instincts to `~/.claude/homunculus/instincts/personal/` with `scope: global`
