---
name: python-testing
description: Use when writing or reviewing Python tests — pytest marker/conftest conventions, anyio-based async testing (not pytest-asyncio), mocking discipline, parametrization idioms, and coverage invocation for this repo.
metadata:
  origin: ECC
---

# Python Testing Patterns

pytest conventions and non-obvious testing decisions for Python code in this repo. For the TDD red/green/refactor process itself, see the **tdd-workflow** skill — this file assumes that cycle and covers only pytest-specific mechanics.

## Coverage

- Target 80%+ overall; critical paths (auth, payments, data mutation) require 100%.
- Invoke coverage explicitly, don't rely on defaults:

```bash
pytest --cov=mypackage --cov-report=term-missing --cov-report=html
pytest --cov=mypackage --cov-report=term-missing --cov-fail-under=80
```

## Async Testing — use anyio, not pytest-asyncio

**This repo's rule: `anyio` for async testing, never `asyncio`/`pytest-asyncio`.** A model defaulting to `@pytest.mark.asyncio` is wrong here — use `anyio_backend` + `pytest.mark.anyio` so tests run across backends without a plugin-specific marker per test file.

```python
# conftest.py
import pytest

@pytest.fixture
def anyio_backend():
    return "asyncio"  # pin backend; omit params to also run under trio if supported

# test_foo.py
import pytest

pytestmark = pytest.mark.anyio  # apply once per module, not per test

async def test_async_function():
    result = await async_add(2, 3)
    assert result == 5

async def test_async_mock(mocker):
    mock_call = mocker.patch("mypackage.async_api_call", new_callable=mocker.AsyncMock)
    mock_call.return_value = {"status": "ok"}
    result = await my_async_function()
    mock_call.assert_awaited_once()
```

Async fixtures are plain `async def` generator fixtures — no special decorator needed under anyio, unlike `pytest-asyncio`'s `@pytest_asyncio.fixture`.

## Markers and Test Selection

Declare every custom marker in `pytest.ini`/`pyproject.toml` with `--strict-markers` so typos fail loudly instead of silently no-op'ing:

```toml
[tool.pytest.ini_options]
addopts = ["--strict-markers"]
markers = [
    "slow: marks tests as slow",
    "integration: marks tests as integration tests",
]
```

```bash
pytest -m "not slow"              # skip slow tests
pytest -m "integration or slow"
pytest -k "test_user"             # name-pattern select
pytest --lf                       # rerun last failures only
```

## conftest.py Conventions

- Put cross-file fixtures in `tests/conftest.py`; keep test-local fixtures in the test file itself — don't centralize prematurely.
- `autouse=True` fixtures are for genuinely global setup (e.g. resetting a singleton config). Overuse hides dependencies — if a test's behavior depends on a fixture, prefer requesting it explicitly over relying on autouse magic.
- Prefer function-scoped fixtures by default; widen scope (`module`/`session`) only for expensive, side-effect-free resources, and be explicit that wider scope means shared mutable state across tests unless the fixture yields a fresh object.

## Mocking Discipline

**Mock at the boundary, not the internals.** Mock what crosses a process/network/filesystem boundary (external APIs, DB clients, clock, filesystem); don't mock your own pure functions or internal collaborators — that tests the mock, not the code.

- Use `autospec=True` (or `create_autospec`) on `@patch` targets so a renamed/removed real method fails the test instead of silently matching `Mock()`'s catch-all interface.
- Assert on call behavior (`assert_called_once_with`, `assert_awaited_once`) — a mock with no assertion on args is not a test, it's a stub.
- Avoid over-specifying call args when the exact args aren't the thing under test — brittle mocks break on unrelated refactors.

```python
@patch("mypackage.DBConnection", autospec=True)
def test_query_calls_db(db_mock):
    db = db_mock.return_value
    db.query("SELECT * FROM users")
    db_mock.assert_called_once()
```

## Parametrization Beyond the Basics

- Always pass `ids=` when the values aren't self-descriptive in test output — bare tuples produce unreadable `test_foo[0]` names.
- Stack multiple `@pytest.mark.parametrize` decorators to get the cartesian product instead of hand-writing every combination.
- For fixtures that must vary per test (e.g. multiple DB backends), use `@pytest.fixture(params=[...])` — the fixture, not the test function, owns the variation, so every test using it runs across all params automatically.

```python
@pytest.mark.parametrize("input,expected", [
    ("valid@email.com", True),
    ("invalid", False),
], ids=["valid-email", "missing-at"])
def test_email_validation(input, expected):
    assert is_valid_email(input) is expected
```

## Anti-Patterns

| Don't | Why |
|---|---|
| Mock internal/pure functions | Tests the mock, not the code |
| `@patch` without `autospec=True` | Silently survives API drift |
| Share mutable state between tests (wide-scope fixtures with mutation) | Order-dependent flaky failures |
| Catch exceptions in tests instead of `pytest.raises` | Swallows the actual failure signal |
| Over-specific mock assertions on irrelevant args | Brittle on unrelated refactors |
| `pytest-asyncio` markers in this repo | Violates the anyio-only rule |
| Fixture with no `--strict-markers` guard on custom markers | Typo'd marker silently does nothing |

**Remember**: tests are code too — keep them as reviewable and maintainable as production code.
