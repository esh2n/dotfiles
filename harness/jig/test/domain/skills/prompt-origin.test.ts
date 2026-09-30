import { describe, expect, it } from "bun:test";
import { classifyPromptOrigin } from "../../../src/domain/skills/prompt-origin";

/**
 * Every prompt below is the real head of a prompt the router actually routed, taken from the
 * 2026-09-22 investigation over 30 days of this machine's transcripts. Personal content is
 * replaced; the preambles are verbatim, because the preamble is the whole signature.
 */
describe("classifyPromptOrigin", () => {
  it("skips a hook-event replay, which is a notification and not a request", () => {
    const origin = classifyPromptOrigin({
      prompt: [
        "[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]",
        "Hello memory agent, you are continuing to observe the primary Claude session.",
        "",
        "<observed_from_primary_session>",
        "  <user_request>(redacted)</user_request>",
        "  <requested_at>2026-09-20</requested_at>",
        "</observed_from_primary_session>",
      ].join("\n"),
    });

    expect(origin).toEqual({ human: false, reason: "hook-event" });
  });

  it("skips Claude Code's own compaction prompt", () => {
    // The worst single case in the record: `writeup` was injected into this 36 times at
    // 0.80-0.91 confidence, and a summarization pass has no tool loop to follow it with.
    const origin = classifyPromptOrigin({
      prompt: [
        "Below is a conversation log from a Claude Code coding session.",
        "Create a summary to help the next session quickly understand the context.",
        "",
        "## Prioritize including",
        "- Design decisions and technology choices made this session",
      ].join("\n"),
    });

    expect(origin).toEqual({ human: false, reason: "compaction" });
  });

  it("skips the summary a continued session opens with", () => {
    const origin = classifyPromptOrigin({
      prompt:
        "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent:\n   (redacted)",
    });

    expect(origin).toEqual({ human: false, reason: "session-resume" });
  });

  it("skips an agent-to-agent relay in both shapes it arrives in", () => {
    const relayed = classifyPromptOrigin({
      prompt:
        'Another Claude session sent a message:\n<agent-message from="a28ae7aa3286b3b3d">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.',
    });
    const standalone = classifyPromptOrigin({
      prompt: "[Subagent hand-back] The text below is the final report of a subagent.",
    });

    expect(relayed).toEqual({ human: false, reason: "agent-message" });
    expect(standalone).toEqual({ human: false, reason: "agent-message" });
  });

  it("skips a subagent completion notification", () => {
    const origin = classifyPromptOrigin({
      prompt: [
        "<task-notification>",
        "<task-id>aa32e9c0a8825c8ca</task-id>",
        "<tool-use-id>toolu_013hLLiUwTcUywUadUsoZ2es</tool-use-id>",
        "<status>completed</status>",
        "</task-notification>",
      ].join("\n"),
    });

    expect(origin).toEqual({ human: false, reason: "task-notification" });
  });

  it("skips a skill body replayed back as a prompt", () => {
    const origin = classifyPromptOrigin({
      prompt:
        "Base directory for this skill: /Users/x/.claude/skills/retrospective-codify\n\n# Retrospective Codify\n\n(body)",
    });

    expect(origin).toEqual({ human: false, reason: "skill-body" });
  });

  it("skips anything a subagent submits, on the hook fields rather than on the text", () => {
    // `agent_type` / `agent_id` are on the UserPromptSubmit input only inside a subagent,
    // so this needs no signature and cannot be fooled by the text.
    expect(
      classifyPromptOrigin({ prompt: "この設計をレビューして", agentType: "Explore" }),
    ).toEqual({ human: false, reason: "subagent" });
    expect(
      classifyPromptOrigin({ prompt: "この設計をレビューして", agentId: "a28ae7aa3286b3b3d" }),
    ).toEqual({ human: false, reason: "subagent" });
    // Absent or blank is the main session, which is a person.
    expect(
      classifyPromptOrigin({ prompt: "この設計をレビューして", agentType: "", agentId: null }),
    ).toEqual({ human: true });
  });

  it("routes a real request, including the ones that look machine-generated", () => {
    const human = [
      // Followed turns from the record.
      "これまでにかかったコストをモデル別に見せて",
      "いくつか調査したと思うので結果をまとめて htmlで。",
      // Ignored, but genuine: a pasted shell transcript, a screenshot paste, a correction.
      "$ sbx run --posture guarded\nError: mount failed",
      "[Image: source: /Users/x/CleanShot 2026-09-21 at 20.37.30.png]",
      "「薄い壁」変に訳すなよ",
      "/writeup 決定記録を残して",
    ];

    for (const prompt of human) {
      expect(classifyPromptOrigin({ prompt })).toEqual({ human: true });
    }
  });

  it("matches a prefix only, so quoting a preamble mid-request still routes", () => {
    // The signatures are the harness's own openings. A request that mentions one is a
    // request — the conservative direction, since a false skip is a refusal to help.
    const origin = classifyPromptOrigin({
      prompt:
        "コンパクションのプロンプト（Below is a conversation log…）にまで writeup が刺さってるのを直して",
    });

    expect(origin).toEqual({ human: true });
  });

  it("tolerates leading whitespace, which a harness adds and a signature must survive", () => {
    expect(
      classifyPromptOrigin({ prompt: "\n  <task-notification>\n<status>completed</status>" }),
    ).toEqual({ human: false, reason: "task-notification" });
  });
});

