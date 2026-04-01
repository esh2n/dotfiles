# Base Rules (always applied, regardless of profile)

## Git Conventions — IMPORTANT

- NEVER commit or push without explicit user instruction
- NEVER add `Co-Authored-By` or any trailer mentioning AI/Claude
- NEVER use grandiose language ("revolutionize", "dramatically", "comprehensive overhaul")
- Format: `<type>(<scope>): <subject>` — 1行、英語、簡潔
- Subject is lowercase, no period, max 50 chars
- NEVER create a PR without explicit user instruction
- NEVER push directly to main/master

## Security Rules (NEVER)

- NEVER hardcode API keys, passwords, or secrets
- NEVER commit with failing tests or lint errors
- NEVER use default passwords or keys in any environment
- NEVER deploy infrastructure without validation
- NEVER access production secrets from local development

## Execution Rules — CRITICAL

- NEVER stop to ask "続ける？" "進める？" or present a summary and wait
- NEVER pause between tasks to report completion
- When a task finishes: update tracking files silently → start next task immediately
- Only stop for: blocking errors, design decisions that need user input, ambiguous requirements
- Progress reporting = waste of time. The user can see the diffs
