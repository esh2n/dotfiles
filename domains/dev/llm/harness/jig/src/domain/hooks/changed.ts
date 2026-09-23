/**
 * The shape of "which files did this turn touch" that the gate depends on
 * when a project has its own hook runner — a port, not an implementation.
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`:
 * 「ゲートは『このターンで触ったファイル』を `git diff --name-only`（+ untracked）
 * で集めて手順に渡す。」The adapter is `infra/proc/changed-files.ts`; the
 * gate itself only ever sees the list.
 *
 * `undefined` is "git could not say" — not installed, or `cwd` is not inside
 * a repository — which the gate reports as such rather than treating as an
 * empty change set.
 */

export type ChangedFiles = (cwd: string) => Promise<readonly string[] | undefined>;
