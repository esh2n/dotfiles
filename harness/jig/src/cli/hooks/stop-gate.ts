/**
 * Claude Code `Stop` hook: run the project's typecheck/lint once at the end of
 * a turn, and hand a failure back as a reason to keep going.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 「型検査と lint
 * は Stop の関門で、`stop_hook_active` を見て二度目は止め、出力は末尾だけに
 * 切り詰める。」All three are here, and all three are about cost:
 *
 * - **once.** Claude Code sets `stop_hook_active: true` on the Stop that
 *   follows a hook-forced continuation. Seeing it, the typecheck does not run
 *   and the turn ends — whatever the check still says — unless the findings
 *   check, not the typecheck, made that continuation: then the edits made in it
 *   are checked once too. Which gate stopped last is read from the findings
 *   record, where a typecheck block is written; without that record,
 *   `stop_hook_active` alone decides. Without that check the gate
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

import { existsSync, readdirSync } from "node:fs";
import type { ChangedFiles } from "../../domain/hooks/changed";
import {
  type FindingsRule,
  type GateOutcome,
  type SkillRunEvent,
  blockReason,
  checkFindings,
  lastBlock,
  ownerNotice,
} from "../../domain/hooks/findings-check";
import { missingFindingsHooks, staleSettingsNotice } from "../../domain/hooks/findings-wiring";
import type { ReadDir } from "../../domain/hooks/format";
import { gatePlanFor, gateWantsChangedFiles, projectHooksFor, tail } from "../../domain/hooks/gate";
import { missingToolReason } from "../../domain/hooks/project-hooks";
import type { RunResult, Runner } from "../../domain/hooks/run";
import type { Logger } from "../../domain/ports";
import { changedFiles } from "../../infra/proc/changed-files";

/**
 * Long enough for a cold `tsc` on a real project; the hook's registered
 * timeout in settings.json is the real ceiling and is set above this, so the
 * runner gets to report a timeout rather than being killed mid-report.
 */
const TIMEOUT_MS = 240_000;

/** The table's `.sln` / `.csproj` lookup; an unreadable directory is empty. */
const readDirSync: ReadDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

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
  readonly session_id?: unknown;
  /** In-flight tasks; a `subagent` entry carries `agent_type` (https://code.claude.com/docs/en/hooks, Stop input). */
  readonly background_tasks?: unknown;
}

/**
 * The findings check's inputs and its one write: the gate records what it did for each
 * skill use, so the cap and the once-only notices hold across stops.
 */
export interface FindingsDeps {
  readonly read: () => Promise<readonly SkillRunEvent[]>;
  readonly rules: (skill: string) => FindingsRule | undefined;
  readonly record: (event: SkillRunEvent) => Promise<void>;
  readonly now: () => Date;
  readonly harness: string;
  /** Claude Code's settings file and its parsed content; absent, or `undefined` when unreadable, it is not checked. */
  readonly settings?: () => Promise<{ readonly path: string; readonly value: unknown } | undefined>;
}

export interface StopGateDeps {
  readonly run: Runner;
  readonly exists?: (path: string) => boolean;
  /** For the table's `.sln` / `.csproj` lookup. */
  readonly readDir?: ReadDir;
  /** The files this turn touched; only asked when the plan is file-scoped or the project has a hook config. */
  readonly changedFiles?: ChangedFiles;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  /** The findings check (`2026-10-23-findings-verification-check.md`); absent, it does not run. */
  readonly findings?: FindingsDeps;
}

const OUTCOME = {
  block: "blocked",
  unverified: "unverified",
  "not-checked": "not-checked",
} as const;

function runningSubagents(tasks: unknown): readonly string[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task) => {
    const t = task as { type?: unknown; agent_type?: unknown };
    return t.type === "subagent" && typeof t.agent_type === "string" ? [t.agent_type] : [];
  });
}

interface FindingsStepResult {
  readonly reasons: readonly string[];
  readonly notices: readonly string[];
  /** Which gate stopped this session's turn before this stop, when the record says. */
  readonly last?: "findings" | "typecheck";
}

/**
 * The findings check for this stop: reasons to stop the turn, and lines for the owner.
 * It runs whatever `stop_hook_active` says, because its own cap (per skill use) is what
 * bounds it; a failure to read is said to the owner as "not run", never passed over.
 */
