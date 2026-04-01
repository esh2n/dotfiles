---
description: Generate conventional commit message in English (1 line, precise, actor is me)
---

Analyze staged changes and output ONLY a one-line conventional commit message.

CRITICAL RULES:
- Output format: EXACTLY one line with pattern "type(scope): subject"
- NO explanations, NO questions, NO additional text
- If no staged changes: output "error: no staged changes"
- Use imperative mood (add/fix/update, NOT added/fixed/updated)
- Actor is me (the developer)
- Be precise and specific

Types: feat, fix, docs, style, refactor, perf, test, chore

Process silently:
1. Run `git diff --cached` to analyze changes
2. Determine type and scope
3. Output ONLY the commit message

Examples:
feat(auth): add JWT token refresh mechanism
fix(api): handle null response in user endpoint
chore(deps): upgrade React to v18.2.0
