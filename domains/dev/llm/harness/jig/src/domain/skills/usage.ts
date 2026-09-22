/**
 * Skill usage — what the router offered against what the model actually opened.
 *
 * The router's own log answers "what did the router decide". It cannot answer the only
 * question that decides the router's future: whether the injected skill came back. Both
 * harnesses already record that — the reminder the router injects and the file the model
 * then opens are entries their session transcripts carry — so this measures a record
 * that exists rather than asking each harness to carry a new instrument.
 *
 * The unit is the TURN, not the event. "Injected and never opened" and "opened without
 * being injected" are statements about one request; counted apart they lose the pairing
 * that makes them mean anything, and the second one is the router's miss rate.
 *
 * A skill is "opened" two ways, and both are counted, kept apart (`opened_via`):
 *  - `read` — the body opened as a file, through the harness's read tool. This is all the
 *    report counted until 2026-09-22.
 *  - `skill` — the harness's own `Skill` tool, which loads the body without a file read.
 *    Measured on 2026-09-22: 1,208 `Skill` calls in 30 days, every one of them counted as
 *    zero, which moved `unrouted` from 65 to 150 — the report understated how much skills
 *    are used on this machine by more than half. Pass `openedVia: "read"` to reproduce the
 *    old numbers exactly; the per-skill rows carry both counts either way.
 *
 * What this cannot see, and why it is still worth having:
 *  - A body read through a shell (`cat`, `sed`, `grep`) is not a tool call, so it is not
 *    counted. That understates usage; it never invents it.
 *  - An abstention leaves no trace. The router answers "no skill" by injecting nothing,
 *    so a request it declined looks exactly like one that never reached it. Every
 *    "opened while nothing was injected" turn is therefore an upper bound on misses —
 *    read the sessions before calling all of it a miss.
 */

/**
 * Which harness recorded the turn. `unknown` is a real answer: a transcript whose shape
 * matches neither harness is reported under its own name rather than averaged into one
 * harness's numbers, so a harness changing its format shows up instead of distorting a rate.
 */
export type Harness = "claude" | "pi" | "unknown";

export interface SkillTurn {
  /** Session file the turn came from, so a surprising number can be opened and read. */
  readonly session: string;
  readonly harness: Harness;
  /** ISO timestamp of the first entry belonging to the turn. */
  readonly at: string;
  /**
   * The skills the router put into this request, in the order it ranked them. Empty when
   * nothing was injected (see the module comment on why a declined request is
   * indistinguishable).
   */
  readonly injected: readonly string[];
  /** The strongest confidence the router reported for `injected`, when it reported one. */
  readonly confidence: number | undefined;
  /** Skills whose file the model opened in this turn, deduplicated, in read order. */
  readonly read: readonly string[];
  /**
   * Skills the model loaded through the harness's `Skill` tool in this turn, deduplicated,
   * in call order. A skill can appear in both lists — the model invoked it and then read a
   * reference file under it — and the turn is still one use of it.
   */
  readonly skilled: readonly string[];
}

/** How a skill's instructions reached the model in a turn. */
export type OpenedVia = "read" | "skill";

export interface SkillUsageOptions {
  /**
   * Which opens count as "opened". `any` (the default) counts both; `read` reproduces the
   * numbers this report gave before the `Skill` tool was parsed, so a before/after is a
   * flag away rather than a checkout away.
   */
  readonly openedVia?: OpenedVia | "any";
}

/** The skills a turn counts as opened, under one counting rule. */
function openedOf(turn: SkillTurn, openedVia: OpenedVia | "any"): readonly string[] {
  if (openedVia === "read") return turn.read;
  if (openedVia === "skill") return turn.skilled;
  return [...turn.read, ...turn.skilled.filter((skill) => !turn.read.includes(skill))];
}

/** Directory names a skill's files live under, in the two shapes this machine uses. */
const SKILL_DIRS: ReadonlySet<string> = new Set(["skills", ".skills-merged"]);

/**
 * The skill a path names, or `undefined` for a path that names none.
 *
 * The rightmost marker wins, because both shapes nest: the repo keeps skills at
 * `claude-profiles/<profile>/skills/<name>/SKILL.md` and the merged farm symlinks them
 * into `~/.claude/.skills-merged/<name>/SKILL.md`, so one read arrives under either.
 *
 * The name is a CANDIDATE, not a fact: a directory named `skills` can hold things that are
 * not skills (jig's own `src/infra/skills/`), so the caller filters the result against the
 * installed catalog, which is the only thing that knows which names are skills.
 */
export function skillNameFromPath(path: string): string | undefined {
  const parts = path.split("/").filter((part) => part !== "");

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part === undefined || !SKILL_DIRS.has(part)) continue;
    // A skill is the DIRECTORY the opened file lives in, so the name has to be followed
    // by at least one more segment: `skills/catalog.ts` is a file in a directory called
    // skills, not a skill whose body would be named `catalog.ts`.
    const name = parts[index + 1];
    if (name === undefined || name === "" || parts[index + 2] === undefined) continue;
    return name;
  }

  // A body read through a path with no marker segment at all: name it after the
  // directory that holds the body.
  if (parts.at(-1) === "SKILL.md") return parts.at(-2);
  return undefined;
}

