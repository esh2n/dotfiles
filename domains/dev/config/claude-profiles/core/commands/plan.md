---
description: Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# /plan

Create a comprehensive implementation plan before writing any code, then WAIT for explicit user confirmation.

長期spec駆動は sdd skill、実行計画は claude-mem:make-plan と使い分け。

## What This Command Does

1. **Restate Requirements** - Clarify what needs to be built
2. **Identify Risks** - Surface potential issues and blockers
3. **Create Step Plan** - Break down implementation into phases
4. **Wait for Confirmation** - MUST receive user approval before proceeding

## When to Use

Use `/plan` when:
- Starting a new feature
- Making significant architectural changes
- Working on complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## Planning Process

1. **Requirements analysis** — restate the request, identify success criteria, list assumptions and constraints
2. **Architecture review** — analyze existing structure, affected components, reusable patterns
3. **Step breakdown** — specific actions with file paths, dependencies, and risk levels
4. **Implementation order** — prioritize by dependencies, group related changes, enable incremental testing

## Plan Format

```markdown
# Implementation Plan: [Feature Name]

## Overview
[2-3 sentence summary]

## Requirements
- [Requirement 1]

## Architecture Changes
- [Change: file path and description]

## Implementation Steps

### Phase 1: [Phase Name]
1. **[Step Name]** (File: path/to/file.ts)
   - Action: Specific action to take
   - Why: Reason for this step
   - Dependencies: None / Requires step X
   - Risk: Low/Medium/High

## Testing Strategy
- Unit / Integration / E2E: [what to test]

## Risks & Mitigations
- **Risk**: [Description] — Mitigation: [How to address]

## Success Criteria
- [ ] Criterion 1
```

## Planning Principles

- **Be specific**: exact file paths, function names — no steps without clear file paths
- **Phase for independent delivery**: Phase 1 = minimum viable, then core, edge cases, optimization; each phase mergeable on its own
- **Minimize changes**: prefer extending existing code; maintain project conventions
- **Every plan needs a testing strategy** — a plan without one is a red flag

## Example

```
User: /plan add real-time notifications when markets resolve

Agent:
# Implementation Plan: Market Resolution Notifications
## Phase 1: notifications table + indexes
## Phase 2: notification service with queue + retry
## Phase 3: hook into market resolution, enqueue per user
## Risks: HIGH email deliverability, MEDIUM perf at 1000+ users
**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
```

## Important Notes

**CRITICAL**: Do **NOT** write any code until the user explicitly confirms the plan with "yes" or "proceed" or similar affirmative response.

If the user wants changes, they respond with:
- "modify: [your changes]"
- "different approach: [alternative]"
- "skip phase 2 and do phase 3 first"

## Integration with Other Commands

After planning:
- Use `/build-fix` if build errors occur
- Use the tdd-workflow skill to implement with test-driven development
