/**
 * Strict parser/validator for the shared guard policy document (already
 * `JSON.parse`d by the caller — this module never touches IO). Any shape
 * deviation throws with a precise, rule-identifying message: an unknown
 * tier/tool/profile value, a missing field, an unsupported `version`, or an
 * unparseable `match` regex are all parse errors, not evaluate-time
 * surprises. That is deliberate — the composition root that loads this file
 * fails closed (see `cli/hooks/pre-tool-use.ts`) precisely because a broken
 * policy is caught here, once, at load time.
 */

import type { HookProfile } from "../hooks/decision";
import type { GuardPolicy, GuardRule, GuardTier, GuardTool } from "./types";

const TIERS: ReadonlySet<string> = new Set<GuardTier>(["deny", "confirm"]);
const TOOLS: ReadonlySet<string> = new Set<GuardTool>(["shell", "write", "edit"]);
const PROFILES: ReadonlySet<string> = new Set<HookProfile>(["minimal", "standard", "strict"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRule(raw: unknown, index: number): GuardRule {
  if (!isPlainObject(raw)) {
    throw new Error(`guard policy: rules[${index}] must be an object`);
  }

  const { id } = raw;
  if (typeof id !== "string" || id === "") {
    throw new Error(`guard policy: rules[${index}] is missing a non-empty string "id"`);
  }
  const label = `guard policy: rule "${id}"`;

  const { tier } = raw;
  if (typeof tier !== "string" || !TIERS.has(tier)) {
    throw new Error(
      `${label} has unknown tier ${JSON.stringify(tier)} (expected "deny" or "confirm")`,
    );
  }

  const { tools } = raw;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`${label} must have a non-empty "tools" array`);
  }
  for (const tool of tools) {
    if (typeof tool !== "string" || !TOOLS.has(tool)) {
      throw new Error(
        `${label} has unknown tool ${JSON.stringify(tool)} (expected one of "shell", "write", "edit")`,
      );
    }
  }

  const { match } = raw;
  if (typeof match !== "string" || match === "") {
    throw new Error(`${label} is missing a non-empty string "match"`);
  }
  let compiled: RegExp;
  try {
    compiled = new RegExp(match);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} has an invalid "match" regex: ${reason}`);
  }

  const { why } = raw;
  if (typeof why !== "string" || why === "") {
    throw new Error(`${label} is missing a non-empty string "why"`);
  }

  const { profiles } = raw;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(`${label} must have a non-empty "profiles" array`);
  }
  for (const profile of profiles) {
    if (typeof profile !== "string" || !PROFILES.has(profile)) {
      throw new Error(
        `${label} has unknown profile ${JSON.stringify(profile)} (expected one of "minimal", "standard", "strict")`,
      );
    }
  }

  return {
    id,
    tier: tier as GuardTier,
    tools: tools as GuardTool[],
    match: compiled,
    why,
    profiles: profiles as HookProfile[],
  };
}

/** Parse and strictly validate an already-`JSON.parse`d guard policy document. */
export function parsePolicy(json: unknown): GuardPolicy {
  if (!isPlainObject(json)) {
    throw new Error("guard policy: expected a JSON object at the top level");
  }

  if (json.version !== 1) {
    throw new Error(
      `guard policy: unsupported version ${JSON.stringify(json.version)} (expected 1)`,
    );
  }

  if (!Array.isArray(json.rules)) {
    throw new Error('guard policy: "rules" must be an array');
  }

  const rules = json.rules.map((raw, index) => parseRule(raw, index));

  return { version: 1, rules };
}
