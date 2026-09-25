## Language Overrides

- Python: only use `uv`, never `pip`. Use `anyio` for async testing, not `asyncio`
- TypeScript: prefer `pnpm` > `npm` > `yarn`. `strict: true` always. No `any` in production
- Go: never ignore error returns
- Bash: always `set -euo pipefail`
