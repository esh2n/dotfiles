# Dotfiles Configuration

Domain-driven dotfiles with multi-shell support and theme switching.

## Features

### Multi-Shell Support
- **Zsh & Fish**: Full support for both shells
- **Shared configs**: Centralized aliases and environment variables
- **Modern tools**: skim, eza, bat, zoxide, atuin, yazi

### Neovim Distribution Switcher
Switch between multiple Neovim distributions:

| Distribution | Description |
|--------------|-------------|
| Custom | Personal configuration |
| LazyVim | Fast and minimal |
| NvChad | Beautiful UI |
| AstroVim | Feature-rich |

```bash
nvim-switch lazyvim
nvim-switch custom
```

### Theme Switcher
Quick theme switching for all tools:

| Theme | Base Colors |
|-------|-------------|
| Catppuccin Mocha | Warm, soft pastels |
| Nord | Cool, arctic palette |
| Tokyo Night | Dark, vibrant |

Applies to: WezTerm, Ghostty, Sketchybar, Borders, Zellij

```bash
theme-switch nord
theme-switch catppuccin
```

### Wallpaper Integration
Download and set wallpapers from Wallhaven.cc:

```bash
wallpaper search "cyberpunk"
```

## Directory Structure

```
dotfiles/
├── core/          # Installer, config manager, utilities
├── domains/       # Domain-specific configurations
│   ├── creative/  # Media tools, wallpaper scripts
│   ├── dev/       # Neovim, terminals, shells, languages
│   ├── infra/     # Network, security
│   ├── system/    # Fonts, colors, themes
│   └── workspace/ # Window managers, status bars
└── specs/         # Architecture documentation
```

## Installation

```bash
cd dotfiles
./core/install/installer.sh
```

### Options

| Option | Description |
|--------|-------------|
| `--force` | Remove stale symlinks pointing to other dotfiles before linking |
| `-h, --help` | Show help message |

```bash
# Normal installation
./core/install/installer.sh

# Clean install (removes old dotfiles symlinks)
./core/install/installer.sh --force
```

The installer will:
1. Install Homebrew & Nix (if needed)
2. Apply nix-darwin configuration (installs all packages via Nix)
3. Setup language runtimes (mise)
4. Detect stale symlinks from other dotfiles
5. Create symlinks to configurations
6. Backup existing files (keeps 7 most recent)

## Configuration

### Package Management (Nix)

All packages are managed via Nix flake. Priority order:
1. **nixpkgs** - Primary source
2. **overlays** - Custom packages not in nixpkgs
3. **brew-nix** - GUI apps that work with brew-nix
4. **nix-darwin homebrew** - Fallback for problematic GUI apps / Homebrew-only CLI
5. **cargo install** - Rust tools not available elsewhere

| Location | Purpose |
|----------|---------|
| `core/nix/flake.nix` | Main Nix flake entry point |
| `core/nix/darwin.nix` | System-wide macOS settings |
| `core/nix/overlays.nix` | Custom package definitions |
| `domains/*/packages/home.nix` | User packages per domain |
| `domains/*/packages/homebrew.nix` | Homebrew fallbacks per domain |

### Symlink Management

```bash
# Re-apply symlinks
./core/config/manager.sh link

# Process templates
./core/config/manager.sh template
```

### Template System

Some config files (VSCode `settings.json`, Mise `config.toml`) cannot use environment variables. Use `.template` files with `{{HOME}}` placeholders:

```bash
# Generate config files from templates
./core/config/manager.sh template
```

This replaces `{{HOME}}` with your actual home directory. Generated files are ignored by git; only `.template` files are tracked.

### Environment Variables

WezTerm weather widget requires OpenWeather API key. Set it via:


**`.env` file**
Create `.env` in dotfiles root:
```bash
OPENWEATHER_API_KEY=your-api-key
```

The widget checks `OPENWEATHER_API_KEY` env var first, then looks for `.env` in:
- `$DOTFILES_ROOT/.env`
- `~/dotfiles/.env`
- Config directory relative paths

For Lua-based configs (WezTerm), set `DOTFILES_ROOT` in your shell config:
```bash
export DOTFILES_ROOT="$HOME/go/github.com/esh2n/dotfiles/dotfiles"
```

## Included Tools

### Terminal & Shell
- WezTerm, Ghostty, Warp
- Zellij (terminal multiplexer with rich plugins)
- Zsh, Fish
- Starship prompt

