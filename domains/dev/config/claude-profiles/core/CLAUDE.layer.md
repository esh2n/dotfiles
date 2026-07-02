# Core Rules (ECC-derived)

## Harness

The agent harness (hooks runtime, continuous learning) is vendored from
Everything Claude Code into this dotfiles repo (`claude-profiles/runtime/ecc`,
pinned in `ECC_VERSION`). `$ECC_ROOT` points there. Language/domain content is
toggled per machine via `claude-switch pack enable|disable <pack>`.

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
