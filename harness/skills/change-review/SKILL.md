---
name: change-review
description: Use when reviewing a change — a diff, a branch, a pull request, or your own work before you hand it over or open a PR — in any harness, from a quick daily check to a heavy review of a large or risky change. Also covers a design or spec before code exists, and a whole-codebase security audit when asked. Symptoms include "レビューして", "review this", "PR を見て", "これで大丈夫？", finishing an implementation, or readying a PR. The review reports findings; it never posts to GitHub, and fixes only verified blocker and major findings in your own work in progress.
metadata:
  namespaces: [practice]
---

# Review

One procedure for every review. Depth changes with the change; the steps do not. Reviewers are agents (`code-reviewer`, `security-reviewer`, `workload-reviewer`, `ui-reviewer`, `test-reviewer`, `review-verifier`); this skill decides which run, what they read, and where the result goes. The judgment rules behind a review (grounding, anchoring, refutation, merging) are in the `code-review-discipline` skill, section 12.

Inside a pstack task, pstack's own review steps (`interrogate`, `no-comments`, `shipping`) stay; the `pstack-adapter` skill's Review section says how house reviewers feed them.

## 1. Scope and classify

Get the change: `base=$(git merge-base origin/main HEAD)`, then `git diff $base` (committed and uncommitted together). For a PR, `gh pr diff <n>` and `gh pr view <n>`. Save the diff to one temp file (`mktemp` with a `.patch` suffix); reviewers read that file. Delete it at the end.

Classify before anything else:

| When the diff | Mark |
| --- | --- |
| changes about 200 or more executable lines (not tests, lockfiles, generated files, docs) | heavy |
| touches auth, sessions or permissions; secrets, keys or env files; money or billing; a public API, schema or wire format; a migration; CI (`.github/`, pipelines); dependency manifests or lockfiles; an LLM feature (prompts, tool calls, model output used as input) | risky, therefore heavy |
| changes styles, components, templates, layout or visual assets | UI |
| is a design, plan or spec with no code | design: follow `references/design-review.md` instead of steps 3 to 6 |
| is a request to audit a whole codebase for security | audit: follow `references/security-audit.md` |

Anything else is light. Light and heavy run the same steps; heavy adds step 6.

## 2. Gather context

Collect paths and quote load-bearing lines verbatim; do not paraphrase rules.

- Intent: PR description, linked issue or ticket, plan file, acceptance criteria, commit subjects. Write the intent as one paragraph. If you cannot state it, ask the owner before spawning anyone.
- Decisions: the project's ADRs and decision notes that touch the changed paths (`docs/adr/`, `harness/rules/decisions/`, `AGENTS.md`/`CLAUDE.md`, `.claude/rules/`, `CONTRIBUTING*`).
- Workload: the project's workload description file (expected traffic, data volume, SLOs, topology) if one exists; search for `workload`, `SLO`, `capacity` in `docs/`. The PR's one line on where the code runs counts too.
- Knowledge for reviewers: the changed language's `references/review-standard.md` in its skill when it exists; until then the language skills in `references/language-map.md`. Domain checklists: every installed `skills/*/references/review-checklist.md` whose domain the diff touches.

Each item you looked for and did not find goes into the report's Missing context section. Never proceed as if it were there.

## 3. Run static tools first

Run what the project already uses on the changed files: its lint and type check (from `lefthook.yml`, `.pre-commit-config.yaml`, `package.json` scripts, `Makefile`, or the language default). For security-relevant changes, also run what is installed: `osv-scanner scan source -r .` (dependencies), `gitleaks dir` or `gitleaks git` (secrets), `zizmor .github/workflows` (Actions).

- Your own change in your own checkout: run them.
- Someone else's change (an external PR): a project's lint config can execute code. Run only tools that do not load repository code, or all of them with `JIG_REVIEW_EXEC=1` set for this run.
- Record each tool as ran, not installed, not applicable, or failed. Never write "no issues" on the strength of a tool that did not run.
- Pass each tool's output, trimmed to the changed files, to the reviewers. Do not restate tool findings as reviewer findings; list them under Tools in the report.

