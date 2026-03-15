# Global Claude Code Configuration

## Language Overrides (defaults differ)

- Python: ONLY use `uv`, NEVER `pip`. Use `anyio` for async testing, not `asyncio`
- TypeScript: prefer `pnpm` > `npm` > `yarn`. `strict: true` always. No `any` in production
- Go: NEVER ignore error returns
- Bash: always `set -euo pipefail`
- All: strict types required, comprehensive docs for public APIs

## Spec-Driven Development (SDD)

Tasks and specs are stored outside the repository for worktree-wide access:

```
~/.config/work/{org}/{repo}/
├── tasks/                     # All work units
│   ├── _index.md              # Status overview
│   └── {NNN}-{slug}/          # Individual task
│       ├── meta.md            # branch, worktree, status
│       ├── notes.md           # Exploratory notes (always present)
│       └── spec/              # SDD artifacts (only when needed)
│           ├── requirements.md, research.md, design.md
│           ├── contracts/, tasks.md, checklist.md
├── decisions/                 # ADRs (cross-cutting)
└── docs/                      # Persistent documentation
```

Templates: `~/.config/work/_templates/`

Use `/sdd` skill for the full workflow: `init → clarify → research → design → tasks → implement → validate`

Key rules:
- task is the top-level unit; spec is optional (bugfixes need only notes.md)
- design and tasks require user approval before proceeding
- notes.md ≠ SDD spec (notes are exploratory; spec is structured)

## Git Conventions

### Worktree
- Naming: `../project-<type>-<description>` (types: feature, bugfix, hotfix, experiment, refactor)
- Use `using-git-worktrees` skill for setup

### Commits — IMPORTANT
- NEVER commit or push without explicit user instruction
- Format: `<type>(<scope>): <subject>` — 1行、英語、簡潔
- NEVER add `Co-Authored-By` or any trailer mentioning AI/Claude
- NEVER use grandiose language ("revolutionize", "dramatically", "comprehensive overhaul")
- Subject is lowercase, no period, max 50 chars
- Use trailers only when user specifies: `Github-Issue: #123`
- Use `/gitmsg` skill or `/commit` for proper formatting

### PRs
- NEVER create a PR without explicit user instruction
- Focus on high-level problem and solution
- Never mention tools used (no co-authored-by)
- Include performance impact if relevant

## Infrastructure

- Azure-first with GCP support. All infra as code (Terraform/Bicep)
- NEVER run `terraform destroy` without explicit approval
- Always validate with `terraform plan` before apply
- Remote state with locking (Azure Storage Account)
- Never hardcode secrets — use Key Vault / Secret Manager

## Security Rules (NEVER)

- NEVER hardcode API keys, passwords, or secrets
- NEVER commit with failing tests or lint errors
- NEVER push directly to main/master
- NEVER use default passwords or keys in any environment
- NEVER deploy infrastructure without validation
- NEVER access production secrets from local development

## Quality Rules (YOU MUST)

- Write tests for new features and bug fixes
- Use feature branches for all development
- Follow semantic versioning for releases
- Document breaking changes
- Use managed identities over service principals when possible
- Encrypt data at rest and in transit
