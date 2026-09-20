---
name: continuous-learning-v2
description: Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents. v2.1 adds project-scoped instincts to prevent cross-project contamination.
metadata:
  namespaces: [agent]
  origin: ECC
version: 2.1.0
---

# Continuous Learning v2.1 - Instinct
-Based Architecture

An advanced learning system that turns your Claude Code sessions into reusable knowledge through atomic "instincts" - small learned behaviors with confidence scoring.

**v2.1** adds **project-scoped instincts** — React patterns stay in your React project, Python conventions stay in your Python project, and universal patterns (like "always validate input") are shared globally.

> **Status in this repo: the automatic session-observation path does NOT run.**
> The upstream design below describes an observe.sh hook + a background
> observer daemon that generate instincts from tool calls. That machinery was
> never wired here (no `hooks.json` vendored, `observe.sh` in no settings
> layer) and the daemon was removed 2026-08-15; no instinct has ever been
> generated from it. **What actually works is the instinct store and its CLI**
> — `/instinct-status`, `/evolve`, `/promote`, and `scripts/instinct-cli.py`,
> operating on instincts recorded manually. Live learning in this repo is
> instead **correction-driven**: the `prompt:correction-detect` UserPromptSubmit
> hook records your corrections, and you distill them via `/learn` or the
> `retrospective-codify` skill. This skill's remaining value is the instinct
> store + scope/promotion/confidence pipeline described below; `retrospective-codify`
> owns turning a single correction into a rule/skill/lint.
>
> Sections describing the observer daemon and the observation-hook setup are
> kept below only as upstream reference, each flagged **[not wired]**.

## When to Activate

- Reviewing, exporting, importing, or promoting instincts in the store
- Tuning confidence thresholds for learned behaviors
- Reviewing, exporting, or importing instinct libraries
- Evolving instincts into full skills, commands, or agents
- Managing project-scoped vs global instincts
- Promoting instincts from project to global scope

## What's New in v2.1

| Feature | v2.0 | v2.1 |
|---------|------|------|
| Storage | Global (`~/.claude/homunculus/`) | Project-scoped (`${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects/<hash>/`) |
| Scope | All instincts apply everywhere | Project-scoped + global |
| Detection | None | git remote URL / repo path |
| Promotion | N/A | Project → global when seen in 2+ projects |
| Commands | 4 (status/evolve/export/import) | 6 (+promote/projects) |
| Cross-project | Contamination risk | Isolated by default |

## What's New in v2 (vs v1)

| Feature | v1 | v2 |
|---------|----|----|
| Observation | Stop hook (session end) | PreToolUse/PostToolUse (100% reliable) |
| Analysis | Main context | Background agent (Haiku) |
| Granularity | Full skills | Atomic "instincts" |
| Confidence | None | 0.3-0.9 weighted |
| Evolution | Direct to skill | Instincts -> cluster -> skill/command/agent |
| Sharing | None | Export/import instincts |

> The **Observation** and **Analysis** rows describe upstream design intent
> only — that hook-based capture + background observer is **[not wired]** here
> (see Status). The Granularity/Confidence/Evolution/Sharing rows are what the
> instinct store actually delivers.

## The Instinct Model

An instinct is a small learned behavior:

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-react-app"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**Properties:**
- **Atomic** -- one trigger, one action
- **Confidence-weighted** -- 0.3 = tentative, 0.9 = near certain
- **Domain-tagged** -- code-style, testing, git, debugging, workflow, etc.
- **Evidence-backed** -- tracks what observations created it
- **Scope-aware** -- `project` (default) or `global`

## How It Works

Instincts are recorded manually (via `scripts/instinct-cli.py`, or distilled
from corrections through `/learn` / `retrospective-codify`), scoped to project
or global, then clustered and promoted through the CLI. The upstream
auto-capture step (an observer daemon reading `observations.jsonl`) is **[not
wired]** in this repo — nothing writes observations, so the store starts from
whatever you record.

