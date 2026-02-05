---
title: Installation
description: How to install the dotfiles and manage packages.
---

## Setup

```bash
cd dotfiles
./core/install/installer.sh
```

| Option | Description |
|--------|-------------|
| `--force` | Remove stale symlinks from other dotfiles before linking |
| `-h, --help` | Show help |

```bash
# Standard install
./core/install/installer.sh

# Clean install (removes old symlinks first)
./core/install/installer.sh --force
```

The installer runs these steps in order:

1. Install Homebrew and Nix (if missing)
2. Apply nix-darwin configuration (all packages via Nix)
3. Set up language runtimes with mise
4. Detect stale symlinks
5. Create config symlinks
6. Back up existing files (keeps the 7 most recent)

## Package management (Nix)

All packages are managed through a Nix flake. Install priority:

1. **nixpkgs** — primary source
2. **overlays** — custom packages not in nixpkgs
3. **brew-nix** — GUI apps compatible with brew-nix
4. **nix-darwin homebrew** — fallback for problematic GUI apps / Homebrew-only CLI
5. **cargo install** — Rust tools not available elsewhere

| File | Purpose |
|------|---------|
| `core/nix/flake.nix` | Nix flake entrypoint |
| `core/nix/darwin.nix` | macOS system settings |
| `core/nix/overlays.nix` | Custom package definitions |
| `domains/*/packages/home.nix` | Per-domain user packages |
| `domains/*/packages/homebrew.nix` | Per-domain Homebrew fallbacks |

## Updating packages

After changing package config, apply with:

```bash
# Quick update
./core/nix/update.sh

# Full rebuild (slower, thorough)
./core/nix/update.sh --rebuild

# After adding npm packages
./core/nix/update.sh --node2nix
```

### Adding npm packages (node2nix)

1. Edit `domains/dev/packages/node2nix/package.json`
2. Run `./core/nix/update.sh --node2nix`

```json title="package.json"
{
  "dependencies": {
    "@anthropic-ai/claude-code": "*",
    "aicommits": "^1.0.0"
  }
}
```

## Backups

Existing config files are backed up automatically.

- Format: `{filename}.backup.{timestamp}`
- Example: `.zshrc.backup.20250123_012345`
