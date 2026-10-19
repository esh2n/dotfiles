# Language map (interim)

Until a language's skill carries `references/review-standard.md`, `code-reviewer` reads the skills below for that language, and the review also spawns the language's own reviewer agent where one exists. When the standard file lands, the standard replaces both columns for that language and the agent is no longer spawned.

| Files | Skills `code-reviewer` reads | Agent spawned beside it (interim) |
| --- | --- | --- |
| `.go` | `golang-patterns/references/review-standard.md` (it links `go-modern`, `go-concurrency`, `go-performance`, `golang-testing` for detail) | — |
| `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` | `typescript-patterns/references/review-standard.md` | — |
| `.tsx`, `.jsx` | `typescript-patterns/references/review-standard.md` plus `react-patterns/references/review-standard.md` (it links `react-performance`, `react-testability`, `react-testing` for detail) | — |
| `.py` | `python-patterns/references/review-standard.md` (it links `python-testing`, plus `django-patterns` or `fastapi-patterns` when used) | — |
| `.rs` | `rust-patterns/references/review-standard.md` (it links `rust-testing` for detail) | — |
| `.java` | `java-coding-standards/references/review-standard.md` (it links `java-testing`, `springboot-patterns`, `springboot-tdd`, `springboot-verification` for detail) | — |
| `.kt`, `.kts` | `kotlin-patterns/references/review-standard.md` (it links `kotlin-coroutines-flows`, `kotlin-testing`, `compose-multiplatform-patterns`, `android-clean-architecture`, `kotlin-ktor-patterns`, `kotlin-exposed-patterns` for detail) | — |
| `.cc`, `.cpp`, `.hpp`, `.h` in a C++ project | `cpp-coding-standards/references/review-standard.md` (it links `cpp-testing` for detail) | — |
| `.c`, `.h` in a C project | `cpp-coding-standards/references/review-standard.md` for the parts that apply to C (memory, undefined behaviour, sanitizers); say which C++-only items were skipped | — |
| `.cs` | `csharp-patterns/references/review-standard.md` (it links `csharp-testing` for detail) | — |
| `.swift` | `swift-patterns/references/review-standard.md` (it links `swift-testing` for detail) | — |
| `.php` | `php-patterns/references/review-standard.md` (it links `php-testing`, plus `laravel-patterns`, `laravel-tdd`, `laravel-verification` when Laravel is used) | — |
| `.dart` | `flutter-patterns/references/review-standard.md` | — |
| `.sql`, migrations | `sql-tuning/references/review-standard.md` | — |
| `.css`, `.scss` | `css-modern/references/review-standard.md` (it links `css-cascade`, `css-flow`, `css-units`, `defensive-css` for detail) | — |
| `.html` (and template markup) | `semantic-html/references/review-standard.md` | — |
| `.sh`, `.bash`, `.zsh` (and `.bats`) | `shell-patterns/references/review-standard.md` (shell injection findings also go to `security-reviewer`) | — |

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
