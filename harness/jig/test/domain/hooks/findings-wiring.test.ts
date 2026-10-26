import { describe, expect, test } from "bun:test";
import { buildClaudeHooks } from "../../../src/domain/claude/hooks";
import { missingFindingsHooks } from "../../../src/domain/hooks/findings-wiring";

const PATHS = { bun: "/abs/bun", jig: "/abs/jig/src/cli/jig.ts" };
const command = (sub: string) => `/abs/bun /abs/jig/src/cli/jig.ts hooks ${sub} --harness claude`;
const group = (sub: string, matcher?: string) => [
  {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command: command(sub) }],
  },
];

describe("whether the settings carry the findings recorders", () => {
  test("the hooks this jig writes lack nothing", () => {
    expect(missingFindingsHooks({ hooks: buildClaudeHooks(PATHS) })).toEqual([]);
  });

  test("settings from before the check lack the Skill matcher and SubagentStop", () => {
    const old = {
      hooks: {
        PostToolUse: group("post-tool-use-format", "Write|Edit|MultiEdit"),
        Stop: group("stop-gate"),
      },
    };
    expect(missingFindingsHooks(old)).toEqual([
      "PostToolUse Skill",
      "PostToolUse SubagentHandback",
      "SubagentStop",
    ]);
  });

  test("another program's SubagentStop hook does not count as jig's", () => {
    const settings = {
      hooks: {
        PostToolUse: group("post-tool-use-format", "Write|Edit|MultiEdit|Skill|SubagentHandback"),
        SubagentStop: [{ hooks: [{ type: "command", command: "/bin/sh other-hook.sh" }] }],
      },
    };
    expect(missingFindingsHooks(settings)).toEqual(["SubagentStop"]);
  });

  test("settings that are not an object are not judged", () => {
    expect(missingFindingsHooks(undefined)).toEqual([]);
    expect(missingFindingsHooks("x")).toEqual([]);
  });
});
