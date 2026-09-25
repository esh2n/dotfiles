---
name: refactor
description: Refactor code for readability and testability
disable-model-invocation: true
argument-hint: [file-or-description]
---
Refactor the following code. Priorities:

1. Readability — clear naming, small functions
2. Testability — controllable via arguments/props, no hidden state
3. Single responsibility — one reason to change per unit
4. Remove dead code and unnecessary abstractions

Target: $ARGUMENTS
