---
name: skill-stocktake
description: "Use when auditing Claude skills for quality. Supports Quick Scan (changed skills only) and Full Stocktake modes with sequential subagent batch evaluation."
metadata:
  namespaces: [agent]
  origin: ECC
---

# skill-stocktake

Skill (invoked via the Skill tool as `skill-stocktake`) that audits all Claude skills using a quality checklist + AI holistic judgment. Supports two modes: Quick Scan for recently changed skills, and Full Stocktake for a complete review.

## Scope

The command targets the following paths **relative to the directory where it is invoked**:

| Path | Description |
|------|-------------|
| `~/.claude/skills/` | Global skills (all projects) |
| `{cwd}/.claude/skills/` | Project-level skills (if the directory exists) |

**At the start of Phase 1, the command explicitly lists which paths were found and scanned.**

### Targeting a specific project

To include project-level skills, run from that project's root directory:

```bash
cd ~/path/to/my-project
# then invoke the skill-stocktake skill (Skill tool)
```

If the project has no `.claude/skills/` directory, only global skills are evaluated.

## Modes

| Mode | Trigger | Duration |
|------|---------|---------|
| Quick Scan | `results.json` exists (default) | 5–10 min |
| Full Stocktake | `results.json` absent, or skill invoked with arg `full` | 20–30 min |

**Results cache:** `${XDG_CACHE_HOME:-$HOME/.cache}/skill-stocktake/results.json` (below, `$RESULTS`). Never write it under `~/.claude/skills/skill-stocktake/`: that path is a link into the dotfiles repository, so the file would land in the working tree.

## Quick Scan Flow

Re-evaluate only skills that have changed since the last run (5–10 min).

1. Read `$RESULTS`
2. Run: `bash ~/.claude/skills/skill-stocktake/scripts/quick-diff.sh "$RESULTS"`
   (Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed)
3. If output is `[]`: report "No changes since last run." and stop
4. Re-evaluate only those changed files using the same Phase 2 criteria
5. Carry forward unchanged skills from previous results
6. Output only the diff
7. Run: `bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh "$RESULTS" <<< "$EVAL_RESULTS"`

## Full Stocktake Flow

### Phase 1 — Inventory

Run: `bash ~/.claude/skills/skill-stocktake/scripts/scan.sh`

The script enumerates skill files, extracts frontmatter, and collects UTC mtimes.
Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed.
Present the scan summary and inventory table from the script output:

```
Scanning:
  ✓ ~/.claude/skills/         (17 files)
  ✗ {cwd}/.claude/skills/    (not found — global skills only)
```

| Skill | Description |
|-------|-------------|

使用実績の集計列は設けない（使用実績は jig の監査ログで確認する。少ないことだけを外す理由にしない）。

### Phase 2 — Quality Evaluation

Launch an Agent tool subagent (**general-purpose agent**) with the full inventory and checklist:

```text
Agent(
  subagent_type="general-purpose",
  prompt="
Evaluate the following skill inventory against the checklist.

[INVENTORY]

[CHECKLIST]

Return JSON for each skill:
{ \"verdict\": \"Keep\"|\"Improve\"|\"Update\"|\"Retire\"|\"Merge into [X]\", \"reason\": \"...\" }
"
)
```

The subagent reads each skill, applies the checklist, and returns per-skill JSON:

`{ "verdict": "Keep"|"Improve"|"Update"|"Retire"|"Merge into [X]", "reason": "..." }`

**Chunk guidance:** Process ~20 skills per subagent invocation to keep context manageable. Save intermediate results to `results.json` (`status: "in_progress"`) after each chunk.

After all skills are evaluated: set `status: "completed"`, proceed to Phase 3.

**Resume detection:** If `status: "in_progress"` is found on startup, resume from the first unevaluated skill.

Each skill is evaluated against this checklist:

```
- [ ] Content overlap with other skills checked
- [ ] Overlap with MEMORY.md / CLAUDE.md checked
- [ ] Freshness of technical references verified (use WebSearch if tool names / CLI flags / APIs are present)
```

> **Not a retire criterion:** usage frequency / low usage. A dynamic router
> (jev) selects skills per prompt, so a rarely-picked skill is not thereby
> defective. Retire only for a concrete defect (see the verdict table).

Verdict criteria:

| Verdict | Meaning |
|---------|---------|
| Keep | Useful and current |
| Improve | Worth keeping, but specific improvements needed |
| Update | Referenced technology is outdated (verify with WebSearch) |
| Retire | Defect-only: stale/broken references, near-empty content, or true duplication (NOT low usage) |
| Merge into [X] | Substantial overlap with another skill; name the merge target |

Evaluation is **holistic AI judgment** — not a numeric rubric. Guiding dimensions:
- **Actionability**: code examples, commands, or steps that let you act immediately
- **Scope fit**: name, trigger, and content are aligned; not too broad or narrow
- **Uniqueness**: value not replaceable by MEMORY.md / CLAUDE.md / another skill
- **Currency**: technical references work in the current environment

