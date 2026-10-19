---
id: "16"
category: en
reader: a reviewer who has not followed the discussion
task: Write the description of a pull request that adds the precedence table (200-350 words).
traps: [house, floor, lane]
must_keep: [pstack, AGENTS.md, guard]
---

## Facts

1. The pull request adds a table to rules/common/80-pstack.md with 8 rows.
2. In a task started with a pstack skill, the pstack playbook replaces the repository rule it meets, except on the rows of the table, where the repository rule wins.
3. The git, security and language rules always apply.
4. Each row quotes pstack's text; the quotes and their files are recorded in harness/plugins/pstack/precedence.json.
5. jig apply warns when an upgrade of pstack removes a quoted line; it does not stop the apply.
6. Rows that a machine can check, such as removing a worktree with --force, also become guard rules, which the owner writes.
7. No harness guarantees which of two conflicting rules of the same kind it follows.
