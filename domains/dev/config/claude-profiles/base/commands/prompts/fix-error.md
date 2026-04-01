---
description: Diagnose and fix an error systematically
argument-hint: [error-message-or-description]
tags: [debug, fix]
---

Fix this error: $ARGUMENTS

Follow systematic debugging:
1. Read the error message completely
2. Trace the data flow to find the root cause
3. Form a hypothesis: "I think X because Y"
4. Write a failing test that reproduces the issue
5. Implement the minimal fix
6. Verify the test passes and no other tests break
