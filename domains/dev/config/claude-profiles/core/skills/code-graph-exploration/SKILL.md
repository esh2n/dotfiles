---
name: code-graph-exploration
description: Choose between code-graph, LSP, search, and direct file reading when investigating a repository. Use for impact analysis, call paths, dependency or implementation tracing, dead-code checks, cross-package architecture, unfamiliar large repositories, or when deciding whether Codebase-Memory graph evidence is appropriate. Prefer repository-local instructions when they define another graph/index workflow.
---

# Code Graph Exploration

Use the graph to discover candidates and relationships. Treat Serena/LSP and source code as the semantic authority.

## Select the exploration path

Apply repository-local `AGENTS.md`, `CLAUDE.md`, and skills before this global default.

Use Codebase-Memory first when the question asks for:

- all callers, implementations, dependents, or affected symbols;
- a call path, cross-package flow, architecture boundary, hotspot, or dead-code candidate;
- broad discovery in an unfamiliar or large repository.

Use Serena/LSP or direct reading first when the target file or symbol is known, the question is local to one implementation, or a precise definition/reference/refactor operation is available.

Repository size is a secondary signal. A cross-package impact question can justify the graph in a small repository; a one-function edit may not justify it in a monorepo.

## Graph workflow

1. Call `list_projects`. Index the current repository only when it is absent or stale.
2. Use the narrowest structural tool that answers the question: `search_graph`, `trace_path`, `detect_changes`, or `get_architecture`.
3. Check index coverage for every path used as evidence. Do not interpret a clean coverage result as proof of completeness.
4. Verify graph-selected symbols with Serena/LSP or the exact source ranges before editing or making exhaustive/negative claims.
5. Build, type-check, and test after changes. The graph never replaces compiler evidence.

If the graph and LSP disagree, report the disagreement and follow LSP/source evidence. Do not silently combine contradictory edges.

## Freshness and cache

- The managed MCP wrapper records the repository as used and runs throttled maintenance.
- Default local index TTL is 30 days; default cache ceiling is 5 GiB.
- Override with `CODE_GRAPH_CACHE_TTL_DAYS`, `CODE_GRAPH_CACHE_MAX_GIB`, and `CODE_GRAPH_CACHE_GC_INTERVAL_HOURS`.
- Inspect without deleting: `code-graph-cache-gc --force --dry-run`.
- Repository-local graph artifacts or retention rules override these global defaults.
- Never add `.codebase-memory/` to Git unless the repository explicitly adopts a shared graph artifact.

Use `code-graph-cache-gc --force` for explicit cleanup. It removes projects through Codebase-Memory's lock-aware `delete_project` CLI rather than deleting SQLite files directly.
