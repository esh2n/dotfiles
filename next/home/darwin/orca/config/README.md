# Orca (ADE)

[Orca](https://www.onorca.dev/) — worktree IDE for coding agents. Installed as
the tap-qualified cask `stablyai/orca/orca` (the untapped `orca` cask is
Plotly's unrelated chart renderer). This directory is linked to `~/.orca` by
`manager.sh` (same non-XDG pattern as warp).

What is managed here:

- `keybindings.json` — the only settings file Orca documents
  (https://www.onorca.dev/docs/settings). Everything else is GUI-managed
  (Cmd-, in the app) and lives in Electron app data, not here.

Notes:

- The app self-updates on its stable channel; brew only bootstraps it.
- Orca defers to per-repo `.claude/` / `.codex/` / `CLAUDE.md` / `AGENTS.md`
  for agent hooks and memory — those are already managed by yoki, so there is
  deliberately no Orca-side duplication of them.
- If Orca writes runtime state into `~/.orca`, it lands in this directory;
  `.gitignore` allowlists only the files above. Extend the allowlist when a
  new file is genuinely worth versioning.
