/**
 * Whether a review's findings were handed to a verifier before the turn ended.
 *
 * `rules/decisions/2026-10-23-findings-verification-check.md`: a skill declares, in its
 * frontmatter's `metadata`, the subagent types that report findings
 * (`findings-reporters`) and the one that must check them (`findings-verifier`); each
 * reporter ends its report with one `Findings: <n>` line. Since the skill's last use, one
 * or more findings with no verifier finished or running stops the turn, at most `cap`
 * times per use; after that the owner is told once. A reporter without the line makes the
 * check "not checked", told once, never a pass.
 *
 * That is all this knows of the procedure. No step order, no state machine, no command the
 * model calls: the inputs are what the harness's own events already said.
 *
 * Pure: the adapters read the events and the skills' frontmatter and hand them in.
 */

export interface FindingsRule {
  readonly reporters: readonly string[];
  readonly verifier: string;
}

interface EventBase {
  /** ISO 8601, as written by the recorder. */
  readonly at: string;
  readonly session: string;
  readonly harness: string;
}

export type GateOutcome = "blocked" | "unverified" | "not-checked";

export type SkillRunEvent =
  | (EventBase & { readonly kind: "skill"; readonly name: string })
  | (EventBase & {
      readonly kind: "subagent";
      readonly agentType: string;
      /** The harness's id for this run, when it gives one; two records with one id are one report. */
      readonly agentId?: string;
      /** The report's `Findings: <n>`; absent when the report had no such line. */
      readonly findings?: number;
    })
  | (EventBase & {
      readonly kind: "gate";
      readonly skill: string;
      /** The `at` of the skill use this outcome was about. */
      readonly useAt: string;
      readonly outcome: GateOutcome;
    })
  /** The typecheck gate stopped the turn; read back so that only its own block makes it "once". */
  | (EventBase & { readonly kind: "typecheck" });

export interface ReporterCount {
  readonly agentType: string;
  readonly findings: number;
}

export type FindingsAction =
  | {
      readonly action: "block";
      readonly skill: string;
      readonly useAt: string;
      readonly verifier: string;
      readonly findings: number;
      readonly reporters: readonly ReporterCount[];
      /** This stop's number for the use, from 1. */
      readonly attempt: number;
      readonly cap: number;
    }
  | {
      readonly action: "unverified";
      readonly skill: string;
      readonly useAt: string;
      readonly verifier: string;
      readonly findings: number;
    }
  | {
      readonly action: "not-checked";
      readonly skill: string;
      readonly useAt: string;
      readonly verifier: string;
      /** The reporters whose report had no `Findings` line. */
      readonly unreported: readonly string[];
    };

export interface FindingsCheckInput {
  readonly session: string;
  readonly events: readonly SkillRunEvent[];
  readonly rules: (skill: string) => FindingsRule | undefined;
  /** Subagent types the harness says are still running. */
  readonly running: readonly string[];
  readonly cap?: number;
}

const DEFAULT_CAP = 2;

/** The last `Findings: <n>` line of a report, or `undefined` when it has none. */
export function findingsOf(report: string): number | undefined {
  let found: number | undefined;
  for (const match of report.matchAll(/^[ \t]*Findings:[ \t]*(\d+)[ \t]*$/gm)) {
    found = Number.parseInt(match[1] ?? "", 10);
  }
  return found;
}

/** The value of `key:` inside the indented block, as a list: flow `[a, b]`, block `- a`, or a scalar. */
function listField(block: readonly string[], key: string): readonly string[] | undefined {
  const at = block.findIndex((line) => new RegExp(`^\\s+${key}:`).test(line));
  if (at === -1) return undefined;
  const line = block[at] ?? "";
  const indent = /^(\s*)/.exec(line)?.[1]?.length ?? 0;
  const raw = (new RegExp(`^\\s+${key}:\\s*(.*)$`).exec(line)?.[1] ?? "").trim();
  const clean = (item: string): string => item.trim().replace(/^["']|["']$/g, "");
  if (raw !== "") {
    const flow = /^\[(.*)\]$/.exec(raw)?.[1];
    const items = (flow ?? raw).split(",").map(clean);
    return items.filter((item) => item !== "");
  }
  const items: string[] = [];
  for (const next of block.slice(at + 1)) {
    const depth = /^(\s*)/.exec(next)?.[1]?.length ?? 0;
    if (next.trim() === "" || depth <= indent) break;
    const item = /^\s*-\s*(.+)$/.exec(next)?.[1];
    if (item !== undefined) items.push(clean(item));
  }
  return items.filter((item) => item !== "");
}

/**
 * The rule a skill's frontmatter (the text between the `---` lines) declares under
 * `metadata:`, or `undefined` unless both keys are there.
 */
export function findingsRuleOf(front: string): FindingsRule | undefined {
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start === -1) return undefined;
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    block.push(line);
  }
  const reporters = listField(block, "findings-reporters");
  const verifier = listField(block, "findings-verifier");
  if (reporters === undefined || reporters.length === 0) return undefined;
  if (verifier === undefined || verifier.length !== 1) return undefined;
  return { reporters, verifier: verifier[0] ?? "" };
}

type SubagentEvent = Extract<SkillRunEvent, { kind: "subagent" }>;

