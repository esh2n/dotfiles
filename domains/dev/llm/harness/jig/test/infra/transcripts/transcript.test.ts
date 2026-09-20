import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscripts, parseSkillTurns } from "../../../src/infra/transcripts/transcript";

/** Every fixture below is the shape the harness actually writes, trimmed to what is read. */
const KNOWN = new Set(["writeup", "go-modern"]);

const CLAUDE_PROMPT =
  '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"決定記録としてまとめて"},"uuid":"u1","timestamp":"2026-09-20T01:00:00.000Z"}';

const CLAUDE_INJECTION =
  '{"parentUuid":"u1","isSidechain":false,"attachment":{"type":"hook_additional_context","content":["jig skill router: this request matches the \\"writeup\\" skill (judgment confidence 0.92).\\nRead /Users/x/.claude/.skills-merged/writeup/SKILL.md and follow it before doing the work."]},"type":"attachment","uuid":"a1","timestamp":"2026-09-20T01:00:01.000Z"}';

const CLAUDE_TOOL_RESULT =
  '{"parentUuid":"r1","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"body"}]},"uuid":"t1","timestamp":"2026-09-20T01:00:03.000Z"}';

function claudeRead(path: string, sidechain = false): string {
  return JSON.stringify({
    parentUuid: "a1",
    isSidechain: sidechain,
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path } }],
    },
    uuid: "r1",
    timestamp: "2026-09-20T01:00:02.000Z",
  });
}

const PI_SESSION =
  '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-20T02:00:00.000Z","cwd":"/repo"}';

const PI_PROMPT =
  '{"type":"message","id":"m1","parentId":"s1","timestamp":"2026-09-20T02:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"この記事を動画にして"}]}}';

const PI_INJECTION =
  '{"type":"custom_message","customType":"jig-skill-router","content":"jig skill router: this request matches the \\"go-modern\\" skill (judgment confidence 1.00).\\nRead /Users/x/.claude/.skills-merged/go-modern/SKILL.md and follow it before doing the work.","display":false,"id":"c1","parentId":"m1","timestamp":"2026-09-20T02:00:06.000Z"}';

/**
 * The list form the router writes now: one line per skill, strongest first. The single form
 * above stays a fixture, because sessions written before the router could name more than one
 * are still on disk and still being read.
 */
const PI_INJECTION_LIST = JSON.stringify({
  type: "custom_message",
  customType: "jig-skill-router",
  content: [
    "jig skill router: 2 skills match this request (judgment confidence 0.95, 0.81).",
    "Read and follow these before doing the work:",
    '- "writeup": /Users/x/.claude/.skills-merged/writeup/SKILL.md',
    '- "go-modern": /Users/x/.claude/.skills-merged/go-modern/SKILL.md',
  ].join("\n"),
  display: false,
  id: "c2",
  parentId: "m1",
  timestamp: "2026-09-20T02:00:06.000Z",
});

function piRead(path: string): string {
  return JSON.stringify({
    type: "message",
    id: "m2",
    parentId: "c1",
    timestamp: "2026-09-20T02:00:07.000Z",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path } }],
    },
  });
}

