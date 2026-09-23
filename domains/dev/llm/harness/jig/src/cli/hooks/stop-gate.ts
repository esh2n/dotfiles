/**
 * Claude Code `Stop` hook: run the project's typecheck/lint once at the end of
 * a turn, and hand a failure back as a reason to keep going.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 「型検査と lint
 * は Stop の関門で、`stop_hook_active` を見て二度目は止め、出力は末尾だけに
 * 切り詰める。」All three are here, and all three are about cost:
 *
 * - **once.** Claude Code sets `stop_hook_active: true` on the Stop that
 *   follows a hook-forced continuation. Seeing it, this returns nothing and
 *   the turn ends — whatever the check still says. Without that check the gate
 *   is a loop, and the decision cites the price of one: 35k tokens and 20
 *   minutes. Claude Code's own ceiling (8) is a backstop, not an allowance.
 * - **the tail only.** A whole `tsc` log in the model's context is the same
 *   cost by another route.
 * - **a missing toolchain is not a failure.** A repository whose `tsc` is not
 *   installed must still be able to finish a turn (`missing` from the runner).
 *
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md` adds
 * the precedence in front of the table: a project with `lefthook.yml` /
 * `.pre-commit-config.yaml` is gated by its own hook runner on the files this
 * turn touched (`git diff --name-only` plus untracked, through the
 * `ChangedFiles` port), and the table applies only when there is no such
 * file. The one exception to "missing is not a failure" is that runner: the
 * config exists, the tool does not, and the table is NOT the substitute — the
 * gate blocks once (the `stop_hook_active` guard above is the "once") with a
 * one-line reason telling the owner to install it.
 *
 * It blocks with `{"decision":"block","reason":...}` rather than exit code 2:
 * same effect, but the reason reaches the model as data instead of as scraped
 * stderr. Everything else — an unparseable payload, a project with no
 * recognized check, a runner that throws — returns the empty string, which
 * lets the turn end.
 */

import { existsSync } from "node:fs";
import type { ChangedFiles } from "../../domain/hooks/changed";
import { gatePlanFor, projectHooksFor, tail } from "../../domain/hooks/gate";
import { missingToolReason } from "../../domain/hooks/project-hooks";
import type { Runner } from "../../domain/hooks/run";
import type { Logger } from "../../domain/ports";
import { changedFiles } from "../../infra/proc/changed-files";

/**
 * Long enough for a cold `tsc` on a real project; the hook's registered
 * timeout in settings.json is the real ceiling and is set above this, so the
 * runner gets to report a timeout rather than being killed mid-report.
 */
const TIMEOUT_MS = 240_000;

/**
 * Said to the model, not just to the log: a gate that will not fire again is a
 * different situation from one that will, and the model cannot see
 * `stop_hook_active`.
 */
const ONCE_PER_TURN =
  "Fix what it reports before finishing — this gate runs once per turn, so the next stop ends the turn whatever it says.";

/** The Stop payload, as far as this hook reads it — every field checked. */
interface StopPayload {
  readonly stop_hook_active?: unknown;
  readonly cwd?: unknown;
}

export interface StopGateDeps {
  readonly run: Runner;
  readonly exists?: (path: string) => boolean;
  /** The files this turn touched; only asked when the project has a hook config. */
  readonly changedFiles?: ChangedFiles;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
}

/** @returns what to write to stdout: a block decision, or the empty string. */
export async function stopGate(stdin: string, deps: StopGateDeps): Promise<string> {
  const exists = deps.exists ?? existsSync;

  let payload: StopPayload;
  try {
    payload = JSON.parse(stdin) as StopPayload;
  } catch {
    deps.logger?.debug("gate.unparseable-input", { chars: stdin.length });
    return "";
  }

  // The one check that makes this a gate and not a loop.
  if (payload.stop_hook_active === true) {
    deps.logger?.debug("gate.already-continued");
    return "";
  }

  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();

  // git is only asked when there is a hook config to hand the list to.
  const hooks = projectHooksFor(cwd, exists);
  let changed: readonly string[] | undefined;
  if (hooks !== undefined) {
    try {
      changed = await (deps.changedFiles ?? changedFiles)(hooks.root);
    } catch (error) {
      deps.logger?.debug("gate.changed-files-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      changed = undefined;
    }
  }

  const plan = gatePlanFor(cwd, exists, changed);
  if (plan.kind === "nothing") {
    deps.logger?.debug(`gate.${plan.reason}`, { cwd, tool: hooks?.tool });
    return "";
  }

  let result: Awaited<ReturnType<Runner>>;
  try {
    result = await deps.run(plan.bin, plan.args, {
      cwd: plan.cwd,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
  } catch (error) {
    deps.logger?.debug("gate.run-failed", {
      source: plan.source,
      message: error instanceof Error ? error.message : String(error),
    });
    return "";
  }

  if (result.missing) {
    if (plan.source === "project" && hooks !== undefined) {
      // The ruling's one hard line: a project's rules are never replaced by
      // jig's, so the answer is "install it", said once (stop_hook_active).
      deps.logger?.debug("gate.project-tool-missing", { tool: hooks.tool, config: hooks.config });
      return `${JSON.stringify({ decision: "block", reason: missingToolReason(hooks) })}\n`;
    }
    return "";
  }
  if (result.code === 0) return "";

  const output = tail(`${result.stdout}\n${result.stderr}`.trim());
  const reason = `jig gate: \`${plan.label}\` failed (exit ${result.code}). ${ONCE_PER_TURN}\n\n${output}`;

  deps.logger?.debug("gate.blocked", { source: plan.source, label: plan.label, code: result.code });
  return `${JSON.stringify({ decision: "block", reason })}\n`;
}
