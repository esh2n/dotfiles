/**
 * Strict parser for a v2 policy document. Same contract as the v1 parser:
 * the caller has already `JSON.parse`d, every shape deviation throws with a
 * rule-identifying message, and the composition root fails closed on a
 * throw, so a broken policy is caught once at load time.
 */

import type { HookProfile } from "../../hooks/decision";
import {
  ACTIONS,
  type Action,
  type Effect,
  type FloorRule,
  type Mode,
  type PolicyV2,
  type RuleV2,
  type SubjectPattern,
} from "./types";

const EFFECTS: ReadonlySet<string> = new Set<Effect>(["forbid", "ask", "permit"]);
const ACTION_SET: ReadonlySet<string> = new Set<Action>(ACTIONS);
const MODES: ReadonlySet<string> = new Set<Mode>(["denylist", "allowlist"]);
const PROFILES: ReadonlySet<string> = new Set<HookProfile>(["minimal", "standard", "strict"]);

/** Shorthands accepted in `mode`, expanded to the actions they cover. */
const MODE_SHORTHANDS: Readonly<Record<string, readonly Action[]>> = {
  shell: ["shell.exec"],
  fs: ["fs.write", "fs.edit"],
  net: ["net.fetch"],
  mcp: ["mcp.call"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function regex(label: string, field: string, raw: unknown): RegExp {
  if (typeof raw !== "string" || raw === "") {
    throw new Error(`${label} has an empty "${field}" (expected a regex string)`);
  }
  try {
    return new RegExp(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} has an invalid "${field}" regex: ${reason}`);
  }
}

function parseSubject(label: string, raw: unknown): SubjectPattern {
  if (!isPlainObject(raw)) throw new Error(`${label} has a "subject" that is not an object`);
  const known = new Set(["program", "argv", "path", "host"]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`${label} has unknown subject field "${key}"`);
  }
  const subject: { -readonly [K in keyof SubjectPattern]: SubjectPattern[K] } = {};
  if (raw.program !== undefined) {
    if (typeof raw.program !== "string" || raw.program === "") {
      throw new Error(`${label} has an empty "subject.program"`);
    }
    subject.program = regex(label, "subject.program", `^(?:${raw.program})$`);
  }
  if (raw.argv !== undefined) subject.argv = regex(label, "subject.argv", raw.argv);
  if (raw.path !== undefined) subject.path = regex(label, "subject.path", raw.path);
  if (raw.host !== undefined) subject.host = regex(label, "subject.host", raw.host);
  if (Object.keys(subject).length === 0) throw new Error(`${label} has an empty "subject"`);
  return subject;
}

function parseId(raw: Record<string, unknown>, where: string): string {
  const { id } = raw;
  if (typeof id !== "string" || id === "") {
    throw new Error(`guard policy: ${where} is missing a non-empty string "id"`);
  }
  return id;
}

function parseAction(label: string, raw: unknown): Action {
  if (typeof raw !== "string" || !ACTION_SET.has(raw)) {
    throw new Error(
      `${label} has unknown action ${JSON.stringify(raw)} (expected one of ${ACTIONS.join(", ")})`,
    );
  }
  return raw as Action;
}

interface Target {
  readonly subject: SubjectPattern | undefined;
  readonly match: RegExp | undefined;
}

function parseTarget(label: string, raw: Record<string, unknown>): Target {
  const subject = raw.subject === undefined ? undefined : parseSubject(label, raw.subject);
  const match = raw.match === undefined ? undefined : regex(label, "match", raw.match);
  if (subject === undefined && match === undefined) {
    throw new Error(`${label} needs a "subject" or a "match" (or both)`);
  }
  return { subject, match };
}

function parseRule(raw: unknown, index: number): RuleV2 {
  if (!isPlainObject(raw)) throw new Error(`guard policy: rules[${index}] must be an object`);
  const id = parseId(raw, `rules[${index}]`);
  const label = `guard policy: rule "${id}"`;

  const { effect } = raw;
  if (typeof effect !== "string" || !EFFECTS.has(effect)) {
    throw new Error(
      `${label} has unknown effect ${JSON.stringify(effect)} (expected forbid, ask or permit)`,
    );
  }
  const action = parseAction(label, raw.action);
  const target = parseTarget(label, raw);

  const { why } = raw;
  if (why !== undefined && (typeof why !== "string" || why === "")) {
    throw new Error(`${label} has a "why" that is not a non-empty string`);
  }
  if (effect !== "permit" && why === undefined) {
    throw new Error(
      `${label} is ${effect} and must carry a "why" (a deny without a reason fails open on codex)`,
    );
  }

  const { profiles } = raw;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(`${label} must have a non-empty "profiles" array`);
  }
  for (const profile of profiles) {
    if (typeof profile !== "string" || !PROFILES.has(profile)) {
      throw new Error(
        `${label} has unknown profile ${JSON.stringify(profile)} (expected minimal, standard or strict)`,
      );
    }
  }

  const { principals } = raw;
  if (principals !== undefined) {
    if (
      !Array.isArray(principals) ||
      principals.length === 0 ||
      principals.some((p) => typeof p !== "string" || p === "")
    ) {
      throw new Error(`${label} has a "principals" that is not a non-empty array of names`);
    }
  }

  return {
    id,
    effect: effect as Effect,
    action,
    subject: target.subject,
    match: target.match,
    why,
    profiles: profiles as HookProfile[],
    principals: principals as string[] | undefined,
  };
}

function parseFloor(raw: unknown, index: number): FloorRule {
  if (!isPlainObject(raw)) throw new Error(`guard policy: floor[${index}] must be an object`);
  const id = parseId(raw, `floor[${index}]`);
  const label = `guard policy: floor rule "${id}"`;
  for (const key of ["effect", "profiles", "principals"]) {
    if (raw[key] !== undefined) {
      throw new Error(
        `${label} must not carry "${key}": the floor is forbid, for every profile and principal`,
      );
    }
  }
  const action = parseAction(label, raw.action);
  const target = parseTarget(label, raw);
  const { why } = raw;
  if (typeof why !== "string" || why === "")
    throw new Error(`${label} is missing a non-empty string "why"`);
  return { id, action, subject: target.subject, match: target.match, why };
}

function parseMode(raw: unknown): Readonly<Record<Action, Mode>> {
  const mode: Record<Action, Mode> = {
    "shell.exec": "denylist",
    "fs.write": "denylist",
    "fs.edit": "denylist",
    "net.fetch": "denylist",
    "mcp.call": "denylist",
  };
  if (raw === undefined) return mode;
  if (!isPlainObject(raw)) throw new Error('guard policy: "mode" must be an object');
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || !MODES.has(value)) {
      throw new Error(
        `guard policy: mode["${key}"] is ${JSON.stringify(value)} (expected denylist or allowlist)`,
      );
    }
    const actions = MODE_SHORTHANDS[key] ?? (ACTION_SET.has(key) ? [key as Action] : undefined);
    if (actions === undefined) throw new Error(`guard policy: mode has unknown key "${key}"`);
    for (const action of actions) mode[action] = value as Mode;
  }
  return mode;
}

/** Parse and strictly validate an already-`JSON.parse`d v2 policy document. */
export function parsePolicyV2(json: Record<string, unknown>): PolicyV2 {
  if (json.version !== 2) {
    throw new Error(
      `guard policy: unsupported version ${JSON.stringify(json.version)} (expected 2)`,
    );
  }
  if (!Array.isArray(json.rules)) throw new Error('guard policy: "rules" must be an array');
  if (json.floor !== undefined && !Array.isArray(json.floor)) {
    throw new Error('guard policy: "floor" must be an array');
  }
  const floor = ((json.floor as unknown[] | undefined) ?? []).map(parseFloor);
  const rules = json.rules.map(parseRule);
  const ids = new Set<string>();
  for (const { id } of [...floor, ...rules]) {
    if (ids.has(id)) throw new Error(`guard policy: duplicate rule id "${id}"`);
    ids.add(id);
  }
  return { version: 2, floor, mode: parseMode(json.mode), rules };
}
