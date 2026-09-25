---
name: php-patterns
description: Use when writing or reviewing PHP code — PSR-12 formatting, strict types, immutable DTOs and value objects, PHP-CS-Fixer/PHPStan, thin controllers with explicit services, dependency injection, ORM/SDK boundaries, and input validation/SQL/secret/auth security.
metadata:
  namespaces: [lang/php]
  origin: rules/php (folded 2026-09-23)
---

# PHP Patterns

## Coding style

### Standards

- Follow **PSR-12** formatting and naming conventions.
- Prefer `declare(strict_types=1);` in application code.
- Use scalar type hints, return types, and typed properties everywhere new code permits.

### Immutability

- Prefer immutable DTOs and value objects for data crossing service boundaries.
- Use `readonly` properties or immutable constructors for request/response payloads where possible.
- Keep arrays for simple maps; promote business-critical structures into explicit classes.

### Formatting

- Use **PHP-CS-Fixer** or **Laravel Pint** for formatting.
- Use **PHPStan** or **Psalm** for static analysis.
- Keep Composer scripts checked in so the same commands run locally and in CI.

### Imports

- Add `use` statements for all referenced classes, interfaces, and traits.
- Avoid relying on the global namespace unless the project explicitly prefers fully qualified names.

### Error Handling

- Throw exceptions for exceptional states; avoid returning `false`/`null` as hidden error channels in new code.
- Convert framework/request input into validated DTOs before it reaches domain logic.

### Reference

See skill: `backend-patterns` for broader service/repository layering guidance.

## Patterns

### Thin Controllers, Explicit Services

- Keep controllers focused on transport: auth, validation, serialization, status codes.
- Move business rules into application/domain services that are easy to test without HTTP bootstrapping.

### DTOs and Value Objects

- Replace shape-heavy associative arrays with DTOs for requests, commands, and external API payloads.
- Use value objects for money, identifiers, date ranges, and other constrained concepts.

### Dependency Injection

- Depend on interfaces or narrow service contracts, not framework globals.
- Pass collaborators through constructors so services are testable without service-locator lookups.

### Boundaries

- Isolate ORM models from domain decisions when the model layer is doing more than persistence.
- Wrap third-party SDKs behind small adapters so the rest of the codebase depends on your contract, not theirs.

### Reference

See skill: `api-design` for endpoint conventions and response-shape guidance.
See skill: `laravel-patterns` for Laravel-specific architecture guidance.

## Security

### Input and Output

- Validate request input at the framework boundary (`FormRequest`, Symfony Validator, or explicit DTO validation).
- Escape output in templates by default; treat raw HTML rendering as an exception that must be justified.
- Never trust query params, cookies, headers, or uploaded file metadata without validation.

### Database Safety

- Use prepared statements (`PDO`, Doctrine, Eloquent query builder) for all dynamic queries.
- Avoid string-building SQL in controllers/views.
- Scope ORM mass-assignment carefully and whitelist writable fields.

### Secrets and Dependencies

- Load secrets from environment variables or a secret manager, never from committed config files.
- Run `composer audit` in CI and review new package maintainer trust before adding dependencies.
- Pin major versions deliberately and remove abandoned packages quickly.

### Auth and Session Safety

- Use `password_hash()` / `password_verify()` for password storage.
- Regenerate session identifiers after authentication and privilege changes.
- Enforce CSRF protection on state-changing web requests.

### Reference

See skill: `laravel-security` for Laravel-specific security guidance.