/** One skill's numbers across every turn read. */
export interface SkillUsageRow {
  readonly skill: string;
  /** Turns where the router injected this skill. */
  readonly injected: number;
  /** Turns where the model opened this skill, under the report's counting rule. */
  readonly opened: number;
  /** Turns where the router injected it and the model then opened it. */
  readonly followed: number;
  /** Turns where the model opened it without being told to. */
  readonly unrouted: number;
  /** Turns where the body was opened as a file. Counted whatever the rule, so both are comparable. */
  readonly openedViaRead: number;
  /** Turns where it was loaded through the `Skill` tool. Same: always counted. */
  readonly openedViaSkill: number;
}

/**
 * How the turns split. The six classes are exhaustive and disjoint, so they add up to
 * `turns` — a report whose parts do not sum to the whole is a parsing bug, not a finding.
 */
export interface UsageTotals {
  readonly turns: number;
  /** One or more injected, and the model opened every injected skill. */
  readonly followed: number;
  /** Several injected, and the model opened some of them but not all. */
  readonly partial: number;
  /** Injected, and the model opened nothing at all. */
  readonly ignored: number;
  /** Injected, and the model opened a different skill. */
  readonly substituted: number;
  /** Nothing injected, and the model opened a skill anyway. */
  readonly unrouted: number;
  /** Nothing injected, nothing opened. */
  readonly silent: number;
}

export interface SkillUsageReport {
  readonly sessions: number;
  /** The counting rule the totals were folded under, so a printed report says which it is. */
  readonly openedVia: OpenedVia | "any";
  readonly totals: UsageTotals;
  readonly byHarness: ReadonlyMap<Harness, UsageTotals>;
  /** Every skill that was injected or opened, most-opened first. */
  readonly skills: readonly SkillUsageRow[];
  readonly from: string;
  readonly to: string;
}

const EMPTY: UsageTotals = {
  turns: 0,
  followed: 0,
  partial: 0,
  ignored: 0,
  substituted: 0,
  unrouted: 0,
  silent: 0,
};

/** One turn's class. Exhaustive by construction, which is what keeps the totals add up. */
type TurnOutcome = "followed" | "partial" | "ignored" | "substituted" | "unrouted" | "silent";

function outcomeOf(turn: SkillTurn, counted: readonly string[]): TurnOutcome {
  if (turn.injected.length > 0) {
    const opened = new Set(counted);
    const taken = turn.injected.filter((skill) => opened.has(skill)).length;
    if (taken === 0) return counted.length === 0 ? "ignored" : "substituted";
    // "Followed" for a multi-pick turn means every skill it named was opened. Opening one
    // of two is its own outcome: it is how an over-eager pick shows up, and counting it as
    // followed would hide exactly the thing a second pick has to be judged on.
    return taken === turn.injected.length ? "followed" : "partial";
  }
  return counted.length > 0 ? "unrouted" : "silent";
}

function add(total: UsageTotals, outcome: TurnOutcome): UsageTotals {
  return { ...total, turns: total.turns + 1, [outcome]: total[outcome] + 1 };
}

interface MutableRow {
  injected: number;
  opened: number;
  followed: number;
  unrouted: number;
  openedViaRead: number;
  openedViaSkill: number;
}

/**
 * Fold the turns into the numbers worth deciding on: which skills are alive, how often
 * an injection was followed, and how often the model picked a skill the router did not.
 */
export function summarizeSkillUsage(
  turns: readonly SkillTurn[],
  options: SkillUsageOptions = {},
): Omit<SkillUsageReport, "sessions"> {
  const openedVia = options.openedVia ?? "any";
  const rows = new Map<string, MutableRow>();
  const byHarness = new Map<Harness, UsageTotals>();
  let totals = EMPTY;

  const rowOf = (skill: string): MutableRow => {
    const existing = rows.get(skill);
    if (existing !== undefined) return existing;
    const created: MutableRow = {
      injected: 0,
      opened: 0,
      followed: 0,
      unrouted: 0,
      openedViaRead: 0,
      openedViaSkill: 0,
    };
    rows.set(skill, created);
    return created;
  };

  let from = "";
  let to = "";
  const seenSessions = new Set<string>();

  for (const turn of turns) {
    seenSessions.add(turn.session);
    const counted = openedOf(turn, openedVia);
    const outcome = outcomeOf(turn, counted);
    totals = add(totals, outcome);
    byHarness.set(turn.harness, add(byHarness.get(turn.harness) ?? EMPTY, outcome));

    if (turn.at !== "") {
      if (from === "" || turn.at < from) from = turn.at;
      if (to === "" || turn.at > to) to = turn.at;
    }

    for (const skill of new Set(turn.injected)) rowOf(skill).injected += 1;

    // The turn is the unit: opening a skill's body and one of its references in the same
    // request is one use of that skill, not two.
    for (const skill of new Set(counted)) {
      const row = rowOf(skill);
      row.opened += 1;
      if (turn.injected.includes(skill)) row.followed += 1;
      if (turn.injected.length === 0) row.unrouted += 1;
    }

    // The two ways in are counted whatever the rule in force, so one run shows both halves
    // and a `--opened-via read` run can be checked against it rather than trusted.
    for (const skill of new Set(turn.read)) rowOf(skill).openedViaRead += 1;
    for (const skill of new Set(turn.skilled)) rowOf(skill).openedViaSkill += 1;
  }

  const skills = [...rows.entries()]
    .map(([skill, row]): SkillUsageRow => ({ skill, ...row }))
    .sort((left, right) => right.opened - left.opened || left.skill.localeCompare(right.skill));

  return { openedVia, totals, byHarness, skills, from, to };
}
