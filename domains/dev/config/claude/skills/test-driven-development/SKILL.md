---
name: test-driven-development
description: Use when implementing any feature or bugfix - enforces writing tests before implementation code. Prevents test-after-the-fact bias where tests only verify what was built, not what should be built
---

# Test-Driven Development

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before the test? **Delete it. Start over.** No keeping it as "reference." No "adapting" it.

## Red-Green-Refactor

### RED — Write one failing test

- One behavior per test
- Clear name describing the behavior
- Real code, no mocks unless unavoidable

```bash
# Run and confirm it FAILS (not errors, fails)
npm test path/to/test.test.ts
```

Test passes immediately? You're testing existing behavior. Fix the test.

### GREEN — Write minimal code to pass

- Simplest code that makes the test pass
- No extra features, no "while I'm here" improvements
- No options/config for hypothetical future needs

### REFACTOR — Clean up (tests stay green)

- Remove duplication, improve names, extract helpers
- Keep tests green. Don't add behavior.

### Repeat — Next failing test for next behavior

## Why Order Matters

Tests written after implementation:
- Pass immediately → proves nothing
- Test what you built, not what's required
- Miss edge cases you forgot (because you verify remembered cases, not discovered ones)
- Create **confirmation bias** — you unconsciously write tests that match your implementation

Tests written before implementation:
- Must fail first → proves the test catches the bug
- Force edge case discovery before coding
- Define the contract independent of implementation

## Red Flags — STOP and Delete Code

- Code exists before test
- Test passes immediately (never saw it fail)
- Rationalizing "just this once"
- "I already manually tested it"
- "Keep as reference, then write tests" (you'll adapt it — that's test-after)
- "Deleting X hours of work is wasteful" (sunk cost fallacy)

**All of these mean: Delete code. Write test first. Implement fresh.**

## Example: Bug Fix

```
BUG: Empty email accepted

RED:   test('rejects empty email') → expect(result.error).toBe('Email required')
RUN:   FAIL — got undefined ✓ (correct failure)
GREEN: if (!data.email?.trim()) return { error: 'Email required' }
RUN:   PASS ✓
```

## When Stuck

| Problem | Signal |
|---------|--------|
| Don't know how to test | Write the API you wish existed first |
| Test too complicated | Design too complicated — simplify the interface |
| Must mock everything | Code too coupled — use dependency injection |
| Test setup is huge | Extract helpers. Still complex? Simplify design |
