## Quality

- Write tests for new features and bug fixes
- Use feature branches for all development
- Follow semantic versioning for releases
- Document breaking changes

## Testing

- Minimum test coverage: 80%
- All three test types are required: unit (functions, utilities, components), integration (API endpoints, database operations), E2E (critical user flows, framework chosen per language)
- TDD: write tests first (RED), implement to pass (GREEN), refactor (IMPROVE), verify 80%+ coverage — see the tdd-workflow skill
- Troubleshooting a failure: check test isolation, verify mocks are correct, fix the implementation rather than the test unless the test itself is wrong

## Coding Style

- Prefer immutable updates: return a new copy rather than mutating in place — prevents hidden side effects and enables safe concurrency
- Many small files over few large ones: 200-400 lines typical, 800 max; organize by feature/domain, not by type
- Handle errors explicitly at every level; user-friendly messages in UI-facing code, detailed context in server-side logs; never silently swallow an error
- Validate all input at system boundaries; never trust external data
- Before marking work complete: readable and well-named code, functions under ~50 lines, files under ~800 lines, no nesting deeper than 4 levels, proper error handling, no hardcoded values, no unnecessary mutation

## Patterns

- Repository pattern: encapsulate data access behind one interface (findAll/findById/create/update/delete); business logic depends on the abstraction, never the storage mechanism directly
- API responses: use one consistent envelope — a success/status indicator, a nullable data payload, a nullable error message, and pagination metadata (total/page/limit) where applicable
