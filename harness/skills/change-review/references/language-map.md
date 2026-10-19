# Language map (interim)

Until a language's skill carries `references/review-standard.md`, `code-reviewer` reads the skills below for that language, and the review also spawns the language's own reviewer agent where one exists. When the standard file lands, the standard replaces both columns for that language and the agent is no longer spawned.

| Files | Skills `code-reviewer` reads | Agent spawned beside it (interim) |
| --- | --- | --- |
| `.go` | `golang-patterns`, `go-modern`, `go-concurrency`, `go-performance` | `go-reviewer` |
| `.ts`, `.js`, `.mjs`, `.cjs` | `typescript-patterns`, `ts-modern` | `typescript-reviewer` |
| `.tsx`, `.jsx` | the TypeScript row, plus `react-patterns`, `react-performance`, `react-testability` | `react-reviewer` |
| `.py` | `python-patterns` (plus `django-patterns` or `fastapi-patterns` when used) | `python-reviewer` |
| `.rs` | `rust-patterns` | `rust-reviewer` |
| `.java` | `java-coding-standards` (plus `springboot-patterns` when used) | `java-reviewer` |
| `.kt`, `.kts` | `kotlin-patterns`, `kotlin-coroutines-flows` | `kotlin-reviewer` |
| `.c`, `.cc`, `.cpp`, `.h`, `.hpp` | `cpp-coding-standards` | `cpp-reviewer` |
| `.cs` | `csharp-patterns` | — |
| `.swift` | `swift-patterns` | — |
| `.php` | `php-patterns` (plus `laravel-patterns` when used) | — |
| `.dart` | — | `flutter-reviewer` |
| `.sql`, migrations | `sql-tuning` | `database-reviewer` |
| `.css`, `.scss`, `.html` | `css-cascade`, `css-flow`, `css-modern`, `css-units`, `defensive-css` | `web-platform-reviewer` |
| `.sh`, `.zsh`, `.bash` | — | — |

Domain knowledge, by what the diff touches:

| When the diff touches | Read |
| --- | --- |
| network calls, timeouts, retries, queues sizing, health checks | `resilience-patterns/references/review-checklist.md` |
| events, topics, consumers, outbox, sagas | `event-driven-patterns/references/review-checklist.md` |
| metrics, logs, traces, alerts | `observability-patterns/references/review-checklist.md` |
| aggregates, entities, bounded contexts | `ddd-modeling-review` |
| layer boundaries, ports and adapters | `clean-architecture` |
| Kubernetes manifests | `k8s-patterns` |
| GCP resources, IAM | `gcp-patterns` |
| Cloudflare Workers | `cloudflare-patterns` |

A path under `skills/` means the skill in your harness's skills directory (`~/.claude/skills` in Claude Code, `~/.agents/skills` elsewhere).
