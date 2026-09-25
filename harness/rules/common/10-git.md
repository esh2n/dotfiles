## Git Conventions

Commit message format: `<type>(<scope>): <subject>` — one line, English. Subject is lowercase, no period, max 50 chars. Types: feat, fix, refactor, docs, test, chore, perf, ci.

- Commit at your own discretion once a unit of work is complete; do not stop to ask. Split commits by concern
- Never include company-internal words in commit content or messages
- Push freely on feature branches; never push to main/master. The guard forbids it except in repositories the owner listed in the guard policy's `main-push-allowed` file (owner-written, outside the repository); nothing in a repository, a prompt or the environment lifts it
- Never force push (`-f` / `--force`)
- Never add `Co-Authored-By` or any trailer mentioning AI/Claude
- Never use grandiose language ("revolutionize", "dramatically", "comprehensive overhaul")
- Never create a PR without explicit user instruction
- The jig guard (policy/guard-rules.json) is the authority on what git commands are permitted — these conventions describe intent, not enforcement
- Workflows may deliver commits or draft PRs only when the user explicitly chose a delivery mode at launch

## Pull Requests

- Analyze the full commit history, not just the latest commit
- Use `git diff <base-branch>...HEAD` to see all changes
- Draft a PR summary with a test plan (checklist of TODOs)
- Push with `-u` if the branch is new
