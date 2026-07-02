---
description: "Extract reusable patterns from the session, self-evaluate quality before saving, and determine the right save location (Global vs Project)."
---

# /learn - Extract, Evaluate, then Save

Analyze the current session, extract patterns worth saving as skills, run them through a quality gate, and save to the right location (Global vs Project).

Relationship: `/learn` = manual extraction from the current session; the observe hook + `/evolve` handle automatic instinct capture/promotion.

## When to Use

- You've just solved a non-trivial problem worth remembering (run at any point during a session)
- A debugging technique, workaround, or convention emerged that future sessions should reuse
- You want the extraction quality-checked and routed to the right scope before anything is written

## What to Extract

1. **Error Resolution Patterns** — what error occurred, root cause, what fixed it, is it reusable for similar errors
2. **Debugging Techniques** — non-obvious steps, tool combinations that worked, diagnostic patterns
3. **Workarounds** — library quirks, API limitations, version-specific fixes
4. **Project-Specific Patterns** — codebase conventions discovered, architecture decisions made, integration patterns

## Process

1. Review the session for extractable patterns
2. Identify the most valuable/reusable insight

3. **Determine save location:**
   - Ask: "Would this pattern be useful in a different project?"
   - **Global** (`~/.claude/skills/learned/`): Generic patterns usable across 2+ projects (bash compatibility, LLM API behavior, debugging techniques, etc.)
   - **Project** (`.claude/skills/learned/` in current project): Project-specific knowledge (quirks of a particular config file, project-specific architecture decisions, etc.)
   - When in doubt, choose Global (moving Global → Project is easier than the reverse)

4. Draft the skill file using this format:

```markdown
---
name: pattern-name
description: "Under 130 characters"
user-invocable: false
origin: auto-extracted
---

# [Descriptive Pattern Name]

**Extracted:** [Date]
**Context:** [Brief description of when this applies]

## Problem
[What problem this solves - be specific]

## Solution
[The pattern/technique/workaround - with code examples if applicable]

## When to Use
[Trigger conditions - what should activate this skill]
```

5. **Quality gate — Checklist + Holistic verdict**

   ### 5a. Required checklist (verify by actually reading files)

   Execute **all** of the following before evaluating the draft:

   - [ ] Grep `~/.claude/skills/` and relevant project `.claude/skills/` files by keyword to check for content overlap
   - [ ] Check MEMORY.md (both project and global) for overlap
   - [ ] Consider whether appending to an existing skill would suffice
   - [ ] Confirm this is a reusable pattern, not a one-off fix

   ### 5b. Holistic verdict

   Synthesize the checklist results and draft quality, then choose **one** of the following:

   | Verdict | Meaning | Next Action |
   |---------|---------|-------------|
   | **Save** | Unique, specific, well-scoped | Proceed to Step 6 |
   | **Improve then Save** | Valuable but needs refinement | List improvements → revise → re-evaluate (once) |
   | **Absorb into [X]** | Should be appended to an existing skill | Show target skill and additions → Step 6 |
   | **Drop** | Trivial, redundant, or too abstract | Explain reasoning and stop |

   **Guideline dimensions** (informing the verdict, not scored):

   - **Specificity & Actionability**: Contains code examples or commands that are immediately usable
   - **Scope Fit**: Name, trigger conditions, and content are aligned and focused on a single pattern
   - **Uniqueness**: Provides value not covered by existing skills (informed by checklist results)
   - **Reusability**: Realistic trigger scenarios exist in future sessions

6. **Verdict-specific confirmation flow**

   - **Improve then Save**: Present the required improvements + revised draft + updated checklist/verdict after one re-evaluation; if the revised verdict is **Save**, save after user confirmation, otherwise follow the new verdict
   - **Save**: Present save path + checklist results + 1-line verdict rationale + full draft → save after user confirmation
   - **Absorb into [X]**: Present target path + additions (diff format) + checklist results + verdict rationale → append after user confirmation
   - **Drop**: Show checklist results + reasoning only (no confirmation needed)

7. Save / Absorb to the determined location

## Output Format for Step 5

```
### Checklist
- [x] skills/ grep: no overlap (or: overlap found → details)
- [x] MEMORY.md: no overlap (or: overlap found → details)
- [x] Existing skill append: new file appropriate (or: should append to [X])
- [x] Reusability: confirmed (or: one-off → Drop)

### Verdict: Save / Improve then Save / Absorb into [X] / Drop

**Rationale:** (1-2 sentences explaining the verdict)
```

## Design Rationale

This version replaces the previous 5-dimension numeric scoring rubric (Specificity, Actionability, Scope Fit, Non-redundancy, Coverage scored 1-5) with a checklist-based holistic verdict system. Modern frontier models (Opus 4.6+) have strong contextual judgment — forcing rich qualitative signals into numeric scores loses nuance and can produce misleading totals. The holistic approach lets the model weigh all factors naturally, producing more accurate save/drop decisions while the explicit checklist ensures no critical check is skipped.

## Notes

- Don't extract trivial fixes (typos, simple syntax errors)
- Don't extract one-time issues (specific API outages, etc.)
- Focus on patterns that will save time in future sessions
- Keep skills focused — one pattern per skill
- When the verdict is Absorb, append to the existing skill rather than creating a new file
