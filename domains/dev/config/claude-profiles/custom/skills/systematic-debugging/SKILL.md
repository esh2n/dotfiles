---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes - enforces root cause investigation before attempting solutions, prevents guess-and-check thrashing
---

# Systematic Debugging

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you CANNOT propose fixes.

## Four Phases (complete each before proceeding)

### Phase 1: Root Cause Investigation

1. **Read error messages completely** — stack traces, line numbers, error codes
2. **Reproduce consistently** — exact steps, every time. If not reproducible → gather more data, don't guess
3. **Check recent changes** — git diff, new dependencies, config changes
4. **Gather evidence in multi-component systems** — log what enters/exits EACH component boundary, run once, identify WHERE it breaks
5. **Trace data flow** — where does the bad value originate? Keep tracing upstream until you find the source

### Phase 2: Pattern Analysis

1. Find working examples of similar code in the codebase
2. Compare: what's different between working and broken?
3. Read reference implementations COMPLETELY — don't skim

### Phase 3: Hypothesis and Testing

1. State clearly: "I think X is the root cause because Y"
2. Make the SMALLEST possible change to test — one variable at a time
3. Didn't work? Form NEW hypothesis. DON'T add more fixes on top

### Phase 4: Implementation

1. Create failing test case FIRST
2. Implement single fix addressing root cause
3. Verify: test passes, no other tests broken

## The 3-Strike Rule

**If 3+ fixes have failed: STOP.**

This is NOT a failed hypothesis — this is likely a wrong architecture.

Signs:
- Each fix reveals new problems in different places
- Fixes require "massive refactoring"
- Each fix creates new symptoms elsewhere

**Discuss with user before attempting more fixes.**

## Red Flags — STOP and Return to Phase 1

If you catch yourself:
- "Quick fix for now, investigate later"
- "Just try changing X and see"
- Proposing solutions before tracing data flow
- Adding multiple changes at once
- "One more fix attempt" (when already tried 2+)
- "I don't fully understand but this might work"
