## Security

Never:
- Hardcode API keys, passwords, or secrets
- Commit with failing tests or lint errors
- Use default passwords or keys in any environment
- Deploy infrastructure without validation
- Access production secrets from local development
- Bypass the guard/permission system (no `--dangerously-skip-permissions` or equivalent) — the jig guard (policy/guard-rules.json) is the authority on what a tool call may do

Secret management:
- Use environment variables or a secret manager, never source code
- Validate that required secrets are present at startup
- Rotate any secret that may have been exposed

Before any commit: no hardcoded secrets, all user input validated, injection/XSS/CSRF handled where applicable, auth/authorization verified, error messages don't leak sensitive data.

Input validation: validate at every system boundary, use schema-based validation where available, fail fast with clear error messages, never trust external data (API responses, user input, file content).

If a security issue is found: stop immediately, fix CRITICAL issues before continuing, rotate any exposed secrets, review the codebase for similar issues.
