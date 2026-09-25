---
name: prompt-save
description: "Save the current conversation pattern as a reusable prompt: a user-invoked skill under the harness skills/ tree (or the project's .claude/skills/), invoked as /<name>. Use after a good conversation to capture the pattern for reuse."
disable-model-invocation: true
argument-hint: "[name] [--project]"
metadata:
  namespaces: [agent]
---

# Save Prompt

Capture the current conversation pattern as a reusable prompt. A saved prompt
is a skill with `disable-model-invocation: true`: the user runs it as `/<name>`,
the model never triggers it on its own (ruling: `rules/decisions/2026-09-22-commands-are-skills.md`).

## Storage

```
$DOTFILES_ROOT/harness/skills/<name>/SKILL.md   # global → /<name> everywhere
<repo>/.claude/skills/<name>/SKILL.md                            # project-local → /<name> in that repo
```

No symlinks and no `commands/` directory: the harness generator delivers
`skills/` to every harness as-is, so the file above is the only thing to write.

## Process

1. **Parse arguments**:
   - `$ARGUMENTS` = `name` (kebab-case, action-oriented: fix-*, review-*, create-*, migrate-*)
   - `--project` flag → save to `<repo>/.claude/skills/<name>/SKILL.md` instead of the harness tree
   - No name given → auto-generate from conversation topic

2. **Analyze the conversation**:
   - What was the core task?
   - What instructions produced good results?
   - What constraints or rules were important?

3. **Generalize**:
   - Replace specific file names, variable names, error messages with `$ARGUMENTS` or descriptive placeholders
   - Keep the essential structure and constraints
   - Remove conversation-specific back-and-forth

4. **Write the skill** to the appropriate path:

```markdown
---
name: {name}
description: {max 15 words, what this prompt does}
disable-model-invocation: true
argument-hint: {expected inputs — omit when the prompt takes no arguments}
---

{Generalized prompt content, under 30 lines}

Target: $ARGUMENTS
```

5. **Report**: show the file path and how to invoke it (`/<name> <args>`)

## Rules

- Under 30 lines of content (concise beats comprehensive)
- Use `$ARGUMENTS` for the primary input (`$0`, `$1` for positional pieces)
- Always `disable-model-invocation: true` — a saved prompt is user-invoked only
- Add `argument-hint` only when the prompt takes arguments
- Action-oriented naming: `fix-*`, `review-*`, `create-*`, `migrate-*`, `explain-*`
- Plain markdown, no harness-specific syntax in the body — the same file goes to Claude Code, Codex, omp and pi (`/skill:<name>`)

## Project-specific prompts

For `--project` inside `my-service`:
```bash
# Saved to <repo>/.claude/skills/{name}/SKILL.md
# Commit it with the repo; it is available as /{name} in that checkout only
```
