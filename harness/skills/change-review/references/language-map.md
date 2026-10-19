# Language map

`code-reviewer` reads the review standard of each language the diff touches. A language with no row here has no standard yet: say so under missing context and review it with the general rules only.

| Files | Standard `code-reviewer` reads |
| --- | --- |
| `.go` | `golang-patterns/references/review-standard.md` (it links `go-modern`, `go-concurrency`, `go-performance`, `golang-testing` for detail) |
| `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` | `typescript-patterns/references/review-standard.md` |
| `.tsx`, `.jsx` | `typescript-patterns/references/review-standard.md` plus `react-patterns/references/review-standard.md` (it links `react-performance`, `react-testability`, `react-testing` for detail) |
| `.py` | `python-patterns/references/review-standard.md` (it links `python-testing`, plus `django-patterns` or `fastapi-patterns` when used) |
| `.rs` | `rust-patterns/references/review-standard.md` (it links `rust-testing` for detail) |
| `.java` | `java-coding-standards/references/review-standard.md` (it links `java-testing`, `springboot-patterns`, `springboot-tdd`, `springboot-verification` for detail) |
| `.kt`, `.kts` | `kotlin-patterns/references/review-standard.md` (it links `kotlin-coroutines-flows`, `kotlin-testing`, `compose-multiplatform-patterns`, `android-clean-architecture`, `kotlin-ktor-patterns`, `kotlin-exposed-patterns` for detail) |
| `.cc`, `.cpp`, `.hpp`, `.h` in a C++ project | `cpp-coding-standards/references/review-standard.md` (it links `cpp-testing` for detail) |
| `.c`, `.h` in a C project | `cpp-coding-standards/references/review-standard.md` for the parts that apply to C (memory, undefined behaviour, sanitizers); say which C++-only items were skipped |
| `.cs` | `csharp-patterns/references/review-standard.md` (it links `csharp-testing` for detail) |
| `.swift` | `swift-patterns/references/review-standard.md` (it links `swift-testing` for detail) |
| `.php` | `php-patterns/references/review-standard.md` (it links `php-testing`, plus `laravel-patterns`, `laravel-tdd`, `laravel-verification` when Laravel is used) |
| `.dart` | `flutter-patterns/references/review-standard.md` |
| `.sql`, migrations | `sql-tuning/references/review-standard.md` |
| `.css`, `.scss` | `css-modern/references/review-standard.md` (it links `css-cascade`, `css-flow`, `css-units`, `defensive-css` for detail) |
| `.html` (and template markup) | `semantic-html/references/review-standard.md` |
| `.pl`, `.pm`, `.t` (and `.psgi`, `.cgi`) | `perl-patterns/references/review-standard.md` (it links `perl-testing` for detail; shell, `eval STRING`, SQL and two-arg `open` findings also go to `security-reviewer`) |
| `.sh`, `.bash`, `.zsh` (and `.bats`) | `shell-patterns/references/review-standard.md` (shell injection findings also go to `security-reviewer`) |

Domain knowledge, by what the diff touches:

| When the diff touches | Read |
| --- | --- |
| API surfaces: HTTP/REST, gRPC/protobuf, GraphQL schemas, public library or SDK signatures, webhooks, CLI flags and machine-readable output | `api-design/references/review-checklist.md` (compatibility, versioning and deprecation items go to `rollout-reviewer`; silences in a design go to `spec-reviewer`) |
| network calls, timeouts, retries, queues sizing, health checks | `resilience-patterns/references/review-checklist.md` |
| events, topics, consumers, outbox, sagas | `event-driven-patterns/references/review-checklist.md` |
| writes to two stores or services that must agree, cross-service workflows, caches, read replicas, timestamps compared across hosts, leader election, distributed locks or leases, exactly-once or idempotency claims | `distributed-correctness/references/review-checklist.md` |
| metrics, logs, traces, alerts | `observability-patterns/references/review-checklist.md` |
| a new service, endpoint, job, consumer or scheduled task; a data migration or backfill; a feature flag or config rollout; secrets, backups, deletion or decommissioning; deployment, scaling or on-call behaviour | `ops-readiness/references/review-checklist.md` (read by `rollout-reviewer` and `workload-reviewer`) |
| aggregates, entities, bounded contexts | `ddd-modeling-review` |
| layer boundaries, ports and adapters | `clean-architecture` |
| `.github/workflows/*.yml`, `action.yml`, reusable workflows | `github-actions-patterns/references/review-checklist.md` (security items go to `security-reviewer`) |
| `*.tf`, `*.tofu`, `*.tfvars`, `.terraform.lock.hcl`, Terraform or OpenTofu modules, plan output | `terraform-patterns/references/review-checklist.md` (state, credentials, security misconfiguration and lock-file items go to `security-reviewer`; plan, refactoring and drift items to `rollout-reviewer`) |
| Kubernetes manifests | `k8s-patterns/references/review-checklist.md` (security-lane items go to `security-reviewer`, rollout items to `rollout-reviewer`) |
| GCP resources, IAM | `gcp-patterns/references/review-checklist.md` (IAM and Terraform items go to `security-reviewer`) |
| Cloudflare Workers | `cloudflare-patterns/references/review-checklist.md` (secrets and self-zone fetch items go to `security-reviewer`) |

A path under `skills/` means the skill in your harness's skills directory (`~/.claude/skills` in Claude Code, `~/.agents/skills` elsewhere).