### CLI Tools
- **eza** - Modern `ls` with colors and icons
- **bat** - Syntax-highlighted `cat`
- **sk** - Fuzzy finder (skim)
- **zoxide** - Smart `cd`
- **atuin** - Shell history search with sync
- **yazi** - Terminal file manager
- **vivid** - LS_COLORS generator
- **btop** - Modern system monitor
- **thefuck** - Command correction

#### Usage
- `Ctrl+R` - History search (atuin)
- `y` - File manager with auto-cd (yazi)
- `z <dir>` - Smart directory jumping (zoxide)
- `zi` - Interactive directory selection (zoxide)
- `btop` - Interactive system monitor
- `fuck` - Fix previous command (thefuck)
- Auto-suggestions appear in gray text (zsh-autosuggestions)

### Git Aliases

Minimal keystrokes for common git operations. Pattern: lowercase for normal, uppercase for powerful/destructive operations.

#### Basic Operations

| Alias | Command | Note |
|-------|---------|------|
| `ga` | `git add` | |
| `gA` | `git add --all` | |
| `gc` | `git commit` | |
| `gC` | `git commit --amend` | |
| `gcm` | `git commit -m` | |
| `gCm` | `git commit --amend -m` | |

#### Push/Pull/Fetch

| Alias | Command | Note |
|-------|---------|------|
| `gpso [branch]` | `git push origin` | Interactive if no args, normal if branch specified |
| `gPso [branch]` | `git push --force origin` | Interactive if no args, force push if branch specified |
| `gpl` | `git pull` | Pull current branch |
| `gf` | `git fetch` | Fetch all remotes |

#### Branch

| Alias | Command | Note |
|-------|---------|------|
| `gb` | `git branch` | List branches |
| `gsw [branch]` | `git switch` | Interactive if no args, normal if branch specified |
| `gswc` | `git switch -c` | Create new branch |
| `grn` | `git branch -m` | Rename branch |

#### Merge

| Alias | Command | Note |
|-------|---------|------|
| `gm` | `git merge` | |
| `gM` | `git merge --no-ff` | Preserve history |
| `gma` | `git merge --abort` | |

#### Diff

| Alias | Command | Note |
|-------|---------|------|
| `gd` | `git diff` | |
| `gD` | `git diff --cached` | Staged changes |
| `gds` | `git diff --stat` | |

#### Rebase

| Alias | Command | Note |
|-------|---------|------|
| `gr` | `git rebase` | |
| `gR` | `git rebase -i` | Interactive |
| `grc` | `git rebase --continue` | |
| `gra` | `git rebase --abort` | |

#### Reset

| Alias | Command | Note |
|-------|---------|------|
| `grs` | `git reset` | |
| `grs1` | `git reset --hard HEAD~1` | |
| `grs2` | `git reset --hard HEAD~2` | |
| `grs3` | `git reset --hard HEAD~3` | |

#### Restore

| Alias | Command | Note |
|-------|---------|------|
| `grt` | `git restore` | |
| `gRt` | `git restore --staged` | Unstage |

#### Stash

| Alias | Command | Note |
|-------|---------|------|
| `gst` | `git stash` | |
| `gSt` | `git stash pop` | |
| `gsta` | `git stash apply` | |
| `gstl` | `git stash list` | |
| `gstd` | `git stash drop` | |

#### Interactive (skim-based)

Functions that support both interactive and argument modes:

| Alias | Usage | Description |
|-------|-------|-------------|
| `gsw` | No args: interactive | Select branch and switch |
| `gsw <branch>` | With args: normal | Switch to specified branch |
| `gpso` | No args: interactive | Select branch and push origin |
| `gpso <branch>` | With args: normal | Push specified branch to origin |
| `gPso` | No args: interactive | Select branch and force push origin |
| `gPso <branch>` | With args: normal | Force push specified branch to origin |

Pure interactive aliases (no argument support):

| Alias | Description |
|-------|-------------|
| `gbd` | Select local branch to delete |
| `gme` | Select branch to merge with --no-ff --edit |
| `gmesq` | Select branch to merge with --squash |
| `gpr` | Select base branch for pull request |
| `glo` | Select branch and show log graph |
| `gtr` | Show all branches log graph (non-interactive) |

#### Other

| Alias | Command | Note |
|-------|---------|------|
| `gs` | `git status -sb` | Short format |
| `gg` | `git grep` | |
| `gi` | `git init` | |
| `gcl` | `git clone` | |

#### tmux / WezTerm / Zellij (Prefix: Ctrl+q)