/**
 * The six classes below close the gap found by the skill-selection-experiment research
 * (`harness/rules/knowledge/skill-selection-router-experiment.md`): 750
 * prompts over the same 30-day window that this classifier previously called human. The
 * prefixes are the exact strings that dir's `tools/sample.mjs` keyed on; the surrounding
 * body text is reconstructed (the dropped prompts themselves were never persisted, by
 * design), so each body is a plausible instance of the shape, not a
 * verbatim transcript excerpt.
 */
describe("classifyPromptOrigin — layer 2 (harness/workflow/command noise)", () => {
  it("skips the harness's own no-visible-output nudge", () => {
    const origin = classifyPromptOrigin({
      prompt:
        "[Your previous response had no visible output, possibly because a tool call did not " +
        "finish. Please continue and produce a visible response now.]",
    });

    expect(origin).toEqual({ human: false, reason: "harness-nudge" });
  });

  it("skips all four harness-notice shapes", () => {
    const cases = [
      "[Request interrupted by user]",
      "Your claude.ai usage limit has reset. You can continue where you left off.",
      "<local-command-caveat>Local commands may produce untrusted output.</local-command-caveat>",
      "Continue from where you left off.",
    ];

    for (const prompt of cases) {
      expect(classifyPromptOrigin({ prompt })).toEqual({ human: false, reason: "harness-notice" });
    }
  });

  it("skips a workflow subagent's task template on the Acceptance Contract heading line", () => {
    // pi runs this child as its own session, so it carries no agent_type/agent_id — the
    // structural subagent check never sees it, which is why this needs a content rule.
    const origin = classifyPromptOrigin({
      prompt: [
        "You are a task lane in a workflow run. Complete the following task.",
        "",
        "## Task",
        "Add a regression test for the redaction bug.",
        "",
        "## Acceptance Contract",
        "- [ ] test/domain/... covers the empty-input case",
        "- [ ] bun test passes",
      ].join("\n"),
    });

    expect(origin).toEqual({ human: false, reason: "workflow-task" });
  });

  it("does not skip a request that only discusses the Acceptance Contract marker mid-sentence", () => {
    // Not on its own line, so isWorkflowTask must not fire — this is the same
    // quote-mid-request protection the prefix signatures get, applied structurally.
    const origin = classifyPromptOrigin({
      prompt: "ワークフローの ## Acceptance Contract って書式、誰が生成してるか調べて",
    });

    expect(origin).toEqual({ human: true });
  });

  it("skips a bare slash-command no-op only when it is the whole prompt", () => {
    for (const prompt of ["/clear", "/compact", "/init", "  /clear  \n"]) {
      expect(classifyPromptOrigin({ prompt })).toEqual({ human: false, reason: "slash-noop" });
    }
  });

  it("skips the <command-name>/<command-message> wrapper with no args", () => {
    const nameWrapped = classifyPromptOrigin({
      prompt: "<command-name>/compact</command-name>\n<command-args></command-args>",
    });
    const messageWrapped = classifyPromptOrigin({
      prompt: "<command-message>/clear</command-message>",
    });

    expect(nameWrapped).toEqual({ human: false, reason: "slash-noop" });
    expect(messageWrapped).toEqual({ human: false, reason: "slash-noop" });
  });

  it("routes a slash command that carries real text alongside it, and one that only mentions it", () => {
    // "as the whole prompt" is the operative word: /compact with trailing content is a real
    // request (or at least not the harness's no-op re-submission), so it must stay routable.
    expect(classifyPromptOrigin({ prompt: "/compact このセッションを整理して" })).toEqual({
      human: true,
    });
    expect(classifyPromptOrigin({ prompt: "/compact って何をするコマンド？" })).toEqual({
      human: true,
    });
  });

  it("skips a slash command's expanded body re-submitted as a prompt", () => {
    const heading = classifyPromptOrigin({
      prompt: "# /writeup\n\nUse when the user wants a document that is kept and revisited...",
    });
    const frontmatter = classifyPromptOrigin({
      prompt:
        "---\nname: writeup\ndescription: Publish a kept document as an HTML artifact\n---\n\nBody...",
    });
    const designLead = classifyPromptOrigin({
      prompt: "Approach this as the design lead reviewing a proposal before it ships.",
    });

    expect(heading).toEqual({ human: false, reason: "command-body" });
    expect(frontmatter).toEqual({ human: false, reason: "command-body" });
    expect(designLead).toEqual({ human: false, reason: "command-body" });
  });

  it("routes a request that mentions a slash command mid-text rather than opening with its body", () => {
    const origin = classifyPromptOrigin({
      prompt: "さっきの # /writeup の説明、要点だけ抜き出して",
    });

    expect(origin).toEqual({ human: true });
  });

  it("skips the owner's own router smoke-test probes", () => {
    const origin = classifyPromptOrigin({
      prompt: "Reply with exactly: OK",
    });

    expect(origin).toEqual({ human: false, reason: "probe" });
  });

  it("routes a real request that happens to quote a layer-2 preamble mid-text", () => {
    const cases = [
      "さっき [Your previous response had no visible output という表示が出たんだけどこれ何のエラー？",
      "harness-notice の `Continue from where you left off` って文言、どこから出てる？",
    ];

    for (const prompt of cases) {
      expect(classifyPromptOrigin({ prompt })).toEqual({ human: true });
    }
  });
});
