---
name: code-graph-exploration
description: Choose between code-graph, LSP, search, and direct file reading when investigating a repository. Use for impact analysis, call paths, dependency or implementation tracing, dead-code checks, cross-package architecture, unfamiliar large repositories, or when deciding whether Codebase-Memory graph evidence is appropriate. Prefer repository-local instructions when they define another graph/index workflow.
---

# Code Graph Exploration

Use Codebase-Memory for broad structural candidate discovery. Use Serena/LSP and exact source ranges as the semantic authority.

## Selection

Honor repository-local `AGENTS.md` and skills first.

Prefer graph tools for callers, implementations, impact radius, call paths, package-crossing flows, architecture, hotspots, and dead-code candidates. Prefer Serena/LSP or direct reads for known symbols, local implementation questions, definitions, references, and refactors. Treat repository size only as a secondary signal.

## Workflow

1. Call `list_projects`; index only when absent or stale.
2. Query the narrowest structural relation needed.
3. Check index coverage for cited paths.
4. Verify graph-selected symbols with Serena/LSP or exact source before edits and exhaustive or negative claims.
5. Build, type-check, and test changes.

When graph and LSP disagree, disclose it and follow LSP/source evidence.

## Cache policy

The managed wrapper records access and performs throttled cleanup. Defaults are a 30-day TTL and a 5 GiB ceiling. Override with `CODE_GRAPH_CACHE_TTL_DAYS`, `CODE_GRAPH_CACHE_MAX_GIB`, and `CODE_GRAPH_CACHE_GC_INTERVAL_HOURS`. Preview cleanup with `code-graph-cache-gc --force --dry-run`.

Do not commit `.codebase-memory/` unless the repository explicitly adopts a shared graph artifact. Repository-local retention and index rules override these defaults.
