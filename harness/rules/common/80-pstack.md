## pstack

pstack is an external skill pack (poteto-mode, its playbooks, the principle-* skills and the rest) linked beside the house skills. Its skills are written with Cursor's tool names: load the `pstack-adapter` skill once per session before following one.

- Only a task the user started with a pstack skill follows pstack's method; for that task its playbook leads, in place of the house rules on TDD, mandatory reviewer agents, grilling and delegation. Every other task follows the house rules as usual.
- What binds even then: the git, security and language rules; never remove a worktree that has uncommitted, untracked or ignored files, and never `rm -rf` a worktree path (pstack's worktree-cleanup treats untracked files as disposable); never run an installer under `sudo` or piped from `curl`; never merge a pull request or force-push. Where a playbook says to land or merge, stop at merge-ready and hand it to the user.
