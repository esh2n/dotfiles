---
name: save-prompt
description: Save the current conversation pattern as a reusable prompt template. Prompts are stored in ~/.config/prompts/ (tool-agnostic, works with Claude Code, Cursor, Obsidian). Use after a good conversation to capture the pattern for reuse.
disable-model-invocation: true
argument-hint: [name] [--project <project-name>]
---

# Save Prompt

Capture the current conversation pattern as a reusable prompt template.

## Storage

```
~/.config/prompts/
├── global/              # Cross-repository prompts → /prompts/name
└── projects/{name}/     # Project-specific prompts
```

Global prompts are symlinked to `~/.claude/commands/prompts/` and available as `/prompts/{name}` in Claude Code.

## Process

1. **Parse arguments**:
   - `$ARGUMENTS` = `name` (kebab-case, action-oriented: fix-*, review-*, create-*, migrate-*)
   - `--project <name>` flag → save to `projects/{name}/` instead of `global/`
   - No name given → auto-generate from conversation topic

2. **Analyze the conversation**:
   - What was the core task?
   - What instructions produced good results?
   - What constraints or rules were important?

3. **Generalize**:
   - Replace specific file names, variable names, error messages with `$ARGUMENTS` or descriptive placeholders
   - Keep the essential structure and constraints
   - Remove conversation-specific back-and-forth

4. **Write the template** to the appropriate path:

```markdown
---
description: {max 15 words, what this prompt does}
argument-hint: {expected inputs}
tags: [{category tags}]
---

{Generalized prompt content, under 30 lines}

Target: $ARGUMENTS
```

5. **Report**: show the file path and how to invoke it

## Rules

- Under 30 lines of content (concise beats comprehensive)
- Use `$ARGUMENTS` for the primary input
- Include `tags` in frontmatter for Obsidian searchability
- Action-oriented naming: `fix-*`, `review-*`, `create-*`, `migrate-*`, `explain-*`
- Works across tools: plain markdown, no tool-specific syntax in the body

## Project-specific prompts

For `--project sdi-core`:
```bash
# Saved to ~/.config/prompts/projects/sdi-core/{name}.md
# To link into a project:
# ln -s ~/.config/prompts/projects/sdi-core .claude/commands/prompts
```
