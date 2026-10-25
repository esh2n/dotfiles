import { describe, expect, test } from "bun:test";
import {
  recordFromPostToolUse,
  recordFromPrompt,
  recordFromSubagentStop,
} from "../../src/cli/hooks/findings-record";

const AT = "2026-10-23T10:00:00.000Z";

// Shapes measured on Claude Code 2.1.309, 2026-10-23 (trimmed to the fields read).
const handback = JSON.stringify({
  session_id: "b5ed",
  agent_id: "ac80",
  agent_type: "code-reviewer",
  hook_event_name: "PostToolUse",
  tool_name: "SubagentHandback",
  tool_input: { message: "## Findings\n1. x\n\nFindings: 2" },
  tool_response: { success: true },
});
const subagentStop = JSON.stringify({
  session_id: "b5ed",
  agent_id: "ac80",
  agent_type: "code-reviewer",
  hook_event_name: "SubagentStop",
  last_assistant_message: "done",
  background_tasks: [],
});

describe("what the hooks record", () => {
  test("a Skill call is the skill's use", () => {
    const stdin = JSON.stringify({
      session_id: "b5ed",
      tool_name: "Skill",
      tool_input: { skill: "change-review" },
    });
    expect(recordFromPostToolUse(stdin, AT, "claude")).toEqual({
      at: AT,
      session: "b5ed",
      harness: "claude",
      kind: "skill",
      name: "change-review",
    });
  });

  test("a hand-back is the subagent's report, with its count", () => {
    expect(recordFromPostToolUse(handback, AT, "claude")).toEqual({
      at: AT,
      session: "b5ed",
      harness: "claude",
      kind: "subagent",
      agentType: "code-reviewer",
      agentId: "ac80",
      findings: 2,
    });
  });

  test("SubagentStop records the run; a closing text without the line has no count", () => {
    expect(recordFromSubagentStop(subagentStop, AT, "claude")).toEqual({
      at: AT,
      session: "b5ed",
      harness: "claude",
      kind: "subagent",
      agentType: "code-reviewer",
      agentId: "ac80",
    });
  });

  test("without a hand-back, SubagentStop's closing text is the report and its count is read", () => {
    const stop = (message: string): string =>
      JSON.stringify({ ...JSON.parse(subagentStop), last_assistant_message: message });
    expect(
      recordFromSubagentStop(stop("## Findings\n1. x\n\nFindings: 2"), AT, "claude"),
    ).toMatchObject({ agentId: "ac80", findings: 2 });
    expect(recordFromSubagentStop(stop("Findings: 0"), AT, "claude")).toMatchObject({
      findings: 0,
    });
  });

  test("an edit tool, a stop with no agent type and an unparseable payload record nothing", () => {
    expect(
      recordFromPostToolUse(JSON.stringify({ session_id: "s", tool_name: "Edit" }), AT, "claude"),
    ).toBeUndefined();
    expect(
      recordFromSubagentStop(JSON.stringify({ session_id: "s", agent_type: "" }), AT, "claude"),
    ).toBeUndefined();
    expect(recordFromPostToolUse("{", AT, "claude")).toBeUndefined();
  });

  test("a typed /skill is a use; a hand-back delivered as a prompt is not", () => {
    const typed = JSON.stringify({ session_id: "s", prompt: "/change-review the diff" });
    expect(recordFromPrompt(typed, AT, "claude")).toMatchObject({
      kind: "skill",
      name: "change-review",
    });
    const delivered = JSON.stringify({ session_id: "s", prompt: '<agent-message from="a">x' });
    expect(recordFromPrompt(delivered, AT, "claude")).toBeUndefined();
  });
});
