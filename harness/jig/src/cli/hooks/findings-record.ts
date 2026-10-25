/**
 * What Claude Code's hooks write down for the findings check
 * (`rules/decisions/2026-10-23-findings-verification-check.md`). Each function reads one
 * hook payload and returns the record it makes, or `undefined`; the caller appends it.
 * None of them writes to stdout or can stop anything: a record that cannot be made is
 * simply not made. A report without its `Findings` line is recorded without a count, and
 * the gate says that one was not checked; a record never made is one the gate never sees.
 *
 * - PostToolUse on `Skill`: the skill the model loaded (`tool_input.skill`).
 * - PostToolUse on `SubagentHandback`: in auto mode a subagent hands its report over
 *   through this tool, and the hook fires with the parent's `session_id`, the subagent's
 *   `agent_id` and `agent_type`, and the report as `tool_input.message`.
 * - SubagentStop: the subagent's type and id; its `last_assistant_message` is the report
 *   only when there was no hand-back, and the two records of one run share the id.
 * - UserPromptSubmit: a `/name` the owner typed.
 *
 * All four payload shapes were measured on Claude Code 2.1.309 (2026-10-23).
 */

import { type SkillRunEvent, findingsOf } from "../../domain/hooks/findings-check";
import { commandOf } from "../../domain/skills/router-log";

type Payload = Record<string, unknown>;

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

function parse(stdin: string): Payload | undefined {
  try {
    const raw: unknown = JSON.parse(stdin);
    return typeof raw === "object" && raw !== null ? (raw as Payload) : undefined;
  } catch {
    return undefined;
  }
}

function subagent(
  payload: Payload,
  at: string,
  harness: string,
  report: unknown,
): SkillRunEvent | undefined {
  if (!text(payload.session_id) || !text(payload.agent_type)) return undefined;
  const findings = typeof report === "string" ? findingsOf(report) : undefined;
  return {
    at,
    session: payload.session_id,
    harness,
    kind: "subagent",
    agentType: payload.agent_type,
    ...(text(payload.agent_id) ? { agentId: payload.agent_id } : {}),
    ...(findings === undefined ? {} : { findings }),
  };
}

/** PostToolUse: a `Skill` call or a `SubagentHandback` report. Every other tool is not ours. */
export function recordFromPostToolUse(
  stdin: string,
  at: string,
  harness: string,
): SkillRunEvent | undefined {
  const payload = parse(stdin);
  if (payload === undefined || !text(payload.session_id)) return undefined;
  const input = (payload.tool_input ?? {}) as Payload;
  if (payload.tool_name === "Skill" && text(input.skill)) {
    return {
      at,
      session: payload.session_id,
      harness,
      kind: "skill",
      name: input.skill.replace(/^\//, ""),
    };
  }
  if (payload.tool_name === "SubagentHandback")
    return subagent(payload, at, harness, input.message);
  return undefined;
}

/** SubagentStop: the finished subagent, with the count when its last message carries it. */
export function recordFromSubagentStop(
  stdin: string,
  at: string,
  harness: string,
): SkillRunEvent | undefined {
  const payload = parse(stdin);
  if (payload === undefined) return undefined;
  return subagent(payload, at, harness, payload.last_assistant_message);
}

/** UserPromptSubmit: the `/name` the prompt starts with, if any. */
export function recordFromPrompt(
  stdin: string,
  at: string,
  harness: string,
): SkillRunEvent | undefined {
  const payload = parse(stdin);
  if (payload === undefined || !text(payload.session_id) || typeof payload.prompt !== "string") {
    return undefined;
  }
  const command = commandOf(payload.prompt);
  if (command === undefined) return undefined;
  return { at, session: payload.session_id, harness, kind: "skill", name: command.slice(1) };
}
