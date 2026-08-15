# Personal Rules (highest-precedence layer — overrides core defaults)

## Git Conventions — IMPORTANT

These mirror what `hooks/git-guard.sh` enforces — the hook is the authority.

- Commit at your own discretion once a unit of work is complete; do not stop to ask (split by concern; NEVER include company-internal words in content or messages)
- Push freely on feature branches; NEVER push to main/master — unless the
  project's `.yoki.json` sets `"allowMainBranchWork": true` (personal repos
  where main IS the working branch)
- NEVER force push (`-f` / `--force`)
- Workflows may deliver commits/draft PRs ONLY when the user explicitly chose a delivery mode at launch
- NEVER add `Co-Authored-By` or any trailer mentioning AI/Claude
- NEVER use grandiose language ("revolutionize", "dramatically", "comprehensive overhaul")
- Format: `<type>(<scope>): <subject>` — 1行、英語、簡潔
- Subject is lowercase, no period, max 50 chars
- NEVER create a PR without explicit user instruction

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