```
Recorded instinct (manual / correction-distilled)
      | + project context (git remote / repo path)
      v
+---------------------------------------------+
|  projects/<project-hash>/instincts/personal/ |
|   * prefer-functional.yaml (0.7) [project]   |
|   * use-react-hooks.yaml (0.9) [project]     |
+---------------------------------------------+
|  instincts/personal/  (GLOBAL)               |
|   * always-validate-input.yaml (0.85) [global]|
|   * grep-before-edit.yaml (0.6) [global]     |
+---------------------------------------------+
      |
      | /evolve clusters + /promote
      v
+---------------------------------------------+
|  projects/<hash>/evolved/ (project-scoped)   |
|  evolved/ (global)                           |
|   * commands/new-feature.md                  |
|   * skills/testing-workflow.md               |
|   * agents/refactor-specialist.md            |
+---------------------------------------------+
```

## Project Detection

The system automatically detects your current project:

1. **`CLAUDE_PROJECT_DIR` env var** (highest priority)
2. **`git remote get-url origin`** -- hashed to create a portable project ID (same repo on different machines gets the same ID)
3. **`git rev-parse --show-toplevel`** -- fallback using repo path (machine-specific)
4. **Global fallback** -- if no project is detected, instincts go to global scope

Each project gets a 12-character hash ID (e.g., `a1b2c3d4e5f6`). A registry file at `${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects.json` maps IDs to human-readable names.

### Data Directory

Continuous-learning-v2 stores its instinct data outside `~/.claude` so Claude Code's sensitive-path guard does not block instinct writes:

1. `CLV2_HOMUNCULUS_DIR` when set to an absolute path
2. `$XDG_DATA_HOME/ecc-homunculus`
3. `$HOME/.local/share/ecc-homunculus`

Existing users with data at `~/.claude/homunculus` can migrate once:

```bash
bash skills/continuous-learning-v2/scripts/migrate-homunculus.sh
```

## Quick Start

### 1. Observation Hooks — [not wired]

Automatic capture is OFF by omission. The upstream design registers an
`observe.sh` hook (PreToolUse/PostToolUse) that writes `observations.jsonl`
for a background observer daemon to mine. Neither is present here: no
`hooks.json` was vendored, `observe.sh` is in no settings layer, and the
daemon was removed 2026-08-15 (it called a `session-guardian.sh` that never
existed). Nothing writes observations, so the auto-capture path produces no
instincts. Live learning is correction-driven instead — see the Status note at
the top. Record instincts manually with the CLI (below).

### 2. Initialize Directory Structure

The system creates directories automatically on first use, but you can also create them manually:

```bash
# Global directories
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/ecc-homunculus"/{instincts/{personal,inherited},evolved/{agents,skills,commands},projects}

# Project directories are auto-created when the hook first runs in a git repo
```

### 3. Use the Instinct Commands

```bash
/instinct-status     # Show learned instincts (project + global)
/evolve              # Cluster related instincts into skills/commands
/instinct-export     # Export instincts to file
/instinct-import     # Import instincts from others
/promote             # Promote project instincts to global scope
/projects            # List all known projects and their instinct counts
```

## Commands

| Command | Description |
|---------|-------------|
| `/instinct-status` | Show all instincts (project-scoped + global) with confidence |
| `/evolve` | Cluster related instincts into skills/commands, suggest promotions |
| `/instinct-export` | Export instincts (filterable by scope/domain) |
| `/instinct-import <file>` | Import instincts with scope control |
| `/promote [id]` | Promote project instincts to global scope |
| `/projects` | List all known projects and their instinct counts |

## Configuration

`config.json` carries only a version marker now:

```json
{ "version": "2.1" }
```

The `observer` block it used to hold was removed along with the daemon — no
code ever read it, so the values it advertised (`enabled`,
`run_interval_minutes`, `min_observations_to_analyze`) did nothing.

Behavior (instinct thresholds, project scoping, promotion criteria) is
configured via code defaults in `instinct-cli.py`.

## File Structure