**Reason quality requirements** — the `reason` field must be self-contained and decision-enabling:
- Do NOT write "unchanged" alone — always restate the core evidence
- For **Retire**: state (1) what specific defect was found, (2) what covers the same need instead
  - Bad: `"Superseded"`
  - Good: `"disable-model-invocation: true already set; superseded by continuous-learning-v2 which covers all the same patterns plus confidence scoring. No unique content remains."`
- For **Merge**: name the target and describe what content to integrate
  - Bad: `"Overlaps with X"`
  - Good: `"42-line thin content; Step 4 of chatlog-to-article already covers the same workflow. Integrate the 'article angle' tip as a note in that skill."`
- For **Improve**: describe the specific change needed (what section, what action, target size if relevant)
  - Bad: `"Too long"`
  - Good: `"276 lines; Section 'Framework Comparison' (L80–140) duplicates ai-era-architecture-principles; delete it to reach ~150 lines."`
- For **Keep** (mtime-only change in Quick Scan): restate the original verdict rationale, do not write "unchanged"
  - Bad: `"Unchanged"`
  - Good: `"mtime updated but content unchanged. Unique Python reference; no other skill covers the same ground."`

### Phase 3 — Summary Table

| Skill | Verdict | Reason |
|-------|---------|--------|

### Phase 4 — Consolidation

1. **Retire / Merge**: present detailed justification per file before confirming with user:
   - What specific problem was found (overlap, staleness, broken references, etc.)
   - What alternative covers the same functionality (for Retire: which existing skill/rule; for Merge: the target file and what content to integrate)
   - Impact of removal (any dependent skills, MEMORY.md references, or workflows affected)
2. **Improve**: present specific improvement suggestions with rationale:
   - What to change and why (e.g., "trim 430→200 lines because sections X/Y duplicate python-patterns")
   - User decides whether to act
3. **Update**: present updated content with sources checked
4. Check MEMORY.md line count; propose compression if >100 lines

## Harness-wide Stocktake

When the request is a periodic stocktake of the whole harness (not only skills), also cover these areas. Every finding is `keep` / `drop-candidate` / `fix` / `unknown` with the concrete observation it rests on.

- **Skills (structure)** — broken symlinks, empty skill dirs, near-duplicate frontmatter descriptions → `fix` or `drop-candidate`. `node_modules`, build output or media inside a skill dir → `fix` (move out); a skill's own tool with its `package.json` beside it is intentional → `keep`.
- **Hooks** — for each hook wired in `~/.claude/settings.json`: script exists, is executable, passes `bash -n` / `node --check`; scan hook logs for recent errors. A script in `~/.claude/hooks` wired nowhere → `drop-candidate`.
- **MCP** — compare configured servers (`~/.claude/settings.json`, `~/.claude.json`) with the audit log. Zero logged calls → "not used well yet": judge by fit with industry practice and use case, never drop on usage alone. Plugin-provided tools the log may not capture → `unknown`.
- **Memory and caches** — memory index lines whose target file is gone → `fix`; report sizes of memory/cache stores and stale `.tmp` piles. Grilling slug dirs under `.claude/.cache/grilling/` older than 60 days → `drop-candidate`; a slug dir with `round-<n>.md` but no `transcript.md` → `fix` (abandoned grilling).
- **Freshness** — collect `verified:` dates (`grep -rn "verified:" --include=SKILL.md`). Flag a skill when its date is older than 90 days, or it is undated but states version-pinned facts (version numbers, "ES20xx", framework features tied to a release); judgment-only skills are out of scope. WebSearch the 3–5 riskiest and report each as `fix`: "<skill> verified <date> but <ecosystem> is now at <version/change> as of <source>".
- When an area cannot be audited → name it as unaudited with the one-line reason in the report; never guess its contents, and never fill fields with placeholders (an honest error beats fabrication). One failed area does not discard the others.
- Report → in the owner's language, grouped by area, drop candidates first (with why), then fixes. Report only: delete or edit nothing during the stocktake.

## Results File Schema

`$RESULTS` (`${XDG_CACHE_HOME:-$HOME/.cache}/skill-stocktake/results.json`):

**`evaluated_at`**: Must be set to the actual UTC time of evaluation completion.
Obtain via Bash: `date -u +%Y-%m-%dT%H:%M:%SZ`. Never use a date-only approximation like `T00:00:00Z`.

```json
{
  "evaluated_at": "2026-02-21T10:00:00Z",
  "mode": "full",
  "batch_progress": {
    "total": 80,
    "evaluated": 80,
    "status": "completed"
  },
  "skills": {
    "skill-name": {
      "path": "~/.claude/skills/skill-name/SKILL.md",
      "verdict": "Keep",
      "reason": "Concrete, actionable, unique value for X workflow",
      "mtime": "2026-01-15T08:30:00Z"
    }
  }
}
```

## Notes

- Evaluation is blind: the same checklist applies to all skills regardless of origin (ECC, self-authored, auto-extracted)
- Archive / delete operations always require explicit user confirmation
- No verdict branching by skill origin
