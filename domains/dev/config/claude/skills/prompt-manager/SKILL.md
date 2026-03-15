---
name: prompt-manager
description: Browse, search, edit, and organize saved prompt templates in ~/.config/prompts/. Subcommands - list, search, edit, link, unlink, move.
disable-model-invocation: true
argument-hint: <subcommand> [args]
---

# Prompt Manager

Manage reusable prompt templates stored in `~/.config/prompts/`.

## Subcommands

### `/prompt-manager list`

List all saved prompts with descriptions.

```bash
# Global prompts
for f in ~/.config/prompts/global/*.md; do
  name=$(basename "$f" .md)
  desc=$(grep "^description:" "$f" | sed 's/description: //')
  echo "  /prompts/$name — $desc"
done

# Project prompts
for d in ~/.config/prompts/projects/*/; do
  project=$(basename "$d")
  echo ""
  echo "  [$project]"
  for f in "$d"*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f" .md)
    desc=$(grep "^description:" "$f" | sed 's/description: //')
    echo "    $name — $desc"
  done
done
```

### `/prompt-manager search <keyword>`

Search prompts by name, description, or tags.

```bash
grep -rl "$ARGUMENTS" ~/.config/prompts/ --include="*.md" | while read f; do
  name=$(basename "$f" .md)
  desc=$(grep "^description:" "$f" | sed 's/description: //')
  echo "  $f"
  echo "    $desc"
done
```

### `/prompt-manager edit <name>`

Open a prompt for editing. Read the file and present it for modification.

1. Find the prompt: search `global/` then `projects/*/` for `{name}.md`
2. Read and display the current content
3. Apply requested changes
4. Write back to the same path

### `/prompt-manager link <project>`

Link a project's prompts into the current repo's `.claude/commands/`.

```bash
project="$ARGUMENTS"
source="$HOME/.config/prompts/projects/$project"

if [ ! -d "$source" ]; then
  echo "Project '$project' not found in ~/.config/prompts/projects/"
  exit 1
fi

mkdir -p .claude/commands
ln -sf "$source" .claude/commands/prompts
echo "Linked: .claude/commands/prompts → $source"
echo "Available as /prompts/{name} in this project"
```

### `/prompt-manager unlink`

Remove the project prompt symlink from the current repo.

```bash
rm -f .claude/commands/prompts
echo "Unlinked project prompts from this repo"
```

### `/prompt-manager move <name> --to global|--to project <project>`

Move a prompt between global and project scope.

1. Find the source file
2. Move to the target directory (create project dir if needed)
3. Report the new location

## Directory Structure

```
~/.config/prompts/
├── global/              # → symlinked to ~/.claude/commands/prompts/
│   ├── refactor.md      #   invoke: /prompts/refactor
│   ├── review-code.md   #   invoke: /prompts/review-code
│   ├── write-test.md    #   invoke: /prompts/write-test
│   ├── explain.md       #   invoke: /prompts/explain
│   └── fix-error.md     #   invoke: /prompts/fix-error
└── projects/
    ├── sdi-core/        # → ln -s into project's .claude/commands/prompts
    └── dotfiles/
```

## Integration

- **Obsidian**: open `~/.config/prompts/` as vault folder. Tags in frontmatter are searchable.
- **Cursor**: copy prompt content from the .md file, or symlink into Cursor's rules.
- **Claude Code**: global prompts auto-available as `/prompts/{name}`. Project prompts available after `/prompt-manager link`.
