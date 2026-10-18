# plugins/

External skill packs used as they are, without copying them into this
repository. One directory per pack, `plugins/<name>/source.json`:

- `repo`: the GitHub repository (GitHub only).
- `ref`: the branch followed on every `make up`. `commit` (optional) pins the
  pack to one commit instead; use it when the latest breaks something.
- `skills`, `agents` (optional): the pack's skill directories and agent
  files, relative to the checkout.
- `adapter` (optional), `translated`: the pack's own tool-name table and the
  names of it the house's translation covers. `jig apply` warns when the
  table gains a name `translated` does not list.

`dotctl setup plugins` (a setup step, so `make up` runs it) fetches each pack
into `~/.local/share/jig/plugins/<name>` (`$XDG_DATA_HOME/jig/plugins/<name>`
when set), prints which skills changed, and records the commit in
`~/.local/state/jig/plugins.jsonl`. `jig apply` then links the pack's skills
into `~/.claude/skills` and `~/.agents/skills` and its agents into
`~/.claude/agents` and omp's agents directory, beside the house's own. A
house skill or agent of the same name wins and the pack's is reported.

A pack is third-party content that changes without review, so two things
are refused by machine: `dotctl setup plugins` will not check out a commit
with a symlink in or on the way to `skills` or `agents` (it keeps the
previous version), and `jig apply` links no pack entry that is a symlink or
whose frontmatter declares `hooks` or `mcpServers`. Nothing runs the pack's
scripts. When upstream misbehaves, set `commit` to the last good one; the
commits fetched are in `~/.local/state/jig/plugins.jsonl`.

Current packs:

- `pstack/` — Lauren Tan's workflow pack from cursor/plugins
  (`../rules/decisions/2026-10-18-pstack-shared-skills.md`). Its skills are
  written with Cursor's tool names; `../skills/pstack-adapter` maps them to
  each harness.
