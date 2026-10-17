# profiles/

A profile is a second configuration directory for one harness, with its own
rule set. The default (no profile) is what `jig apply` always delivered: every
`rules/common/*.md` and every accepted decision's `rule:` line, into
`~/.claude/AGENTS.md` and its siblings. A profile exists only when a
configuration directory must *not* carry some of those rules.

One directory per profile, `profiles/<name>/`:

- `rules.json` — which `rules/common/` files render and whether the decision
  lines render (`../jig/src/domain/claude/rules-profile.ts`).
- `rules/*.md` — rules that exist only in this profile, rendered after the
  selected common rules, in file-name order. English, like everything the
  model reads (`../rules/decisions/2026-09-23-model-facing-english.md`).
- anything else the profile's own setup command needs (`pstack/upstream.json`
  pins the plugin the pstack profile loads).

`jig apply` renders under a profile when `JIG_PROFILE=<name>` is set, and the
destination follows the harness's own variable (`CLAUDE_CONFIG_DIR` for
Claude Code). `dotctl pstack setup` is the one caller today.

Profiles select rules by file name; they never edit a rule's text. A rule
that should read differently in one profile is a profile-only rule in that
profile's `rules/`, not a fork of the common file.

Current profiles:

- `pstack/` — the pstack evaluation
  (`../rules/decisions/2026-10-17-pstack-evaluation-profile.md`).
