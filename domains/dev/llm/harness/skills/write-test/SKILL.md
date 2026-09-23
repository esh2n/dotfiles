---
name: write-test
description: Write tests for existing code using TDD principles
disable-model-invocation: true
argument-hint: [file-or-function]
---
Write tests for $ARGUMENTS.

Rules:
- Test behavior, not implementation
- One assertion per test (or closely related group)
- Clear test names describing the scenario
- Cover: happy path, edge cases, error cases
- Use real objects, avoid mocks unless absolutely necessary
- Follow project's existing test patterns and framework
