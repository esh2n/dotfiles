#!/usr/bin/env bash
# PostToolUse(Write|Edit): auto-run tests when test files are modified
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0

# Only trigger for test files
case "$FILE" in
  *.test.*|*.spec.*|*_test.go|*_test.py|*Test.*)
    ;;
  *)
    exit 0
    ;;
esac

DIR="${CLAUDE_PROJECT_DIR:-.}"

# Detect test runner and run
if [ -f "$DIR/package.json" ]; then
  if [ -f "$DIR/node_modules/.bin/vitest" ]; then
    npx vitest run "$FILE" 2>&1 | tail -10
  elif [ -f "$DIR/node_modules/.bin/jest" ]; then
    npx jest --bail "$FILE" 2>&1 | tail -10
  fi
elif [ -f "$DIR/go.mod" ]; then
  PKG=$(dirname "$FILE" | sed "s|^$DIR/||")
  go test -v -run . "./$PKG" 2>&1 | tail -10
elif [ -f "$DIR/pyproject.toml" ] || [ -f "$DIR/setup.py" ]; then
  if command -v uv &>/dev/null; then
    uv run --frozen pytest "$FILE" -x 2>&1 | tail -10
  elif command -v pytest &>/dev/null; then
    pytest "$FILE" -x 2>&1 | tail -10
  fi
elif [ -f "$DIR/Cargo.toml" ]; then
  cargo test 2>&1 | tail -10
fi

exit 0