## 4. Spawn reviewers

Spawn in one message, in parallel, read-only. Each brief carries: the diff file path, the intent paragraph, the context paths from step 2, the tool output from step 3, and the knowledge paths that reviewer reads. Give reviewers the change and its intent, not your own reasoning about it.

| When | Spawn |
| --- | --- |
| always | `code-reviewer` |
| risky paths, or input handling, crypto, file handling, outbound requests | `security-reviewer` |
| a command, handler, job, consumer, query, transaction boundary, retry, timeout, concurrency setting or external call changes; or an async UI flow, client state, API client or optimistic update changes | `workload-reviewer` |
| UI | `ui-reviewer`, after step 7's screenshots |
| tests change, or behaviour changes with no test change | `test-reviewer` |
| a language with no `review-standard.md` yet has its own `<lang>-reviewer` agent | that agent too, for that language's files (interim until its standard exists) |
| the change is performance-motivated or edits a known hot path, and a `<lang>-perf-reviewer` exists | that agent too |

## 5. Verify every finding

Spawn one `review-verifier` per finding, in parallel, with the finding, the diff file path and the context paths. At most 12 per review, highest severity first; the rest are reported as unverified, never dropped.

- holds → Findings.
- does not hold → removed; count it under Refuted with the one-line reason.
- cannot verify → Findings, labelled `[unverified]`, with what would settle it.

## 6. Heavy only: a second, independent review

Run pstack's `interrogate` on the same diff and intent, mapped by the `pstack-adapter` skill's Review section (Reviewer B runs on a model at least as strong as the session's: Codex's strongest model from Claude Code, omp, pi and DSH; a fresh session of the same model from Codex; never a weaker model). Pass the language standard and domain checklists as context files. Do not pass security-reviewer's findings to an outside provider. A finding both reviewers raised independently is a strong signal but not proof (agreement can be wrong); a finding only the second reviewer raised goes through step 5 like any other.

## 7. UI changes: capture before and after

With the `ui-capture` skill, capture the base and the change under the same browser, fonts and viewport:

- each state: default, loading, empty, error, long text;
- each viewport: a narrow phone width and a wide desktop width;
- light and dark (`--theme dark`).

Compute pixel differences with a tool when one is available; the reviewer judges whether a difference is intended. Give `ui-reviewer` the image pairs, the diff and the project's design tokens. Without screenshots, `ui-reviewer` reviews code only and the report says screenshots are missing.

## 8. Report and route

Write the report in the owner's language, in the shape of `references/output-format.md`:

- every finding states what fails (a concrete input or situation), why (the mechanism, terms explained where first used, no analogies), how to fix it (the diff and how to read it) and how to verify it (a test or command, and a source URL);
- three sections: Findings, Questions for the owner (trade-offs, taste, design calls), Missing context;
- a Ran section listing each tool and its status, each reviewer spawned, each one not spawned and why, and the refuted count.

Where it goes:

| When | Destination |
| --- | --- |
| 5 findings or fewer and no screenshots | chat, numbered; the owner answers like "1 fix, 2 dismiss" |
| more than 5 findings, screenshots, or a heavy review | an Artifact page with a choice per finding (`references/output-format.md`, "Artifact page"). Until that page exists, use chat in the same numbered form and say so |

Choices per finding: fix it, I'll fix it, comment on GitHub, dismiss.

- Your own work in progress: fix verified blocker and major findings yourself and list them as fixed; the rest wait for the owner's choice.
- Someone else's change (their code, a pull request, a branch you did not write): change nothing; every finding waits for the owner's choice.
- GitHub: never post a comment or review without the owner's approval of the exact text. Show the text, wait, then post. The guard asks too.
- Dismissed and missed findings feed the checklists (`references/output-format.md`, "Learning loop").
