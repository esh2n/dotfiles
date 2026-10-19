## Git Conventions

Commit message format: `<type>(<scope>): <subject>` — one line, English. Subject is lowercase, no period, max 50 chars. Types: feat, fix, refactor, docs, test, chore, perf, ci.

- Commit at your own discretion once a unit of work is complete; do not stop to ask. Split commits by concern
- Never include company-internal words in commit content or messages
- Personal repositories are those under a path prefix in `~/.config/jig/policy/main-push-allowed`; when that file is missing or unreadable, no repository is personal
- Push freely on feature branches; never push to main/master outside a personal repository (the guard enforces this). In a personal repository, working on main is allowed
- Never force push (`-f` / `--force`)
- Never add `Co-Authored-By` or any trailer mentioning AI/Claude
- Never use grandiose language ("revolutionize", "dramatically", "comprehensive overhaul")
- Creating a PR needs no instruction. Outside a personal repository, open it as a draft (a draft means "do not review yet") and mark it ready with `gh pr ready` once your own review of the full diff is done. In a personal repository, open it ready
- The jig guard (policy/guard-rules.json) is the authority on what git commands are permitted — these conventions describe intent, not enforcement
- A workflow or unattended run follows the same PR rule; when its launch names a delivery mode (commits only, a draft PR), deliver no more than that

## Pull Requests

- Analyze the full commit history, not just the latest commit
- Use `git diff <base-branch>...HEAD` to see all changes
- Draft a PR summary with a test plan (checklist of TODOs)
- Push with `-u` if the branch is new