describe("parseSkillTurns", () => {
  it("reads a Claude Code turn: prompt, injected skill, opened body", () => {
    const text = [
      CLAUDE_PROMPT,
      CLAUDE_INJECTION,
      claudeRead("/Users/x/.claude/.skills-merged/writeup/SKILL.md"),
      CLAUDE_TOOL_RESULT,
    ].join("\n");

    const turns = parseSkillTurns(text, "/sessions/claude.jsonl", KNOWN);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.harness).toBe("claude");
    expect(turns[0]?.injected).toEqual(["writeup"]);
    expect(turns[0]?.confidence).toBe(0.92);
    expect(turns[0]?.read).toEqual(["writeup"]);
  });

  it("starts a new turn at the next prompt, not at a tool result", () => {
    const turns = parseSkillTurns(
      [CLAUDE_PROMPT, CLAUDE_INJECTION, CLAUDE_TOOL_RESULT, CLAUDE_PROMPT, CLAUDE_TOOL_RESULT].join(
        "\n",
      ),
      "/sessions/claude.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]?.injected).toEqual(["writeup"]);
    expect(turns[1]?.injected).toEqual([]);
    expect(turns[1]?.read).toEqual([]);
  });

  it("folds a subagent's read into the turn whose prompt caused it", () => {
    const turns = parseSkillTurns(
      [
        CLAUDE_PROMPT,
        CLAUDE_INJECTION,
        claudeRead("/Users/x/.claude/.skills-merged/go-modern/SKILL.md", true),
      ].join("\n"),
      "/sessions/claude.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.read).toEqual(["go-modern"]);
  });

  it("reads every skill of the list form, in order, with the strongest confidence", () => {
    const text = [
      PI_SESSION,
      PI_PROMPT,
      PI_INJECTION_LIST,
      piRead("/Users/x/.claude/.skills-merged/writeup/SKILL.md"),
      piRead("/Users/x/.claude/.skills-merged/go-modern/SKILL.md"),
    ].join("\n");

    const turns = parseSkillTurns(text, "/sessions/pi.jsonl", KNOWN);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.injected).toEqual(["writeup", "go-modern"]);
    expect(turns[0]?.confidence).toBeCloseTo(0.95);
    expect(turns[0]?.read).toEqual(["writeup", "go-modern"]);
  });
  it("reads a pi turn: prompt, injected skill, opened body through the repo path", () => {
    const text = [
      PI_SESSION,
      PI_PROMPT,
      PI_INJECTION,
      piRead("/Users/x/go/repo/domains/dev/config/claude-profiles/core/skills/go-modern/SKILL.md"),
    ].join("\n");

    const turns = parseSkillTurns(text, "/sessions/pi.jsonl", KNOWN);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.harness).toBe("pi");
    expect(turns[0]?.injected).toEqual(["go-modern"]);
    expect(turns[0]?.read).toEqual(["go-modern"]);
  });

  it("ignores a directory that is named skills but holds none", () => {
    const turns = parseSkillTurns(
      [PI_PROMPT, piRead("/repo/jig/src/infra/skills/catalog.ts")].join("\n"),
      "/sessions/pi.jsonl",
      KNOWN,
    );

    expect(turns[0]?.read).toEqual([]);
  });

  it("counts one skill once however many of its files the turn opens", () => {
    const turns = parseSkillTurns(
      [
        PI_PROMPT,
        PI_INJECTION,
        piRead("/Users/x/.claude/.skills-merged/go-modern/SKILL.md"),
        piRead("/Users/x/.claude/.skills-merged/go-modern/references/maps.md"),
      ].join("\n"),
      "/sessions/pi.jsonl",
      KNOWN,
    );

    expect(turns[0]?.read).toEqual(["go-modern"]);
  });

  it("accepts a prompt carried as a bare string", () => {
    const turns = parseSkillTurns(
      '{"type":"message","id":"m1","parentId":"s1","timestamp":"2026-09-20T02:00:05.000Z","message":{"role":"user","content":"続き"}}',
      "/sessions/pi.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(1);
  });

  it("does not start a turn at a tool result or a system note", () => {
    const turns = parseSkillTurns(
      [
        PI_PROMPT,
        '{"type":"message","id":"m3","parentId":"m2","timestamp":"2026-09-20T02:00:08.000Z","message":{"role":"toolResult","toolCallId":"call_1","content":[{"type":"text","text":"body"}]}}',
        '{"type":"custom","customType":"other","id":"m4","parentId":"m3","timestamp":"2026-09-20T02:00:09.000Z"}',
      ].join("\n"),
      "/sessions/pi.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(1);
  });

  it("files a line whose shape matches neither harness under unknown", () => {
    const turns = parseSkillTurns(
      '{"type":"other","message":{"role":"user","content":"hi"},"timestamp":"2026-09-20T03:00:00.000Z"}',
      "/sessions/other.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.harness).toBe("unknown");
  });

  it("skips malformed lines instead of failing the report", () => {
    const turns = parseSkillTurns(
      ["not json", "[]", "", PI_PROMPT].join("\n"),
      "/sessions/pi.jsonl",
      KNOWN,
    );

    expect(turns).toHaveLength(1);
  });

  it("reports nothing for a session with no prompt", () => {
    expect(parseSkillTurns(PI_SESSION, "/sessions/pi.jsonl", KNOWN)).toEqual([]);
  });
});

describe("findTranscripts", () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  it("walks nested session dirs, keeps .jsonl files, and skips stale ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-transcripts-"));
    roots.push(root);

    const fresh = join(root, "slug", "run-0", "session.jsonl");
    const stale = join(root, "slug", "old.jsonl");
    await mkdir(join(root, "slug", "run-0"), { recursive: true });
    await writeFile(fresh, PI_PROMPT);
    await writeFile(stale, PI_PROMPT);
    await writeFile(join(root, "slug", "notes.md"), "ignored");

    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const found = await findTranscripts([root, join(root, "missing")], { since });

    expect(found).toEqual([fresh]);
  });
});
