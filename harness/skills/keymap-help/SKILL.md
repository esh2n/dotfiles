---
name: keymap-help
description: "Look up Neovim keybindings. Answers 「このキーなんだっけ？」 and 「dotfilesでカスタムしたやつ何だっけ？」. Detects the active distro (lazyvim/nvchad/astrovim/custom) at run time, dumps every keymap from a headless nvim, and marks the ones defined in dotfiles with ★. Runs from any directory. Use whenever the user asks about nvim keymaps, keybindings, or shortcuts."
metadata:
  namespaces: [work]
---

# keymap-help — Neovim keymap helper

A skill for looking up Neovim keybindings. It solves three problems:

1. **"What was this keybinding again?"** → search across keys and descriptions
2. **"I customized this in dotfiles and forgot"** → extract only self-made keys, marked ★
3. **"Annoying to consult from another dir"** → cwd-independent; works from anywhere

## How it works

- **Detects the active distro at run time** from the `~/.config/nvim` symlink
  (lazyvim / nvchad / astrovim / custom are switchable via `nvim-switch`, so never hardcode it)
- Starts a **headless nvim**, fires `VeryLazy`, then dumps every mode's keymaps
  through `nvim_get_keymap` (framework defaults + plugins + custom, 500+ entries).
  leader/localleader are shown expanded as `<leader>` / `<localleader>`.
- **Buffer-local / lazily registered keys** that never reach the global map (notably
  the LSP set `gd` `gr` `gI` `gy` etc., mapped only on LspAttach) are filled in from the
  `lazy.core.config` plugin specs (`keys` and lspconfig's `opts.servers[*].keys`).
  All 4 distros are lazy.nvim based, so this works across them.
- **Known gap**: treesitter-textobjects motion keys (`]f` `[f` `]c` `]a` etc.) are defined
  in `opts.(textobjects.)move.keys` and registered on FileType, so they appear in neither
  the dump nor the spec fill-in. When asked about function/class/argument motions and
  the search returns 0 hits, read the `nvim-treesitter-textobjects` spec directly (for
  lazyvim: under `~/.local/share/nvim/lazy/` or the dotfiles plugin config) and answer.
- The headless-startup lua is passed via a temp file (`luafile`) to keep argv minimal,
  so sessions with a bloated environment are unlikely to hit `posix_spawn` `E2BIG`.
- Greps **only the active distro's dotfiles config directory** to identify custom keys.
  That tree does not contain the framework itself (`~/.local/share/nvim`), so any lhs
  found there is necessarily user-defined → annotated with ★.
- Dump results are cached per distro (1h TTL + auto-invalidated on config change). First
  run ~3s, then ~0.1s. `--refresh` forces a fresh dump.

## Usage

Run the helper script (**cwd-independent**, call it by absolute path):

```bash
SC="$HOME/.claude/skills/keymap-help/scripts/nvim-keymaps.sh"
# fall back to the dotfiles copy when the symlink is broken
[ -f "$SC" ] || SC="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/skills/keymap-help/scripts/nvim-keymaps.sh"

bash "$SC"                    # all keymaps (custom marked ★)
bash "$SC" git                # search lhs/description containing "git"
bash "$SC" find files         # multiple words = AND search
bash "$SC" -c                 # only keys customized in dotfiles
bash "$SC" -c herdr           # search "herdr" among custom keys
bash "$SC" -k '<leader>ff'    # what does this key do? (exact match)
bash "$SC" -m v git           # restrict search to visual mode
bash "$SC" --distro           # which distro is active + config path
bash "$SC" --refresh          # re-dump
bash "$SC" --raw              # TSV output (mode\tlhs\tdesc\tcustom) — for post-processing
```

If the script is not reachable via `~/.claude/skills/`, use the copy inside dotfiles:
`harness/skills/keymap-help/scripts/nvim-keymaps.sh`

## Response policy (for the agent)

When the user asks about nvim keybindings, shortcuts, or keymaps:

1. Run `nvim-keymaps.sh <query>` first. Use `-c` when asked about "the ones I customized".
   Descriptions are in English, so translate a Japanese question into English keywords
   (next/function/buffer etc.) before searching. On 0 hits, also try synonyms (func/method/motion etc.).
2. Do not paste the raw output; **narrow it to the relevant entries**. Lead with ★ (custom) entries.
3. On 0 hits, run `--refresh` yourself and search again → still 0, retry with synonyms → finally
   read the lazy spec in the config dir shown by `--distro` (see "Known gap" above). Never end
   by telling the user to run something themselves.
4. Reading the output: `★` = custom in dotfiles / columns are `mode  lhs  description` (keys
   without a description show the rhs command). mode: n=normal, i=insert,
   v=visual, x=visual-block family, o=operator, t=terminal, c=command.

### Fallback when spawn fails in the sandbox (important)

If Bash fails with an **`E2BIG` / `posix_spawn` / sandbox-related spawn error**, the script
is not at fault: **Claude Code's sandbox wrapper inflated argv** (the seatbelt profile
balloons in large monorepos). The script itself never started.

In that case, **re-run the same command with the Bash tool's `dangerouslyDisableSandbox: true`**.
Only that one command runs outside the sandbox; the project's sandbox settings stay untouched.

- This skill is **read-only** (reads nvim config + headless nvim + writes only its own cache
  `~/.cache/keymap-help/`), so running it outside the sandbox is low risk for this purpose alone.
- If the user wants a permanent fix, you may suggest adding `bash *nvim-keymaps.sh*` or similar
  to the project's sandbox `excludedCommands` (sandbox stays on, only this script is excluded).
  Do not recommend setting the whole sandbox to `enabled: false`.

## Output example

```
# active: lazyvim | custom only (3件)  ★=dotfilesでカスタム

★  n   <leader>zf              herdr: send file path to agent
★  v   <leader>zl              herdr: send file path + line range to agent
★  x   <leader>zl              herdr: send file path + line range to agent
```

## Prerequisites

- `nvim` on PATH.
- The config loads cleanly under headless startup (a broken config surfaces as an error).
