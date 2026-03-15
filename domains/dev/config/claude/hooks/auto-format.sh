#!/usr/bin/env bash
# PostToolUse(Write|Edit): auto-format edited files based on project type
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

EXT="${FILE##*.}"

case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|yaml|yml)
    if command -v npx &>/dev/null && [ -f "node_modules/.bin/prettier" ]; then
      npx prettier --write "$FILE" 2>/dev/null
    elif command -v npx &>/dev/null && [ -f "node_modules/.bin/biome" ]; then
      npx biome format --write "$FILE" 2>/dev/null
    fi
    ;;
  py)
    if command -v uv &>/dev/null; then
      uv run --frozen ruff format "$FILE" 2>/dev/null
    elif command -v ruff &>/dev/null; then
      ruff format "$FILE" 2>/dev/null
    fi
    ;;
  go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE" 2>/dev/null
    fi
    ;;
  rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt "$FILE" 2>/dev/null
    fi
    ;;
  nix)
    if command -v nixfmt &>/dev/null; then
      nixfmt "$FILE" 2>/dev/null
    elif command -v alejandra &>/dev/null; then
      alejandra -q "$FILE" 2>/dev/null
    fi
    ;;
esac

exit 0
