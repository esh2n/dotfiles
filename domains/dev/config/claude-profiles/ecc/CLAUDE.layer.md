# ECC Profile Rules

## Everything Claude Code (ECC)

This profile uses the ECC agent harness system. ECC repo location is configured via `$ECC_ROOT` env var (set by claude-switch).

## Hook Profiles

ECC hooks run through the `run-with-flags.js` runner with profile levels:
- `minimal` — always runs
- `standard` — default level (set via ECC_HOOK_PROFILE)
- `strict` — maximum enforcement

## Continuous Learning

The continuous-learning-v2 system captures instincts from sessions:
- `/instinct-status` — view learned instincts
- `/evolve` — analyze and promote instincts
- `/learn` — extract patterns from current session

## Language Overrides

- Python: ONLY use `uv`, NEVER `pip`. Use `anyio` for async testing, not `asyncio`
- TypeScript: prefer `pnpm` > `npm` > `yarn`. `strict: true` always. No `any` in production
- Go: NEVER ignore error returns
- Bash: always `set -euo pipefail`

## Quality Rules

- Write tests for new features and bug fixes
- Use feature branches for all development
- Follow semantic versioning for releases
- Document breaking changes
