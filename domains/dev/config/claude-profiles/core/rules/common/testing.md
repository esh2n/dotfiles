---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,go,py,rs,java,kt,kts,swift,rb,php,c,h,cc,cpp,hpp,cs,sh,bash,zsh,fish,lua,zig,scala}"
---
# Testing Requirements

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** - Individual functions, utilities, components
2. **Integration Tests** - API endpoints, database operations
3. **E2E Tests** - Critical user flows (framework chosen per language)

## Test-Driven Development

MANDATORY: write tests first (RED), implement to pass (GREEN), refactor (IMPROVE),
verify 80%+ coverage. Full workflow, plan handoff, and checkpoints: see the
**tdd-workflow** skill (single source of truth for the TDD process).

## Troubleshooting Test Failures

1. Follow the **tdd-workflow** skill
2. Check test isolation
3. Verify mocks are correct
4. Fix implementation, not tests (unless tests are wrong)
