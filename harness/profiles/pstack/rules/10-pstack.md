## This configuration directory evaluates pstack

This session runs in the pstack evaluation profile. pstack (Lauren Tan's workflow pack, loaded as the Claude Code plugin `pstack` from a pinned checkout) is the way work is run here: `/pstack:poteto-mode` is the router, its playbooks are the procedure, and its principles are the standard. The usual house rules about how work is run (TDD, mandatory reviewer agents, grilling, delegation) are deliberately absent from this file so that pstack can be judged as its author designed it. Do not import them from memory.

What still binds, because it is about safety and conventions, not method:

- The git conventions, the security rules and the language overrides above.
- Never remove a worktree that has uncommitted, untracked or ignored files, and never `rm -rf` a worktree path: hold it and name the files instead. pstack's `worktree-cleanup` playbook treats untracked files as disposable; this house does not (cursor/plugins#449).
- Never run `curl ... | sudo sh` or any installer under `sudo`. pstack's `make-bot-ui` skill contains one; skip that step and say so.
- Never merge a pull request (`gh pr merge`, auto-merge, a merge queue) and never force-push, even with `--force-with-lease`. Where a playbook says to land or merge, stop at merge-ready and hand the merge to the owner.
- `/setup-pstack` has nothing to write in Claude Code: say so and stop. Roles that name a non-Claude model run on the session model; say so when it matters (for example, `interrogate` and `arena` lose their second model family here).

Read the plugin's own adapter once per session before following a skill that uses Cursor names: `docs/harness/claude-code.md` inside the plugin directory maps `Task` to `Agent`, `AskQuestion` to `AskUserQuestion`, and Cursor-only steps to "skip and say so".

Evaluation record: when a `/pstack:poteto-mode` run ends, append one line to `~/.claude-pstack/evaluation.tsv` with the date, the playbook chosen, whether the steps were followed in order, whether the verification step ran against the real artifact, and one sentence on what the pack did better or worse than working without it. The owner reads this file to decide whether the evaluation continues.