/** One entry per subagent run: records sharing an `agentId` merge, the first count winning. */
function runsOf(events: readonly SubagentEvent[]): readonly SubagentEvent[] {
  const byId = new Map<string, SubagentEvent>();
  const out: SubagentEvent[] = [];
  for (const event of events) {
    if (event.agentId === undefined) {
      out.push(event);
      continue;
    }
    const seen = byId.get(event.agentId);
    if (seen === undefined) {
      byId.set(event.agentId, event);
      out.push(event);
    } else if (seen.findings === undefined && event.findings !== undefined) {
      const merged = { ...seen, findings: event.findings };
      byId.set(event.agentId, merged);
      out[out.indexOf(seen)] = merged;
    }
  }
  return out;
}

const time = (at: string): number => Date.parse(at);

/** What the end-of-turn gate must do for this session: one action per skill use that needs one. */
export function checkFindings(input: FindingsCheckInput): readonly FindingsAction[] {
  const cap = input.cap ?? DEFAULT_CAP;
  const mine = input.events
    .filter((event) => event.session === input.session)
    .slice()
    .sort((a, b) => time(a.at) - time(b.at));

  const lastUse = new Map<string, string>();
  for (const event of mine) if (event.kind === "skill") lastUse.set(event.name, event.at);

  const actions: FindingsAction[] = [];
  for (const [skill, useAt] of lastUse) {
    const rule = input.rules(skill);
    if (rule === undefined) continue;
    const after = mine.filter((event) => time(event.at) >= time(useAt));
    const runs = runsOf(after.filter((event): event is SubagentEvent => event.kind === "subagent"));
    const verified =
      runs.some((run) => run.agentType === rule.verifier) || input.running.includes(rule.verifier);
    if (verified) continue;
    // Reports still coming: a stop spent now would use up the cap before the last one is in.
    if (input.running.some((type) => rule.reporters.includes(type))) continue;

    const reports = runs.filter((run) => rule.reporters.includes(run.agentType));
    const counted = reports.flatMap((run) =>
      run.findings === undefined ? [] : [{ agentType: run.agentType, findings: run.findings }],
    );
    const findings = counted.reduce((sum, run) => sum + run.findings, 0);
    const outcomes = after
      .filter((event) => event.kind === "gate" && event.skill === skill && event.useAt === useAt)
      .map((event) => (event.kind === "gate" ? event.outcome : undefined));

    if (findings > 0) {
      const blocked = outcomes.filter((outcome) => outcome === "blocked").length;
      if (blocked < cap) {
        actions.push({
          action: "block",
          skill,
          useAt,
          verifier: rule.verifier,
          findings,
          reporters: counted.filter((run) => run.findings > 0),
          attempt: blocked + 1,
          cap,
        });
      } else if (!outcomes.includes("unverified")) {
        actions.push({ action: "unverified", skill, useAt, verifier: rule.verifier, findings });
      }
      continue;
    }

    const unreported = reports
      .filter((run) => run.findings === undefined)
      .map((run) => run.agentType);
    if (unreported.length > 0 && !outcomes.includes("not-checked")) {
      actions.push({ action: "not-checked", skill, useAt, verifier: rule.verifier, unreported });
    }
  }
  return actions;
}

/**
 * Which gate stopped this session's turn most recently, or `undefined` when neither has.
 * `stop_hook_active` says only that some hook stopped the last stop; the typecheck runs
 * once per turn, so it skips only when its own block was the last one.
 */
export function lastBlock(
  session: string,
  events: readonly SkillRunEvent[],
): "findings" | "typecheck" | undefined {
  let last: { readonly at: number; readonly by: "findings" | "typecheck" } | undefined;
  for (const event of events) {
    if (event.session !== session) continue;
    const by =
      event.kind === "typecheck"
        ? "typecheck"
        : event.kind === "gate" && event.outcome === "blocked"
          ? "findings"
          : undefined;
    // `>=`: of two records at one instant the later line wins; the gate writes the typecheck's last.
    if (by !== undefined && (last === undefined || time(event.at) >= last.at)) {
      last = { at: time(event.at), by };
    }
  }
  return last?.by;
}

/** What the model is told when the turn is stopped. */
export function blockReason(action: Extract<FindingsAction, { action: "block" }>): string {
  const by = action.reporters.map((r) => `${r.agentType} ${r.findings}`).join(", ");
  return (
    `jig findings check: \`${action.skill}\` was used and its reviewers reported ${action.findings} finding(s) (${by}), ` +
    `but no \`${action.verifier}\` has finished or is running since. Spawn \`${action.verifier}\` on the findings as the skill says before you finish. ` +
    `(Stop ${action.attempt} of ${action.cap} for this use; after that the owner is told the findings went unverified.)`
  );
}

/** What the owner is told, without stopping the turn. */
export function ownerNotice(action: Exclude<FindingsAction, { action: "block" }>): string {
  if (action.action === "unverified") {
    return `jig: ${action.skill} ended with ${action.findings} finding(s) that no ${action.verifier} checked.`;
  }
  return `jig: could not check whether ${action.skill}'s findings were verified — no "Findings: <n>" line in the report of ${action.unreported.join(", ")}. Not a pass.`;
}
