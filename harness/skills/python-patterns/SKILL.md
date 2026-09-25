---
name: python-patterns
description: Use when writing or reviewing Python code — PEP 8 and type-annotation standards, immutable data structures (frozen dataclasses, NamedTuple), black/isort/ruff formatting, Protocol-based duck typing, dataclasses as DTOs, context managers and generators, secret management, and security scanning with bandit.
metadata:
  namespaces: [lang/python]
  origin: rules/python (folded 2026-09-23)
---

# Python Patterns

## Coding style

### Standards

- Follow **PEP 8** conventions
- Use **type annotations** on all function signatures

### Immutability

Prefer immutable data structures:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str

from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
```

### Formatting

- **black** for code formatting
- **isort** for import sorting
- **ruff** for linting

## Patterns

### Protocol (Duck Typing)

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> dict | None: ...
    def save(self, entity: dict) -> dict: ...
```

### Dataclasses as DTOs

```python
from dataclasses import dataclass

@dataclass
class CreateUserRequest:
    name: str
    email: str
    age: int | None = None
```

### Context Managers & Generators

- Use context managers (`with` statement) for resource management
- Use generators for lazy evaluation and memory-efficient iteration

## Security

### Secret Management

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Raises KeyError if missing
```

### Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```

### Reference

See skill: `django-security` for Django-specific security guidelines (if applicable).