Keybindings unified across tmux, WezTerm, and Zellij.

| Operation | Keybind | Note |
|-----------|---------|------|
| Split horizontal | `Prefix + \` | |
| Split vertical | `Prefix + -` | |
| Navigate panes | `Prefix + h/j/k/l` | |
| Resize panes | `Prefix + H/J/K/L` | |
| Zoom pane | `Prefix + z` | |
| Floating panes toggle | `Prefix + w` | Zellij only |
| Embed/float current pane | `Prefix + e` | Zellij only |
| Close pane | `Prefix + x` | |
| Previous tab | `Ctrl+h` | No prefix |
| Next tab | `Ctrl+l` | No prefix |
| Go to tab 1-5 | `Ctrl+1-5` | No prefix, Zellij only |
| New tab | `Prefix + t` | Zellij only |
| Last tab | `Prefix + Tab` | tmux only |
| Copy/scroll mode | `Prefix + [` | |
| Begin selection | `v` | In copy mode |
| Copy and exit | `y` | tmux only |
| Detach session | `Prefix + d` | |
| Monocle plugin | `Prefix + f` | Zellij only (file finder) |
| Harpoon plugin | `Prefix + h` | Zellij only (bookmarks) |

**tmux Session Restore (tmux-resurrect + tmux-continuum):**
- Auto-save every 15 minutes
- Auto-restore on tmux startup
- Manual save: `Prefix + Ctrl+s`
- Manual restore: `Prefix + Ctrl+r`
- Restores: windows, panes, working dirs, running programs (vim, nvim, ssh, etc.)
- Session files: `~/.tmux/resurrect/`

**Zellij Session Management:**
- List sessions: `zellij list-sessions`
- Attach to session: `zellij attach <session-name>`
- Detach: `Prefix + d`
- Sessions persist until explicitly deleted: `zellij delete-session <session-name>`
- Plugins are accessible via prefix mode (see keybindings table above)

#### AeroSpace Window Manager

**Workspace Design:**
- W (Work): Cursor, VSCode, Ghostty - Development
- B (Browser): Chrome, Safari, Firefox
- C (Communication): Slack, Gather - Recommended for sub-monitor
- M (Music): Spotify, Apple Music
- N (Notion): Documentation
- D (Diagram/Discord): Dia, Discord
- 1-5: General purpose
- S: Reserved

**Main Mode:**

Window Navigation:
- `Alt+h/j/k/l` - Focus window (crosses monitor boundaries)
- `Alt+Shift+h/j/k/l` - Move window

Layout:
- `Alt+r` - Tiles layout (windows side by side)
- `Alt+Shift+r` - Accordion layout (windows stacked, navigate with Alt+h/l)
- `Alt+t` - Toggle floating/tiling
- `Alt+f` - Fullscreen

Resize:
- `Alt+-` - Decrease size by 50
- `Alt+=` - Increase size by 50

Workspaces:
- `Alt+1-5` - Switch to workspace 1-5
- `Alt+w/b/c/m/n/s/d` - Switch to named workspace
- `Alt+Tab` - Previous workspace
- `Alt+Shift+Tab` - Move workspace to next monitor

Move Window to Workspace:
- `Alt+Shift+1-5` - Move to workspace and follow
- `Alt+Shift+w/b/c/m/n/s/d` - Move to named workspace and follow

**Service Mode** (`Alt+Shift+;`):
- `Esc` - Reload config and return to main mode
- `r` - Reset workspace tree layout
- `f` - Toggle floating/tiling
- `Backspace` - Close all windows except current

**Configuration:**
- Default layout: Accordion (single windows use full space)
- Apps auto-assign to dedicated workspaces
- Padding: Top 52px (sketchybar 40px + 12px), Horizontal 12px, Vertical 8px

**Multi-Monitor:**
Each monitor has independent workspaces. Use `Alt+h/j/k/l` to move focus across monitors, then use workspace shortcuts on the focused monitor.

#### Workspace Management CLI

**Interactive CLI:**
- `ws` - Launch interactive workspace manager
- `ws service` - Service management menu
- `ws layout` - Layout management menu
- `ws info` - Information menu

**Features:**
- Service Management: Start, stop, restart workspace services
- Layout Save/Restore: Save current window layout and restore to any monitor
- Presets: Quick setup for common layouts (Communication, etc.)
- Information: View windows, workspaces, monitors, apps

**Legacy Commands:**
- `brdr/brds/brdk` - Borders restart/start/stop
- `sbr/sbs/sbk` - Sketchybar restart/start/stop
- `wsls` - List all workspace services status
- `wsrestart` - Restart all (Sketchybar, Borders, AeroSpace)
- `wsstart` - Start all services
- `wsstop` - Stop all services

#### Known Issues
When prompted "Ignore insecure directories and continue [y] or abort compinit [n]?", choose `y`. This is a permissions warning for brew-installed completions.

#### Neovim Distributions

All distributions use `<Space>` as the leader key. Press `<Space>` and wait to see keybind hints via which-key.

**LazyVim:**

| Operation | Keybind | Note |
|-----------|---------|------|
| Show hints | `<Space>` | Wait for which-key popup |
| File tree toggle | `<Space> + e` | |
| File tree focus | `<Space> + o` | |
| Search files | `<Space> + s + f` | |
| Search word | `<Space> + s + w` | |
| Search grep | `<Space> + s + g` | |
| Toggle options | `<Space> + t` | |
| Git operations | `<Space> + g` | |
| Buffer operations | `<Space> + b` | |
| LSP operations | `<Space> + l` | |
| Terminal | `<Space> + f + t` | |
| Window navigation | `Ctrl+h/j/k/l` | |
| Save | `<Space> + w` | |
| Quit | `<Space> + q` | |

**NvChad:**

| Operation | Keybind | Note |
|-----------|---------|------|
| Show hints | `<Space>` | Wait for which-key popup |
| Find files | `<Space> + ff` | |
| Find all files | `<Space> + fa` | |
| Live grep | `<Space> + fw` | |
| Find buffers | `<Space> + fb` | |
| NvimTree toggle | `Ctrl+n` | |
| NvimTree focus | `<Space> + e` | |
| Format file | `<Space> + fm` | |
| New buffer | `<Space> + b` | |
| Next buffer | `<Tab>` | |
| Prev buffer | `Shift+Tab` | |
| Close buffer | `<Space> + x` | |
| Terminal horizontal | `<Space> + h` | |
| Terminal vertical | `<Space> + v` | |
| Toggle terminal | `Alt+h/v/i` | h=horizontal, v=vertical, i=float |
| Window navigation | `Ctrl+h/j/k/l` | |
| Save | `Ctrl+s` | |
| Toggle line number | `<Space> + n` | |
| Toggle relative number | `<Space> + rn` | |
| Comment | `<Space> + /` | |

**AstroVim:**

| Operation | Keybind | Note |
|-----------|---------|------|
| Show hints | `<Space>` | Wait for which-key popup |
| File tree toggle | `<Space> + e` | |
| File tree focus | `<Space> + o` | |
| Find files | `<Space> + f` | |
| Language tools | `<Space> + l` | |
| Buffers | `<Space> + b` | |
| Terminal | `<Space> + t` | |
| Git | `<Space> + g` | |
| Packages | `<Space> + p` | |
| UI/UX | `<Space> + u` | |
| Window navigation | `Ctrl+h/j/k/l` | |
| Resize window | `Ctrl+Arrow` | |
| Save | `<Space> + w` | |
| Quit | `<Space> + q` | |
| Comment | `<Space> + /` | |

**Custom (Kickstart-based):**

| Operation | Keybind | Note |
|-----------|---------|------|
| Show hints | `<Space>` | Wait for which-key popup |
| File tree reveal | `\` | |
| Search help | `<Space> + s + h` | |
| Search files | `<Space> + s + f` | |
| Search grep | `<Space> + s + g` | |
| Search word | `<Space> + s + w` | |
| Search keymaps | `<Space> + s + k` | |
| Find buffers | `<Space><Space>` | |
| Window navigation | `Ctrl+h/j/k/l` | |
| Next buffer | `Shift+l` | |
| Prev buffer | `Shift+h` | |
| Close buffer | `<Space> + c` | |
| Save | `<Space> + w` | |

### Editor
- Neovim (4 distributions)
- VSCode, Cursor

### Window Management
- AeroSpace
- Borders
- Sketchybar
- Raycast

### Development
- Git, Docker
- mise (version manager)
- Language toolchains (Rust, Go, Node, Python)

## Safety

All existing configurations are backed up:
- Format: `{filename}.backup.{timestamp}`
- Example: `.zshrc.backup.20250123_012345`

## Custom Configuration

User-specific settings go in:
- `~/.config/git/config.local` - Git settings
- Shell environment: Modify `domains/dev/home/.zshenv`

## License

MIT
