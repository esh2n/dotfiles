## pstack

pstack (poteto-mode, its playbooks, the principle-* skills and the rest) is an external skill pack linked beside the house skills. It is written with Cursor's tool names: load the `pstack-adapter` skill once per session before following a pstack skill.

A task the user starts with a pstack skill follows that skill's playbook in place of the house rules on TDD, reviewer agents, grilling and delegation. Every other task follows the house rules. These still bind inside a pstack task:

- the git, security and language rules
- never remove a worktree that has uncommitted, untracked or ignored files, and never `rm -rf` a worktree path
- never run an installer under `sudo` or piped from `curl`
- never merge a pull request or force-push; where a playbook says to land, stop at merge-ready and hand it to the user