async function findingsStep(
  payload: StopPayload,
  deps: FindingsDeps,
  logger: Logger | undefined,
): Promise<FindingsStepResult> {
  if (typeof payload.session_id !== "string" || payload.session_id === "") {
    return { reasons: [], notices: [] };
  }
  const session = payload.session_id;
  try {
    const events = await deps.read();
    const last = lastBlock(session, events);
    const actions = checkFindings({
      session,
      events,
      rules: deps.rules,
      running: runningSubagents(payload.background_tasks),
    });
    const reasons: string[] = [];
    const notices: string[] = [];
    for (const action of actions) {
      if (action.action === "block") reasons.push(blockReason(action));
      else notices.push(ownerNotice(action));
      const outcome: GateOutcome = OUTCOME[action.action];
      await deps.record({
        at: deps.now().toISOString(),
        session,
        harness: deps.harness,
        kind: "gate",
        skill: action.skill,
        useAt: action.useAt,
        outcome,
      });
      logger?.debug(`gate.findings-${outcome}`, { skill: action.skill });
    }
    // Its own failure is its own: the reasons above are already counted against the cap.
    try {
      const stale = await staleSettingsStep(session, events, deps, logger);
      if (stale !== undefined) notices.push(stale);
    } catch (error) {
      logger?.debug("gate.stale-settings-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { reasons, notices, ...(last === undefined ? {} : { last }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.debug("gate.findings-failed", { message });
    return {
      reasons: [],
      notices: [`jig: the findings check did not run (${message}). Not a pass.`],
    };
  }
}

/**
 * Said once a session: settings that lack the recording hooks leave the check blind, and
 * it would pass every turn without a word. An unreadable settings file is not judged.
 */
async function staleSettingsStep(
  session: string,
  events: readonly SkillRunEvent[],
  deps: FindingsDeps,
  logger: Logger | undefined,
): Promise<string | undefined> {
  if (deps.settings === undefined) return undefined;
  if (events.some((event) => event.session === session && event.kind === "stale-settings")) {
    return undefined;
  }
  const settings = await deps.settings();
  if (settings === undefined) return undefined;
  const missing = missingFindingsHooks(settings.value);
  if (missing.length === 0) return undefined;
  await deps.record({
    at: deps.now().toISOString(),
    session,
    harness: deps.harness,
    kind: "stale-settings",
  });
  logger?.debug("gate.findings-stale-settings", { missing: missing.join(",") });
  return staleSettingsNotice(missing, settings.path);
}

/** @returns what to write to stdout: a block decision, a message for the owner, or the empty string. */
export async function stopGate(stdin: string, deps: StopGateDeps): Promise<string> {
  let payload: StopPayload;
  try {
    payload = JSON.parse(stdin) as StopPayload;
  } catch {
    deps.logger?.debug("gate.unparseable-input", { chars: stdin.length });
    return "";
  }

  const findings =
    deps.findings === undefined
      ? { reasons: [], notices: [] }
      : await findingsStep(payload, deps.findings, deps.logger);

  // The one check that makes the typecheck a gate and not a loop.
  let typecheck: string | undefined;
  if (payload.stop_hook_active === true && findings.last !== "findings") {
    deps.logger?.debug("gate.already-continued");
  } else {
    typecheck = await typecheckReason(payload, deps);
    if (typecheck !== undefined) await recordTypecheckBlock(payload, deps);
  }

  const reasons = [...findings.reasons, ...(typecheck === undefined ? [] : [typecheck])];
  const systemMessage =
    findings.notices.length === 0 ? {} : { systemMessage: findings.notices.join("\n") };
  if (reasons.length > 0) {
    return `${JSON.stringify({ decision: "block", reason: reasons.join("\n\n"), ...systemMessage })}\n`;
  }
  return findings.notices.length === 0 ? "" : `${JSON.stringify(systemMessage)}\n`;
}

/**
 * Write that the typecheck stopped this turn, so its next stop knows the block was its own.
 * A failed write is logged; the next stop then falls back to `stop_hook_active` only if the
 * record cannot be read either.
 */
async function recordTypecheckBlock(payload: StopPayload, deps: StopGateDeps): Promise<void> {
  if (deps.findings === undefined) return;
  if (typeof payload.session_id !== "string" || payload.session_id === "") return;
  try {
    await deps.findings.record({
      at: deps.findings.now().toISOString(),
      session: payload.session_id,
      harness: deps.findings.harness,
      kind: "typecheck",
    });
  } catch (error) {
    deps.logger?.debug("gate.typecheck-record-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The typecheck/lint gate: the reason to stop the turn, or `undefined` to let it end. */
async function typecheckReason(
  payload: StopPayload,
  deps: StopGateDeps,
): Promise<string | undefined> {
  const exists = deps.exists ?? existsSync;
  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
  const readDir = deps.readDir ?? readDirSync;

  // git is only asked when there is something to hand the list to: the
  // project's hook runner, or a file-scoped entry of the table.
  const hooks = projectHooksFor(cwd, exists);
  let changed: readonly string[] | undefined;
  if (gateWantsChangedFiles(cwd, exists, readDir)) {
    try {
      changed = await (deps.changedFiles ?? changedFiles)(hooks?.root ?? cwd);
    } catch (error) {
      deps.logger?.debug("gate.changed-files-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      changed = undefined;
    }
  }

  const plan = gatePlanFor(cwd, exists, changed, readDir);
  if (plan.kind === "nothing") {
    deps.logger?.debug(`gate.${plan.reason}`, { cwd, tool: hooks?.tool });
    return undefined;
  }

  // In order; the first failure is the one reported. A table tool that is
  // not installed is skipped and the rest still run (phpstan absent, `php -l`
  // still counts).
  for (const command of plan.commands) {
    let result: RunResult;
    try {
      result = await deps.run(command.bin, command.args, {
        cwd: plan.cwd,
        timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
        ...(command.unsetEnv === undefined ? {} : { unsetEnv: command.unsetEnv }),
      });
    } catch (error) {
      deps.logger?.debug("gate.run-failed", {
        source: plan.source,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    if (result.missing) {
      if (plan.source === "project" && hooks !== undefined) {
        // The ruling's one hard line: a project's rules are never replaced by
        // jig's, so the answer is "install it", said once (stop_hook_active).
        deps.logger?.debug("gate.project-tool-missing", { tool: hooks.tool, config: hooks.config });
        return missingToolReason(hooks);
      }
      deps.logger?.debug("gate.tool-missing", { label: command.label, bin: command.bin });
      continue;
    }
    if (result.code === 0) continue;

    const output = tail(`${result.stdout}\n${result.stderr}`.trim());
    const reason = `jig gate: \`${command.label}\` failed (exit ${result.code}). ${ONCE_PER_TURN}\n\n${output}`;

    deps.logger?.debug("gate.blocked", {
      source: plan.source,
      label: command.label,
      code: result.code,
    });
    return reason;
  }
  return undefined;
}
