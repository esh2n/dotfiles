## pstack

pstack (poteto-mode, its playbooks, the principle-* skills and the rest) is an external skill pack linked beside the house skills. It is written with Cursor's tool names: load the `pstack-adapter` skill once per session before following a pstack skill; its Overrides section explains each row below.

A task the user starts with a pstack skill follows that skill's playbook in place of the house rules it meets; every other task follows the house rules. The git, security and language rules still bind inside a pstack task, and never run an installer under `sudo` or piped from `curl`. Where pstack's text matches a row of this table, the row wins:

| pstack says | Do instead |
|---|---|
| "Open every PR ready, never as a draft." (`poteto-mode/playbooks/opening-a-pr.md`) | Outside the personal repositories (Git Conventions), open a draft and mark it ready after your own review. |
| "external actions (team chat, ticket updates, …) proceed without asking" (`poteto-mode/SKILL.md`) | Use MCP tools freely, but ask the owner before any write other people see: chat posts, tickets, Notion pages, shared docs. |
| "explicit model per role (configurable via `/setup-pstack`" (`poteto-mode/SKILL.md`) | Map models per `pstack-adapter`'s Models section; never pass a pstack slug. |
| "Proceed, then present." (`principle-never-block-on-the-human`) | Also stop before contradicting or superseding an accepted decision note or house rule; only the owner rules on those. |
| "Per path, `git worktree remove --force <path>`." (`poteto-mode/playbooks/worktree-cleanup.md`) | Worktrees live at `.claude/worktrees/<name>`. Remove only merged ones with no uncommitted, untracked or ignored files, without `--force`; never `rm -rf` one. |
| "landing the contiguous verified run" (`poteto-mode/SKILL.md`, Shipping) | Never merge or force-push; stop at merge-ready and hand it to the owner. |
| `deslop`, `control-cli`, `control-ui`, `create-skill` (`poteto-mode/SKILL.md`) | Not installed; use the substitutes in `pstack-adapter`'s Overrides. |
| "the parent does it directly" (`reflect`), `.cursor/skills/<handle>-mode/` (`automate-me`) | Never edit the pack: updates reset it. Put the change in a house skill or rule (`pstack-adapter`). |