```
${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/
+-- identity.json           # Your profile, technical level
+-- projects.json           # Registry: project hash -> name/path/remote
+-- observations.jsonl      # [not wired] global observations (never written)
+-- instincts/
|   +-- personal/           # Global auto-learned instincts
|   +-- inherited/          # Global imported instincts
+-- evolved/
|   +-- agents/             # Global generated agents
|   +-- skills/             # Global generated skills
|   +-- commands/           # Global generated commands
+-- projects/
    +-- a1b2c3d4e5f6/       # Project hash (from git remote URL)
    |   +-- project.json    # Per-project metadata mirror (id/name/root/remote)
    |   +-- observations.jsonl        # [not wired] never written
    |   +-- observations.archive/     # [not wired]
    |   +-- instincts/
    |   |   +-- personal/   # Project-specific auto-learned
    |   |   +-- inherited/  # Project-specific imported
    |   +-- evolved/
    |       +-- skills/
    |       +-- commands/
    |       +-- agents/
    +-- f6e5d4c3b2a1/       # Another project
        +-- ...
```

## Scope Decision Guide

| Pattern Type | Scope | Examples |
|-------------|-------|---------|
| Language/framework conventions | **project** | "Use React hooks", "Follow Django REST patterns" |
| File structure preferences | **project** | "Tests in `__tests__`/", "Components in src/components/" |
| Code style | **project** | "Use functional style", "Prefer dataclasses" |
| Error handling strategies | **project** | "Use Result type for errors" |
| Security practices | **global** | "Validate user input", "Sanitize SQL" |
| General best practices | **global** | "Write tests first", "Always handle errors" |
| Tool workflow preferences | **global** | "Grep before Edit", "Read before Write" |
| Git practices | **global** | "Conventional commits", "Small focused commits" |

## Instinct Promotion (Project -> Global)

When the same instinct appears in multiple projects with high confidence, it's a candidate for promotion to global scope.

**Auto-promotion criteria:**
- Same instinct ID in 2+ projects
- Average confidence >= 0.8

**How to promote:**

```bash
# Promote a specific instinct
python3 instinct-cli.py promote prefer-explicit-errors

# Auto-promote all qualifying instincts
python3 instinct-cli.py promote

# Preview without changes
python3 instinct-cli.py promote --dry-run
```

The `/evolve` command also suggests promotion candidates.

## Confidence Scoring

Confidence evolves over time:

| Score | Meaning | Behavior |
|-------|---------|----------|
| 0.3 | Tentative | Suggested but not enforced |
| 0.5 | Moderate | Applied when relevant |
| 0.7 | Strong | Auto-approved for application |
| 0.9 | Near-certain | Core behavior |

**Confidence increases** when:
- Pattern is repeatedly observed
- User doesn't correct the suggested behavior
- Similar instincts from other sources agree

**Confidence decreases** when:
- User explicitly corrects the behavior
- Pattern isn't observed for extended periods
- Contradicting evidence appears

## Relationship to correction-driven learning

Because auto-capture is [not wired], this skill does not compete with the
repo's live learning path:

- **`retrospective-codify`** turns a single hard-won correction into one durable
  artifact — an ast-grep rule, a skill, or a CLAUDE.md rule. Use it when a
  correction should immediately become an enforced standard.
- **This skill (the instinct store)** holds many small, confidence-weighted
  instincts and clusters/promotes them over time via `/evolve` and `/promote`.
  Use it to accumulate and manage instincts you record manually.

The `prompt:correction-detect` hook feeds both by logging corrections to
`~/.claude/homunculus/corrections.jsonl`; `/learn` distills them.

## Backward Compatibility

- Existing global instincts can be migrated from `~/.claude/homunculus/instincts/` with `scripts/migrate-homunculus.sh`
- Existing `~/.claude/skills/learned/` skills from v1 still work

## Privacy

- Instinct data stays **local** on your machine
- Project-scoped instincts are isolated per project
- Only **instincts** (patterns) can be exported — not raw observations
- No actual code or conversation content is shared
- You control what gets exported and promoted

## Related

- [ECC-Tools GitHub App](https://github.com/apps/ecc-tools) - Generate instincts from repo history
- Homunculus - Community project that inspired the v2 instinct-based architecture (atomic observations, confidence scoring, instinct evolution pipeline)
- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Continuous learning section

---

*Instinct-based learning: teaching Claude your patterns, one project at a time.*
