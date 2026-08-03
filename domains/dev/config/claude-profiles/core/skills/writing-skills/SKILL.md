---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex).

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

**REQUIRED BACKGROUND:** You MUST understand the tdd-workflow skill before using this skill. That skill defines the fundamental RED-GREEN-REFACTOR cycle. This skill adapts TDD to documentation.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools that future Claude instances can find and apply.

**Skills are:** Reusable techniques, patterns, tools, reference guides
**Skills are NOT:** Narratives about how you solved a problem once

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |
| **Write test first** | Run baseline scenario BEFORE writing skill |
| **Watch it fail** | Document exact rationalizations agent uses |
| **Minimal code** | Write skill addressing those specific violations |
| **Watch it pass** | Verify agent now complies |
| **Refactor cycle** | Find new rationalizations → plug → re-verify |

The entire skill creation process follows RED-GREEN-REFACTOR.

## When to Create a Skill

**Create when:**
- Technique wasn't intuitively obvious to you
- You'd reference this again across projects
- Pattern applies broadly (not project-specific)
- Others would benefit

**Don't create for:**
- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put in CLAUDE.md)
- Mechanical constraints (if it's enforceable with regex/validation, automate it — save documentation for judgment calls)

## Skill Types

- **Technique** — concrete method with steps to follow (condition-based-waiting, root-cause-tracing)
- **Pattern** — way of thinking about problems (flatten-with-flags, test-invariants)
- **Reference** — API docs, syntax guides, tool documentation (office docs)

## File Organization

**Flat namespace** — all skills in one searchable namespace.

```
skills/
  skill-name/
    SKILL.md              # Main reference (required)
    supporting-file.*     # Only if needed
```

Keep principles, concepts, and code patterns (< 50 lines) inline. Split into separate files only for:

| Case | Example |
|------|---------|
| Self-contained | `defense-in-depth/SKILL.md` — everything inline, no heavy reference needed |
| Reusable tool | `condition-based-waiting/SKILL.md` + `example.ts` — working helper to adapt, not just narrative |
| Heavy reference (100+ lines) | `pptx/SKILL.md` + `pptxgenjs.md` + `ooxml.md` + `scripts/` — reference material too large for inline |

## SKILL.md Structure

**Frontmatter (YAML):**
- Only two fields supported: `name` and `description`. Max 1024 characters total.
- `name`: letters, numbers, and hyphens only (no parentheses, special chars)
- `description`: third-person, describes ONLY when to use (NOT what it does) — start with "Use when...", include specific symptoms/situations, keep under 500 characters if possible (see CSO below for why)

```markdown
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
[Small inline flowchart IF decision non-obvious]
Bullet list with SYMPTOMS and use cases. When NOT to use.

## Core Pattern (for techniques/patterns)
Before/after code comparison

## Quick Reference
Table or bullets for scanning common operations

## Implementation
Inline code for simple patterns. Link to file for heavy reference or reusable tools.

## Common Mistakes
What goes wrong + fixes
```

## Claude Search Optimization (CSO)

**Critical for discovery:** future Claude needs to FIND your skill via its description before it can use the body.

### Description = When to Use, NOT What the Skill Does

The description should ONLY describe triggering conditions — never summarize the skill's process or workflow.

**Why this matters:** when a description summarizes the workflow, Claude may follow the description instead of reading the full skill content and skip steps the body actually requires. A description saying "code review between tasks" caused Claude to do ONE review even though the skill's flowchart showed TWO. Changing it to "Use when executing implementation plans with independent tasks" (no workflow summary) fixed it. **The trap: a description that summarizes workflow becomes a shortcut Claude takes instead of reading the skill.**

```yaml
# BAD: summarizes workflow — Claude may follow this instead of reading the skill
description: Use when executing plans - dispatches subagent per task with code review between tasks

# GOOD: triggering conditions only, no workflow summary
description: Use when executing implementation plans with independent tasks in the current session
```

Content rules:
- Concrete triggers, symptoms, situations that signal this skill applies
- Describe the *problem* (race conditions, inconsistent behavior), not *language-specific symptoms* (setTimeout, sleep) — unless the skill itself is technology-specific, then say so explicitly
- Third person (it's injected into the system prompt)

### Keyword Coverage

Use words Claude would search for: error messages ("Hook timed out", "ENOTEMPTY"), symptoms ("flaky", "hanging", "zombie"), synonyms ("timeout/hang/freeze"), actual tool/command/library names.

### Descriptive Naming

Active voice, verb-first, name by what you DO or the core insight:
- `condition-based-waiting` not `async-test-helpers`
- `flatten-with-flags` not `data-structure-refactoring`
- `root-cause-tracing` not `debugging-techniques`
- Gerunds work well for processes: `creating-skills`, `debugging-with-logs`

### Token Efficiency

getting-started/frequently-loaded skills load into EVERY conversation — every token counts. Target: getting-started <150 words, other frequently-loaded <200 words total, other skills <500 words. Check with `wc -w skills/path/SKILL.md`.

- Move flag/option documentation to `--help`, not SKILL.md
- Cross-reference other skills instead of repeating their workflow inline
- One example per pattern, not several
- Don't repeat what's in cross-referenced skills or explain what's obvious from the command

### Cross-Referencing Other Skills

Use skill name only, with explicit requirement markers — not `@` links, which force-load the file immediately and burn 200k+ context before it's needed:
- Good: `**REQUIRED SUB-SKILL:** Use tdd-workflow`
- Good: `**REQUIRED BACKGROUND:** You MUST understand systematic-debugging`
- Bad: `@skills/testing/test-driven-development/SKILL.md`

## Flowchart Usage

Use a small inline flowchart ONLY for non-obvious decision points or "A vs B" choices where an agent might stop too early. Never use one for reference material (use tables/lists), code examples (use markdown blocks), or linear instructions (use numbered lists). Never use generic step labels (`step1`, `helper2`) — labels need semantic meaning.

## Code Examples

**One excellent example beats many mediocre ones.** Choose the most relevant language for the domain (TypeScript for testing techniques, Shell/Python for system debugging). A good example is complete, runnable, well-commented on WHY, and from a real scenario — not a fill-in-the-blank template. Don't implement the same pattern in 5+ languages; porting one great example is easy.

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to NEW skills AND EDITS to existing skills. Write skill before testing? Delete it, start over. Edit skill without testing? Same violation.

**No exceptions** — not for "simple additions," "just adding a section," or "documentation updates." Don't keep untested changes as "reference." Delete means delete.

**REQUIRED BACKGROUND:** The tdd-workflow skill explains why this matters. Same principles apply to documentation.

## RED-GREEN-REFACTOR for Skills

### RED: Write Failing Test (Baseline)
Run the pressure scenario with a subagent WITHOUT the skill. Document exact behavior verbatim: what choices did they make, what rationalizations did they use, which pressures triggered violations. This is "watch the test fail" — you must see what agents naturally do before writing the skill.

### GREEN: Write Minimal Skill
Write a skill that addresses those specific rationalizations. Don't add content for hypothetical cases. Run the same scenarios WITH the skill — the agent should now comply.

### REFACTOR: Close Loopholes
Agent found a new rationalization? Add an explicit counter. Re-test until bulletproof.

**Testing methodology:** for how to write pressure scenarios, combine pressure types (time, sunk cost, authority, exhaustion), and run baseline-vs-skill comparisons systematically, use the `empirical-prompt-tuning` skill — it generalizes this same RED/GREEN loop to any agent-facing instruction text.

Different skill types need different test framing:

| Skill type | Test with | Success criteria |
|---|---|---|
| Discipline-enforcing (TDD, verification-before-completion) | Pressure scenarios, multiple pressures combined | Agent follows rule under maximum pressure |
| Technique (how-to guides) | Application + edge-case scenarios | Agent successfully applies technique to a new scenario |
| Pattern (mental models) | Recognition + counter-example scenarios | Agent correctly identifies when/how to apply the pattern |
| Reference (API/docs) | Retrieval + gap testing | Agent finds and correctly applies reference information |

## Bulletproofing Skills Against Rationalization

Skills that enforce discipline need to resist rationalization — agents are smart and will find loopholes under pressure. **Violating the letter of the rules is violating the spirit of the rules** — state this early to cut off "I'm following the spirit" arguments.

**Close every loophole explicitly.** Don't just state the rule — forbid the specific workarounds you saw in RED-phase testing:

```markdown
Write code before test? Delete it. Start over.

No exceptions:
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

**Build a rationalization table** from every excuse seen during baseline testing:

| Excuse | Reality |
|--------|---------|
| "Skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "I'll test if problems emerge" | Problems = agents can't use the skill. Test BEFORE deploying. |
| "Tests after achieve the same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Too simple/tedious to test" | 15 min testing saves hours debugging a bad skill in production. |

### Red Flags - STOP and Start Over

```markdown
- Code before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "This is different because..."
```

**All of these mean: delete code, start over with TDD.**

Update the description field with symptoms of when an agent is ABOUT to violate the rule (e.g. `description: use when implementing any feature or bugfix, before writing implementation code`).

## Anti-Patterns

| Anti-pattern | Why bad |
|---|---|
| Narrative example ("In session 2025-10-03, we found...") | Too specific, not reusable |
| Multi-language dilution (example-js.js, example-py.py, example-go.go) | Mediocre quality, maintenance burden |
| Code inside flowchart nodes | Can't copy-paste, hard to read |
| Generic labels (helper1, step3, pattern4) | Labels should have semantic meaning |

## STOP: Before Moving to Next Skill

After writing ANY skill, complete the deployment process before starting the next one. Do NOT batch multiple untested skills, move on before the current one is verified, or skip testing because "batching is more efficient." Deploying an untested skill is deploying untested code.

## Three Audit Rules (from the 2026-08 133-item stocktake)

1. **Procedure vs judgment test**: If the skill narrates a multi-step
   procedure an agent should follow deterministically, it belongs in a
   workflow script or hook, not a skill. Skills earn their place by
   encoding judgment criteria, domain knowledge, or output contracts.
   (All 51 items deleted in the stocktake were procedure-narrators;
   everything kept encoded judgment.)

2. **Verify references at write time**: Every skill/command/script/file
   you reference (Related sections included) must exist on disk — check
   with ls/grep BEFORE writing the reference. Unverified references were
   the most common defect class found (20+ dead links, including 4
   commands that were unrunnable because their target script never existed).

3. **Date version-sensitive content**: any skill encoding version-specific
   idioms must carry `metadata.verified: YYYY-MM` frontmatter; the stocktake
   freshness scanner flags drift. Judgment-only skills don't need it.

## Skill Creation Checklist (TDD Adapted)

**IMPORTANT: Use TodoWrite to create todos for EACH checklist item below.**

**RED Phase - Write Failing Test:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run scenarios WITHOUT skill - document baseline behavior verbatim
- [ ] Identify patterns in rationalizations/failures

**GREEN Phase - Write Minimal Skill:**
- [ ] Name uses only letters, numbers, hyphens (no parentheses/special chars)
- [ ] YAML frontmatter with only name and description (max 1024 chars)
- [ ] Description starts with "Use when..." and includes specific triggers/symptoms
- [ ] Description written in third person, no workflow summary
- [ ] Keywords throughout for search (errors, symptoms, tools)
- [ ] Clear overview with core principle
- [ ] Address specific baseline failures identified in RED
- [ ] Code inline OR link to separate file
- [ ] One excellent example (not multi-language)
- [ ] Run scenarios WITH skill - verify agents now comply

**REFACTOR Phase - Close Loopholes:**
- [ ] Identify NEW rationalizations from testing
- [ ] Add explicit counters (if discipline skill)
- [ ] Build rationalization table from all test iterations
- [ ] Create red flags list
- [ ] Re-test until bulletproof

**Quality Checks:**
- [ ] Small flowchart only if decision non-obvious
- [ ] Quick reference table
- [ ] Common mistakes section
- [ ] No narrative storytelling
- [ ] Supporting files only for tools or heavy reference
- [ ] Every referenced skill/command/file verified to exist on disk

**Deployment:**
- [ ] Commit skill to git and push to your fork (if configured)
- [ ] Consider contributing back via PR (if broadly useful)

## The Bottom Line

**Creating skills IS TDD for process documentation.** Same Iron Law: no skill without a failing test first. Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes). If you follow TDD for code, follow it for skills — it's the same discipline applied to documentation.
