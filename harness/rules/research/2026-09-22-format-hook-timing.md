---
question: "When should format, lint, and type-check run in a coding-agent loop — per-edit hook, batched at end of turn, outside the agent loop entirely, or via LSP diagnostics — across Claude Code, Codex, pi, and DSH?"
date: 2026-09-22
verdict: "No option is vendor-mandated and no controlled measurement of tokens or wall-clock exists for any comparison; the evidence favors a hybrid per harness — silent per-edit autofix plus a Stop/end-of-turn gate for typecheck, lint, and tests is the most common verified public shape for Claude Code; Codex's own dogfooding runs format/lint by instruction rather than hooks; pi's per-edit hook is safer than Claude Code's by construction since pi's edit tool has no mtime staleness check; and DSH's Stop-equivalent hook has no consecutive-block cap, so any batched gate there must self-limit."
unverified:
  - "No controlled measurement of tokens or wall-clock for per-edit vs end-of-turn vs outside-the-loop vs LSP exists in any source reached"
  - "Community accounts on Reddit, X, or Medium were not reachable in this run — a gap, not a negative finding"
  - "pi and DSH have no public incident record on this question at all; their verdicts rest on reading their code, not on evidence of use"
  - "Whether Claude Code's 2.1.90 fix fully removes the same-turn stale-read error, or only when the formatter is a no-op, is unresolved — issue #3513 stays open"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# When should format / lint / type-check run in a coding-agent loop?

Research record, 2026-09-22. Options compared:

- **(A)** per-edit, PostToolUse-style hook
- **(B)** batched at end of turn (Stop / `agent_settled` / `agent/turn-stopping`)
- **(C)** outside the agent loop (pre-commit, CI, editor on save, or an instruction that the agent runs the tool itself)
- **(D)** language-server diagnostics pushed to the agent

Conventions: every claim carries a URL; verbatim quotes are in `>` blocks or quotation marks; `[unverified]` marks inference. Nothing below assumes an option is right. Sources fetched directly by me are marked **(direct)**; findings relayed by a delegated research lane and not independently re-fetched are marked **(lane)**. Where a lane's claim contradicted a direct fetch, the direct fetch wins and the discrepancy is noted.

---

## 1. Vendor guidance

### 1.1 Claude Code (Anthropic)

**Hooks guide — formatting example** (direct) https://code.claude.com/docs/en/hooks-guide

The guide's canonical example is option (A):

> ### Auto-format code after edits
> Automatically run Prettier on every file Claude edits, so formatting stays consistent without manual intervention.
> This hook uses the `PostToolUse` event with an `Edit|Write` matcher, so it runs only after file-editing tools. The command extracts the edited file path with `jq` and passes it to Prettier.

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Edit|Write",
  "hooks": [ { "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write" } ] } ] } }
```

> When the hook succeeds, Claude Code shows nothing in the conversation. To confirm the hook ran, check that the edited file is reformatted, or see Debug techniques.
> To reformat a specific file however it changes, including when a `Bash` command rewrites it, use a FileChanged hook instead.

Caveats the guide itself attaches (same page):

> Claude can also create or modify files by running shell commands. If your hook must see every file change, such as for compliance scanning or audit logging, add a `Stop` hook that scans the working tree once per turn. For per-call coverage instead, also match `Bash|PowerShell` and have your script list modified and untracked files with `git status --porcelain`.

> `Stop` hooks fire whenever Claude finishes responding, not only at task completion. They don't fire on user interrupts.

> `PostToolUse` hooks can't undo actions since the tool has already executed.

> Claude Code overrides a Stop hook after it blocks eight times in a row without progress. Your hook script needs to check whether it already triggered a continuation. Parse the `stop_hook_active` field from the JSON input and exit early if it's `true` ... If your hook legitimately needs more than eight iterations to converge, raise the cap with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.

The guide contains **no caveat** about a formatter hook invalidating the model's memory of file contents, and **no mention** of "file has been modified since read" (direct grep of the fetched page for `modified`, `re-read`, `stale`: zero hits in that sense).

**Hooks reference — what reaches the model** (direct, fetched `https://code.claude.com/docs/en/hooks.md`, 3,852 lines) https://code.claude.com/docs/en/hooks

Exit code 0 stdout (section "Exit code 0"):

> For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, where Claude Code adds plain-text stdout as context that Claude can see and act on.

> Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it. ... To surface a warning to Claude from a `PostToolUse` or `PostToolUseFailure` hook, exit 2 instead so Claude sees the stderr even though the tool already ran.

So a per-edit formatter that exits 0 costs **zero model tokens** (its output never enters context); a linter that exits 2 or returns JSON injects text. (Note: the vendor-docs lane reported "Plain-text stdout from this hook ... is added as a system message visible to Claude on exit 0" for PostToolUse; that contradicts the raw reference above and is treated as wrong.)

PostToolUse decision control (section "PostToolUse decision control"):

> `decision` — `"block"` adds the `reason` next to the tool result. Claude still sees the original output; to replace it, use `updatedToolOutput`
> `additionalContext` — String added to Claude's context alongside the tool result.
> `updatedToolOutput` — Replaces the tool's output with the provided value before it is sent to Claude.

Exit-code-2 table rows: `PostToolUse` — "No — Shows stderr to Claude; the tool already ran"; `Stop` — "Yes — Prevents Claude from stopping, continues the conversation"; `PostToolBatch` — "Yes — Stops the agentic loop before the next model call".

Concurrency of (A):

> `PostToolUse` fires once per tool, which means it fires concurrently when Claude makes parallel tool calls. `PostToolBatch` fires exactly once with the full batch, so it is the right place to inject context that depends on the set of tools that ran rather than on any single tool.

Coverage gap of (A):

> Claude Code doesn't run a `PostToolUse` hook matching `Edit|Write` when a `Bash` command or a process outside Claude Code rewrites the same file.

Stop input:

> Stop hooks receive `stop_hook_active`, `last_assistant_message`, `background_tasks`, and `session_crons`. The `stop_hook_active` field is `true` when Claude Code is already continuing as a result of a stop hook. Check this value or process the transcript to avoid blocking on a condition that will never resolve. Claude Code overrides the hook and ends the turn after 8 consecutive blocks.

> Use `additionalContext` when the hook is working as designed and giving Claude guidance, such as "run the test suite before finishing". It keeps the conversation going through the same loop protections as `decision: "block"`, namely the `stop_hook_active` input and the 8-consecutive-continuation cap, but the transcript labels it `Stop hook feedback` and no hook error notification is shown

Resume caveat for any context-injecting hook:

> For mid-session events like `PostToolUse` or `UserPromptSubmit`, when you resume with `--continue` or `--resume`, Claude Code replays the saved text rather than re-running the hook for past turns

The reference has **no sentence** about file freshness after a hook rewrites a file (direct grep for `modified since`, `re-read`, `stale`, `mtime`: only unrelated hits).

**Best practices** (direct) https://code.claude.com/docs/en/best-practices

The page frames verification as a gate the model reads, and names the Stop hook as the deterministic form:

> The check is anything that returns a signal Claude can read in the conversation: a test suite, a build exit code, a linter, a script that diffs output against a fixture ...
> **As a deterministic gate**: a Stop hook runs your check as a script and blocks the turn from ending until it passes. Claude Code overrides the hook and ends the turn after 8 consecutive blocks.

It also endorses per-edit lint as a prompt to write a hook, without saying which event:

> Claude can write hooks for you. Try prompts like *"Write a hook that runs eslint after every file edit"* or *"Write a hook that blocks writes to the migrations folder."*

CLAUDE.md example nudges option (C)-by-instruction for type-checking:

> - Be sure to typecheck when you're done making a series of code changes

And for typed languages it points to option (D):

> If you work with a typed language, install a code intelligence plugin to give Claude precise symbol navigation and automatic error detection after edits.

**Costs** (direct) https://code.claude.com/docs/en/costs

> ### Install code intelligence plugins for typed languages
> Code intelligence plugins give Claude precise symbol navigation instead of text-based search ... Installed language servers also report type errors automatically after edits, so Claude catches mistakes without running a compiler.

> ### Offload processing to hooks and skills
> Custom hooks can preprocess data before Claude sees it. Instead of Claude reading a 10,000-line log file to find errors, a hook can grep for `ERROR` and return only matching lines, reducing context from tens of thousands of tokens to hundreds.

No cost figure for hooks vs. LSP vs. manual runs is given anywhere on the page.

**Summary of Anthropic's position**: formatting → (A) is the documented example, silent on exit 0; type errors → (D) via LSP plugins; verification that must gate completion → (B) Stop hook or `/goal`. Anthropic never states a preference between (A) and (B) for formatters and never documents the read-before-edit interaction.

### 1.2 OpenAI Codex CLI

**Hooks doc** (direct; `https://developers.openai.com/codex/hooks` redirects to https://learn.chatgpt.com/docs/hooks)

Events: `PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, Stop` during a turn; `Interrupt`; `SessionStart, SubagentStart`; `SessionEnd`.

PostToolUse:

> PostToolUse runs after supported tools produce output, including Bash, apply_patch, MCP tool calls, and other local function tools. ... It can't undo side effects from a tool that already ran. ... For file edits through apply_patch, matcher values can use apply_patch, Edit, or Write; hook input still reports tool_name: "apply_patch".
> Plain text on stdout is ignored. JSON on stdout can use systemMessage and this hook-specific shape: `{ "decision": "block", "reason": ..., "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": ... } }` That additionalContext text is added as extra developer context. For this event, decision: "block" doesn't undo the completed Bash command. Instead, Codex records the feedback, replaces the tool result with that feedback, and continues the model from the hook-provided message.

Stop:

> Stop expects JSON on stdout when it exits 0. Plain text output is invalid for this event. ... To keep Codex going, return: `{ "decision": "block", "reason": "Run one more pass over the failing tests." }` ... it tells Codex to continue and automatically creates a new continuation prompt that acts as a new user prompt, using your reason as that prompt text.

Fields include `stop_hook_active` ("Whether this turn was already continued by Stop"). The doc has an `additionalContextLimit` field: "sets how much additionalContext a command hook can send to the model before Codex saves the full text to disk and sends a shorter preview instead." No formatter/linter example appears in the hooks doc (lane + direct grep for `format`/`lint`: only unrelated nav hits).

**AGENTS.md guidance page** (lane) https://developers.openai.com/codex/agents-md — example content for repo authors:

> "Always run `npm test` after modifying JavaScript files ..."
> "Run `npm run lint` before opening a pull request ..."

**Codex's own repo AGENTS.md** (direct) https://raw.githubusercontent.com/openai/codex/main/AGENTS.md

> Run `just fmt` (in the `codex-rs` directory) automatically after you have finished making code changes anywhere in this repository; do not ask for approval to run it. Additionally, run the tests:
> ...
> Before finalizing a large change to `codex-rs`, run `just fix -p <project>` (in `codex-rs` directory) to fix any linter issues in the code. Prefer scoping with `-p` to avoid slow workspace-wide Clippy builds; only run `just fix` without `-p` if you changed shared crates. Do not re-run tests after running `fix` or `fmt`.

So OpenAI's own dogfooding is option (C)-by-instruction: the *model* runs the formatter once "after you have finished making code changes", and lint "before finalizing", not a hook per edit.

### 1.3 Cursor

(direct) https://cursor.com/docs/agent/hooks

Intro lists "Run formatters after edits" as the first use case. Event:

> afterFileEdit — Fires after the Agent edits a file; useful for formatters or accounting of agent-written code.
> // Input `{ "file_path": "<absolute path>", "edits": [{ "old_string": "<search>", "new_string": "<replace>" }] }`

No output schema is documented for `afterFileEdit` (the docs show input only); the getting-started example wires `"afterFileEdit": [{ "command": "./hooks/format.sh" }]` whose script is `cat > /dev/null; exit 0`. The lane's statement that "the hook's response isn't fed back into the agent loop" is consistent with the absence of an output schema but not a verbatim doc sentence → [unverified].

Stop:

> stop — Called when the agent loop ends. Can optionally auto-submit a follow-up user message to keep iterating. // Input `{ "status": "completed" | "aborted" | "error", "loop_count": 0 }` // Output `{ "followup_message": "<message text>" }` ... When provided and non-empty, Cursor will automatically submit it as the next user message.

> loop_limit — Per-script loop limit for stop/subagentStop hooks. null means no limit. Default is 5 for Cursor hooks, null for Claude Code hooks.

Cursor's position: (A) for formatters explicitly, fire-and-forget; (B) exists for "keep iterating" loops with a default cap of 5.

### 1.4 OpenCode

**Formatters** (direct) https://opencode.ai/docs/formatters/

> OpenCode can format files after they are written or edited using language-specific formatters. Formatters are disabled by default; enable them in your config before OpenCode will run them.
> How it works — When OpenCode writes or edits a file and formatters are enabled, it: Checks the file extension against all enabled formatters. Runs the appropriate formatter command on the file. Applies the formatting changes. This process happens in the background for enabled formatters.

Built-ins listed (lane): prettier, biome, oxfmt, ruff, uv, gofmt, rustfmt/cargofmt, rubocop, standardrb, pint, zig, … OpenCode is the only harness with a first-class (A) formatter, and it ships **off by default** (the page says so verbatim).

**LSP** (direct) https://opencode.ai/docs/lsp/

> LSP is disabled by default. When enabled, servers start when one of the above file extensions is detected and the requirements are met.
> Best Practices — LSP can help the agent find and fix issues by providing diagnostics from language servers. This is useful in some projects, but it is not always a net positive. Language servers can get out of sync, use significant memory, vary by version or project, and slow down agent workflows. In many projects it is better to have the agent run lint, typecheck, or other diagnostic CLI tools directly, so errors are fed back into the agent loop without those tradeoffs. Document those commands in instruction files such as AGENTS.md or skills so the agent knows what to run. Enable LSP when your project benefits from additional language-server feedback.

This is the only vendor text found that argues (C)-by-instruction over (D) on the record.

Plugin hooks (lane) https://opencode.ai/docs/plugins/ — `tool.execute.before`, `tool.execute.after`, and `session.idle` events exist; the docs example for `session.idle` is a desktop notification, not a formatter.

### 1.5 Gemini CLI

(direct) https://geminicli.com/docs/hooks/

Event table rows: `AfterTool — After a tool executes — Block Result / Context — Process results, run tests, hide results`; `AfterAgent — When agent loop ends — Retry / Halt — Review output, force retry or halt execution`. Output handling: "If stdout contains non-JSON text, parsing will fail. The CLI will default to 'Allow' and treat the entire output as a systemMessage." No formatter example on the page (grep `format`/`lint`: none). Gemini offers both per-tool and end-of-loop events; the docs are silent on which to use for formatting.

### 1.6 pi (earendil-works/pi-mono, formerly badlogic/pi-mono)

Local install inspected: `@earendil-works/pi-coding-agent` 0.85.1, `docs/extensions.md` (same file as https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) (direct).

Lifecycle (verbatim from the ASCII diagram):

```
LLM responds, may call tools:
  ├─► tool_execution_start
  ├─► tool_call (can block)
  ├─► tool_execution_update
  ├─► tool_result (can modify)
  └─► tool_execution_end
└─► turn_end
├─► agent_end
└─► agent_settled (no retry/compaction/follow-up left)
```

> `tool_result` — Fired after tool execution finishes and before `tool_execution_end` plus the final tool result message events are emitted. **Can modify result.** In parallel tool mode, `tool_result` and `tool_execution_end` may interleave in tool completion order ... Handlers can return partial patches (`content`, `details`, `isError`, or `usage`)

> `agent_start` fires when a low-level agent run begins. `agent_end` fires when that run ends, but Pi may still auto-retry, auto-compact and retry, or continue with queued follow-up messages. Use `agent_settled` for status integrations that need to know Pi will not continue running automatically.

> `turn_end` — `event.turnIndex, event.message, event.toolResults`

So (A) maps to `tool_result` (can rewrite what the model sees), (B) maps to `turn_end` / `agent_end` / `agent_settled`. **No formatter or linter example exists** in `examples/extensions/` (direct grep for prettier/gofmt/rustfmt/eslint/tsc over 90+ example files: zero hits) and no maintainer stance on formatting hooks was found in docs, README, or the launch blog post (lane; https://mariozechner.at/posts/2025-11-30-pi-coding-agent/ "expresses no opinions on this topic"). The lane could not search GitHub discussions/X because its web-search budget was exhausted → stance is [not found], not "none".

pi's edit tool has **no read-before-edit or mtime check** (direct, `dist/core/tools/edit.js`, `edit-diff.js`): edits are exact `oldText` matches against the file *as currently on disk*, with fuzzy normalization ("Strip trailing whitespace from each line", NFKC, smart-quote/dash normalization). Consequence [inference]: a per-edit formatter cannot trigger a "modified since read" error in pi; it can only make a later `oldText` not match if the formatter changed more than trailing whitespace inside the quoted region, which then surfaces as a normal "text not found" tool error the model recovers from by re-reading.

### 1.7 DSH (DeepSeek Harness, `@deepseek-ai/dsh` 0.1.5-rc.2)

Repo: https://github.com/deepseek-ai/deepseek-harness (from `npm view @deepseek-ai/dsh repository.url`, direct). The vendor-docs lane could not locate DSH on its own; the facts below come from the locally installed packages under `~/.dsh/profiles/node_modules/@deepseek-ai/` (direct).

Extension points relevant here (from `@deepseek-ai/dsh-hooks-claude-code/README.md` and `lib/index.js`):

> Each supported event programs against one harness extension point: `SessionStart` emits context into the new session (`agent/session-start`), `UserPromptSubmit` and `PreToolUse` are waterfalls that can reject the incoming action (`agent/pre-step`, `tools/pre-execute`), `PostToolUse` is a waterfall that can block with feedback or add context to the downstream decision (`tools/post-execute`), and `Stop` is a serial listener whose blocking result forces another step through `steer()` (`agent/turn-stopping`).

So DSH has a native (A) seam `tools/post-execute` and a native (B) seam `agent/turn-stopping`, and a bridge that runs Claude-format `PostToolUse`/`Stop` command hooks on them. Limits documented in the same README:

> `PostToolUse` is partial — blocking feedback and JSON `additionalContext` work, but `updatedToolOutput` and `updatedMCPToolOutput` are unsupported and `tool_response` is flattened to text.
> `Stop` is partial — blocking forces another model turn, but `stop_hook_active` is always `false`, `last_assistant_message`, `background_tasks`, and `session_crons` are omitted, and **the consecutive-block cap is not implemented. An unconditionally blocking hook therefore force-continues every step unless it self-limits.**
> Unsupported hook events (23 of Claude Code's current 30) — ... `PostToolBatch`, ... `FileChanged`, ...

No built-in formatter or LSP/diagnostics package was found among the ~40 installed `@deepseek-ai/dsh-*` packages (direct `ls | grep -i 'format|lint|lsp|diagnos'`: none). The bridge does not surface `systemMessage`. DSH's tool names are `bash, write, edit, str_replace_editor` (from this repo's `~/.dsh/hooks.claude.json` comment, verified against the bridge source on 2026-09-21).

---

## 2. Evidence and incidents

### 2.1 The mechanism: Claude Code's Edit tool checks mtime, and per-edit formatters bump it

Claude Code's `Edit`/`Write` refuse to write a file whose on-disk state differs from the snapshot taken at the last `Read`; the error text is:

> `File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.`

(quoted in https://github.com/anthropics/claude-code/issues/3513, the canonical issue: **open since 2025-07-15, 21 comments, still OPEN on 2026-09-22** (direct `gh issue view`)).

A comment on #3513 (info618, 2026-05-26, direct) documents the exact chain with a per-edit formatter:

> ### Root cause: PostToolUse hooks rewrite the just-edited file
> The error message names the cause itself: *"either by the user or by a linter"*. In this case, the "linter" is the user's own `PostToolUse` hooks.
> ...
> 1. Model calls `Edit(file)` → harness writes content, mtime = **t₁**, harness records snapshot.
> 2. `PostToolUse` hooks fire → at least one rewrites the file → mtime = **t₂ > t₁**.
> 3. Model calls `Edit(file)` again → harness compares snapshot t₁ vs disk t₂ → **error**.
> The error fires both when the formatter actually changes bytes (legitimate, since the model's view of the file is now stale) **and** when the formatter is a no-op but `--write` touches mtime anyway (false positive — the model's view is still accurate).

Measured in that comment: "Scan of ~3 weeks of JSONL transcripts (2026-05-13 → 2026-05-25, single user): **22 sessions** hit [the error] mid-turn, blocking subsequent `Edit` calls until the file was re-`Read`." Each error costs one forced `Read` (the file re-enters context) before the retry.

The same commenter reports a partial mitigation he observed: after a hook touches a just-written file the model receives a reminder saying "Your next Edit will not fail with a stale-file error, but if its old_string targets a region the hook reformatted, Read the file first." He attributes it to Anthropic; the reminder's prefix (`PostToolUse:Write hook additional context:`) is the format Claude Code uses to render a *user hook's* `additionalContext`, so the attribution is [ambiguous] — it may be his own hook. What is certain is the CHANGELOG entry below.

Other quantified reports in the same bug family (lane; states re-verified directly):

| Issue | Number / claim (verbatim) | State |
|---|---|---|
| [#76361](https://github.com/anthropics/claude-code/issues/76361) "Edit tool read-state resets — 231 failed Edit calls in 17 days" | corroborating comment (direct): "across 75 main-session transcripts (15,452 tool calls, 2,280 Edits), Edit failed 169 times; the failure taxonomy is `{112 "File has not been read yet", 29 modified-since-read, 15 string-not-found, 11 symlink, 2 not-unique}`". So the *modified-since-read* class (the one a formatter hook causes) was 29 / 2,280 = 1.3 % of Edits for that user; the larger class (112) is read-state loss from branch switch / compaction / parallel sessions, unrelated to hooks. | closed by inactivity bot 2026-09-03 |
| [#46968](https://github.com/anthropics/claude-code/issues/46968) "Sub-agent inefficiency: repeated file read/write retries waste 100K+ tokens" | "Agent 2: 101,646 tokens, 30 tool calls, 21 min" on stale-file retries | closed as dup of #3513 |
| [#65575](https://github.com/anthropics/claude-code/issues/65575) "Edit staleness check fires after own git commit when pre-commit formatter touches unrelated lines" | the option-(C) pre-commit variant of the same failure: the commit's formatter bumps mtime on files the model had read | closed by inactivity bot 2026-07-11 |
| [#48390](https://github.com/anthropics/claude-code/issues/48390) | commenter: "~30 seconds of overhead per edit cycle" | closed by inactivity bot |
| [#25623](https://github.com/anthropics/claude-code/issues/25623) | confirms detection is **mtime-based, not content-hash** (IDE autosave false positives) | closed stale |
| [#43410](https://github.com/anthropics/claude-code/issues/43410) "File change system-reminders inject full file contents repeatedly, context grows to 692K tokens" | when *something else* (a linter, git) modifies read files, Claude Code injects `<system-reminder>` blocks carrying file contents; "context grew 50K → 692K tokens over 923 messages" | closed 2026-04-04 |

**Official fixes, from the CHANGELOG** (direct, https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md, mapped to version headers):

- **2.1.89** — "Improved Bash tool to warn when a formatter/linter command modifies files you have previously read, preventing stale-edit errors"
- **2.1.90** — "Fixed `Edit`/`Write` failing with "File content has changed" when a PostToolUse format-on-save hook rewrites the file between consecutive edits"
- **2.1.126** — "Bounded total size of file-modified reminders when a linter touches many files at once"
- **2.1.143** — "Fixed stop hooks that block repeatedly looping forever — the turn now ends with a warning after 8 consecutive blocks (override via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`)"
- **2.1.111** — "Fixed LSP diagnostics from before an edit appearing after it, causing the model to re-read files it just edited"

So Anthropic's response to the (A) failure mode has been to patch the tool (treat the post-hook rewrite as part of the edit), not to change the documented recommendation. #3513 remaining open and #65575 (filed on 2.1.153, after the 2.1.90 fix) show the family is not closed: the fix covers the same-turn PostToolUse case, not formatters run by `git commit`, test runners, or other Bash commands [inference from issue dates vs. version].

### 2.2 Per-edit formatter interacting with LSP diagnostics (A × D)

https://github.com/anthropics/claude-code/issues/80267 "[BUG] LSP output displays stale diagnostics after out-of-band file writes (Bash, PostToolUse)" (direct). Maintainer bcherny, 2026-08-16:

> **PostToolUse formatter hook:** Writing the one-line `bad.ts` with a prettier hook that reformats it onto 12 lines still reported `[Line 1:114]` — the position from the pre-formatted content.
> **Confirmed / reproduced on 2.1.233.** This isn't a regression — diagnostics are currently only refreshed on Edit/Write tool calls, and the language server isn't told about changes made by shell commands or by hooks that rewrite the file after the tool ran. We agree it should be; the fix is to re-sync the [LSP]

Closed by the inactivity bot 2026-09-13 with no fix recorded. Combining (A) with (D) therefore yields diagnostics whose line numbers refer to the pre-format file.

### 2.3 Stop-hook loops (B failure mode)

- https://github.com/anthropics/claude-code/issues/78121 "Stop hook re-fires despite stop_hook_active: true, causing /goal loop to spin after completion" — "fired approximately 9 times in a row... burned roughly 20 minutes and 35K tokens of pure post-completion spin". Closed by maintainer as working-as-documented: `stop_hook_active` is a signal *to the hook*; the 8-consecutive-block cap is the safety valve (lane; state verified direct: CLOSED 2026-08-17).
- https://github.com/anthropics/claude-code/issues/94041 "Native /goal Stop hook re-fires indefinitely with no way to acknowledge a hold" — "re-fired at least 21 consecutive times"; **OPEN** (direct).

The cap exists only since 2.1.143; DSH's bridge documents that it has **no** such cap (§1.7).

### 2.4 marmelab/crm-builder: a documented A → B → gated-C migration with numbers

https://github.com/marmelab/crm-builder/blob/main/CHANGELOG.md (direct, `gh api`, 1,056 lines). The repo is a multi-agent Claude Code harness for building CRMs on top of `atomic-crm`, whose project settings ship a per-edit prettier hook.

**Phase 14** (test-4 forensic audit):

> - **Edit→prettier loop** cost 4+ min twice — atomic-crm's PostToolUse format hook reformats after every Edit, developer re-reads different bytes, confusion.

**Phase 19 — Prettier on Stop + remaining skill enforcement (2026-04-21)**:

> ### Replace atomic-crm's PostToolUse prettier with a Stop hook
> Atomic-crm's project-level `.claude/settings.json` had a `PostToolUse(Edit|Write|NotebookEdit)` hook running `format-file.sh` → `npx prettier --write "$file_path"` on every edit. Root cause of the edit/prettier loop observed in test 4 (dev-TASK-003 = 4m03s, dev-TASK-005 = 4m14s burning on this exact pattern): developer edits → hook silently reformats the file → developer re-reads different bytes than it wrote → doubts itself → re-edits → hook reformats → repeat.
> - **Disabled** atomic-crm's PostToolUse prettier hook. ...
> - **New SubagentStop hook** `prettier-on-stop.sh`: runs `npm run prettier` (check mode, not write) after DEVELOPER stops. Exit 2 + stderr ("Prettier check failed — run 'npm run prettier:apply' to fix formatting:") if not clean. Developer rewakes, runs prettier:apply, retries Stop.
> - **Fixed `app-variants/App.fakerest.tsx`** which had 2 prettier violations ... this was the source of the `[warn] src/App.tsx` noise that confused developer in test 4's dev-T003 and dev-T005 (they thought they had caused the warning and wasted time chasing it).

Note the design detail: the Stop hook runs prettier in **check** mode and makes the *model* apply it, so the model's view of the file never silently diverges from disk.

**Phase 21** headline numbers (same date; bundled with worktree isolation, skill enforcement and ticket-granularity changes, so **not attributable to the hook move alone**): baseline "35 min / $11.22 / 5 tickets / 14 dispatches / 0 skills / 6 stop-hook-errors" → after Phases 15–20 "31 min / $8.05 / 3 tickets / 10 dispatches / 4 skill invocations / 0 stop-hook-error" (lane; [confounded]).

**Phase 24 — (2026-04-23)**: the (B) hooks then caused a *different* waste — the model re-ran what the hook already ran:

> The real cause of the Bash budget blow-up: developer was running `make typecheck`, `npm run test:unit:app`, `npm run prettier` **even though the SubagentStop hooks already do that automatically**. The hooks run these after dev finishes and inject stderr back into the dev's context if they fail. Dev should trust the hook output, not re-run.
> New `block-bash-validation.sh` PreToolUse hook blocks: typecheck: `make typecheck`, `npm run typecheck`, `npx tsc`, `tsc --noEmit` ...

("each dev used 33 Bash ... the 20-25 wasted Bash were the dev redundantly running hook-owned commands.")

**Phase 34 (2026-04-28 → 05-04)**: moved again, from Stop to a single gate at the hand-off point:

> The previous validation chain fired on `SubagentStop / developer` after every dev pause regardless of intent. With peer-to-peer flow, devs pause many times per ticket (after each commit, after each reviewer reply) — the hooks fired redundantly and bloated wall-clock by 60-150s per pause.
> - **PreToolUse / SendMessage `validate-before-review.sh`** — replaces the 5 `SubagentStop` hooks. Fires exactly once per fix-cycle: when the developer is about to `SendMessage` a reviewer or merger. Runs typecheck + prettier + unit-app + unit-functions + e2e against the dev's worktree ... First failure exits 2 → SendMessage blocked → dev sees stderr as a `tool_use_error`.
> - **Per-worktree SHA cache** at `/tmp/validate-cache-<wt>.sha` short-circuits the chain when HEAD hasn't moved.

Also relevant for (C)-in-a-shared-tree: Phase 22 moved to per-ticket worktrees partly because "20+ unrelated files reformatted on `master` when a developer ran `npm run prettier:apply` without `cd` prefix."

This is the only public source found with a before/after on this exact question. Its trajectory: per-edit (A) → per-stop check-mode (B) → once-per-handoff gate with a content-hash cache (a (B)/(C) hybrid), each step driven by measured minutes, not principle.

### 2.5 Other public accounts

Thin. The incidents lane had no web-search budget; it reached HN via the Algolia API and dev.to via its tag feed only. One HN comment endorses (A): https://news.ycombinator.com/item?id=46525135 (2026-01-07) "The PostToolUse hook tip for formatting Claude's code is the only actual tip here." No blog/Reddit/X account of switching A→B or A→C with numbers was reached. **This is a gap, not a negative finding.**

### 2.6 What no source measured

No source gives tokens-per-formatter-hook, or a controlled A-vs-B-vs-C comparison. The closest numbers are: marmelab's two 4-minute loops (A), 29 modified-since-read failures in 2,280 Edits (1.3 %) for one user in #76361 (not all hook-caused), 101k tokens in one subagent retry loop (#46968), and 35k tokens / 20 min of Stop-hook spin (#78121).

---

## 3. In the wild (public GitHub, `gh search code`, 2026-09-22)

Method (lane, authenticated `gh`): `gh api search/code` `total_count` per query; samples hand-verified by fetching raw file content. Two methodology facts the lane established empirically: (1) the `path:.claude/settings.json` qualifier returns near-zero results in the legacy code-search backend; the working form is `filename:settings.json path:.claude`; (2) `code_search` has its own 10 requests/min bucket. Counts are approximate, exclude forks, and — because `path:.claude` matches any file under `.claude/` — **count word co-occurrence, not verified hook wiring**. Treat them as upper bounds with unknown noise; the sample tables are the reliable part.

### 3.1 Per-edit formatter / linter / type-check hooks (option A)

| query | total_count |
|---|---|
| `PostToolUse prettier filename:settings.json path:.claude` | 1,306 |
| `PostToolUse prettier filename:settings.json` | 1,724 (+101 in `settings.local.json`) |
| `PostToolUse prettier path:.claude` | 3,912 |
| `PostToolUse eslint path:.claude` | 5,936 |
| `PostToolUse biome path:.claude` | 1,312 |
| `PostToolUse black path:.claude` / `ruff` | 1,234 / 3,432 |
| `PostToolUse gofmt path:.claude` / `rustfmt` / `"cargo fmt"` | 822 / 446 / 547 |
| `PostToolUse tsc path:.claude` / `pyright` / `mypy` | 3,736 / 740 / 900 |

The lane opened 10/10 top hits of the first query and all genuinely wire a per-edit formatter. Hand-verified sample (stars / last push from `gh repo view`; command quoted from the file):

| repo | stars | pushed | hook command |
|---|---|---|---|
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action/blob/main/.claude/settings.json) | 8,921 | 2026-09-19 | `bunx prettier@3.5.3 --no-config --write .` on `Edit\|Write\|MultiEdit` (**Anthropic's own repo**; formats the whole tree per edit — re-verified direct) |
| [wealthfolio/wealthfolio](https://github.com/wealthfolio/wealthfolio) | 9,019 | 2026-09-21 | inline: `.rs` → `rustfmt --edition 2021`, `.ts/tsx/js/jsx/css/md` → `npx prettier --write` |
| [TalAter/annyang](https://github.com/TalAter/annyang) | 6,817 | 2026-08-05 | `jq -r '.tool_input.file_path' \| xargs pnpm prettier --write 2>/dev/null; exit 0` |
| [Shelf-nu/shelf.nu](https://github.com/Shelf-nu/shelf.nu) | 3,017 | 2026-09-21 | `npx prettier --write "$FILE_PATH"` |
| [Quenty/NevermoreEngine](https://github.com/Quenty/NevermoreEngine) | 612 | 2026-09-21 | `node .claude/hooks/stylua-format.mjs` + `node .claude/hooks/prettier-format.mjs` |
| [adaline/gateway](https://github.com/adaline/gateway) | 607 | 2026-07-29 | jq → extension filter → `npx prettier --write '{}'` |
| [podman-desktop/extension-bootc](https://github.com/podman-desktop/extension-bootc) | 474 | 2026-09-22 | `biome format --write` + `prettier --cache --write` then a second entry `eslint --cache --fix` |
| [commercetools/ui-kit](https://github.com/commercetools/ui-kit) | 154 | 2026-09-12 | prettier routed by extension |
| [confluentinc/vscode](https://github.com/confluentinc/vscode) | 34 | 2026-09-21 | `jq -r '.tool_input.file_path' \| xargs npx prettier --write --ignore-unknown` |
| [marmelab/atomic-crm](https://github.com/marmelab/atomic-crm) | 1,265 | 2026-09-21 | counter-example: now `typescript-lsp@claude-plugins-official: true` and no PostToolUse prettier (this is the repo whose per-edit hook crm-builder disabled in §2.4) |

### 3.2 Stop-batched hooks (option B)

Raw counts (`Stop prettier path:.claude` 5,304; `Stop eslint` 14,048; `Stop tsc` 34,432; `Stop pytest` 24,064; `Stop "npm test"` 16,672; `Stop ruff` 8,336; `Stop "cargo clippy"` 2,456; `Stop "go vet"` 1,860) are **not usable**: "Stop" is a common word and the lane found the *majority* of opened hits did not invoke the tool from a Stop hook. Hand-verified sample:

| repo | stars | pushed | Stop hook | also per-edit? |
|---|---|---|---|---|
| [streamlit/streamlit](https://github.com/streamlit/streamlit/blob/develop/.claude/settings.json) | 45,812 | 2026-09-22 | `stop_check.sh`: guards on `stop_hook_active`, runs `FAST_CHECK=true make check`, on failure truncates output to the last 10,000 chars and returns `{"decision":"block","reason":...,"followup_message":...}` + exit 2 (Claude Code and Cursor compatible) (direct) | yes — `post_edit_autofix.sh`: `uv run ruff check --fix` + `ruff format` on `.py` only, with the comment "any additions must be very fast since this runs on every file edit/write" (direct) |
| [hexclave/hexclave](https://github.com/hexclave/hexclave) | 6,862 | 2026-09-22 | `pnpm run typecheck 1>&2 \|\| fail=1; pnpm run lint 1>&2 \|\| fail=1`, with an instruction not to fix unrelated pre-existing failures | yes — `pnpm run lint --fix` per edit |
| [uphy/obsidian-reminder](https://github.com/uphy/obsidian-reminder) | 662 | 2026-09-01 | `stop-check.sh` + reminders | yes — `post-edit-lint.sh` |
| [NikiforovAll/lazyclaude](https://github.com/NikiforovAll/lazyclaude) | 42 | 2026-03-22 | `quality-gates.sh --lint --format --mypy` | no (Stop-only) |
| [redpanda-data/ui-harness](https://github.com/redpanda-data/ui-harness) | 34 | 2026-07-15 | `biome-autofix.sh`, `typecheck-stop.sh`, `quality-gate-stop.sh`, `test-perf-stop.sh` | no (Stop-only) |
| [chartmogul/chartmogul-node](https://github.com/chartmogul/chartmogul-node) | 27 | 2026-09-18 | `stop-format.sh` (formatting deferred to Stop) | no |
| [dewet22/givenergy-modbus](https://github.com/dewet22/givenergy-modbus) | 27 | 2026-09-21 | Stop is `check-inbox.sh` (not lint) | yes — `ruff check --fix && ruff format` per edit |
| [adawalli/nexus](https://github.com/adawalli/nexus) | 23 | 2026-08-12 | `npm run type-check 2>&1 \| tail -20` | yes — prettier+eslint per edit |
| [CRJFisher/ariadne](https://github.com/CRJFisher/ariadne) | 22 | 2026-09-21 | six chained Stop hooks (`eslint_stop.ts`, `run_tests_stop.ts`, `build_stop.ts`, …) | no (Stop-only) |
| [ProjectSidewalk/SidewalkWebpage](https://github.com/ProjectSidewalk/SidewalkWebpage) | 106 | 2026-09-22 | narrow `comment-trim-check.sh` | PostToolUse style check |

Lane's directional read (≈20 repos opened, biased to top search hits): per-edit (A) is the dominant pattern **for formatting**; Stop (B) is used as an all-purpose pre-return gate (typecheck + lint + tests), rarely as the formatter itself; the **hybrid** — fast autofix per edit, heavier gate at Stop — appeared more often than either pure form.

### 3.3 `PostToolBatch` / `FileChanged`

Both are documented Claude Code events (hooks reference, §1.1) — the census lane's statement that they "are not real Claude Code hook events" is wrong. What the lane did establish: the 299 / 722 raw hits for those words under `path:.claude` contained **no literal use of either event** in the files it opened. So as of 2026-09-22 there is no observed public use of `PostToolBatch` (the once-per-batch point Anthropic says is "the right place to inject context that depends on the set of tools that ran") or `FileChanged` for formatting.

### 3.4 Repos documenting removal of a per-edit formatter

Only marmelab/crm-builder (§2.4) was found with an explicit written rationale. The lane's `gh search issues` for "PostToolUse" + "removed"/"too slow"/"infinite loop"/"modified since" returned noise it could not rank (see 3.6).

### 3.5 LSP plugins vs. command hooks for type errors

- Official marketplace (`anthropics/claude-plugins-official/.claude-plugin/marketplace.json`, [pinned commit](https://github.com/anthropics/claude-plugins-official/blob/c447c3207a425bc4e2a0d068435f64b0477ae981/.claude-plugin/marketplace.json)): 13 `*-lsp` plugins (clangd, csharp, gopls, jdtls, kotlin, liquid, lua, php, pyright, ruby, rust-analyzer, swift, typescript). **No formatter or linter plugin of any kind**, and no official plugin ships a `PostToolUse` formatter (`gh search code PostToolUse --repo anthropics/claude-plugins-official` hits only `hookify`, `security-guidance`, `claude-security`).
- Raw mentions: `pyright-lsp path:.claude` 908, `rust-analyzer-lsp` 628, `gopls-lsp` 600, `enabledPlugins lsp` 2,648. Caveat found by opening files: many settings carry `"typescript-lsp@claude-plugins-official": false` (scaffolded boilerplate); of 5 large repos opened (cypress-io/cypress, PostHog/posthog, mapbox/mapbox-gl-js, civitai/civitai, windmill-labs/windmill) **3 had it `true`, 2 `false`**.
- Per-edit `tsc` (3,736) / `mypy` (900) / `pyright` (740) command-hook mentions exceed LSP-plugin mentions, so (D) is a minority route next to command hooks for type errors [directional only, both sides noisy].
- The most-referenced hooks tutorial, [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery/blob/main/.claude/hooks/post_tool_use.py) (3,927 stars), ships a PostToolUse hook that is only a JSON logger — no formatter.

### 3.6 `--no-verify` bypass

- `gh search issues` cannot count this: a quoted `"--no-verify"` query returned `total_count: 1,319,795`, i.e. phrase semantics are not enforced for punctuation-heavy terms. No trustworthy count of "agent bypassed my pre-commit hook" complaints exists from this method.
- Blocker-side evidence is solid: `"--no-verify" PreToolUse path:.claude` = 1,640 hits; 15 opened, all real. Examples: [dwallet-labs/ika `.claude/hooks/git-guard.sh`](https://github.com/dwallet-labs/ika/blob/bcc2969d721bf41037eca26e6a0f7eedc0d5e650/.claude/hooks/git-guard.sh) (207 stars): `BLOCKED (git-guard): --no-verify skips git hooks — fix the hook failure instead`; [dartsim/dart `pre-commit-guard.sh`](https://github.com/dartsim/dart/blob/de0753f4b92d3b479da5ff5a50a6d239f15543a1/.claude/hooks/pre-commit-guard.sh) (1,207 stars) checks `--no-verify` and `-n`; [kronstadtsoft/biome-config `block-hook-bypass.ts`](https://github.com/kronstadtsoft/biome-config/blob/6b11ac2d874552e0fd810d4a2d967f6cee7af065/.claude/hooks/block-hook-bypass.ts) also blocks `core.hooksPath` and `HUSKY=0`; [tupe12334/block-no-verify](https://github.com/tupe12334/block-no-verify) PR #90 "strip heredoc bodies before scanning for --no-verify" shows iteration against real evasions. Inference: enough agents reach for `--no-verify` when a pre-commit (option C) gate fails that a small ecosystem of PreToolUse blockers exists; this is the documented failure mode of (C) [evidence is blocker-side only].

### 3.7 Limitations of this census

Legacy code-search index (default branch, size limits, stale for recent pushes); forks excluded; template duplication (many identical `jq … | xargs npx prettier --write` one-liners) overstates independent decisions; word-level matching inflates every count; samples are top-of-ranking, not random.

---

## 4. The LSP route (D)

(lane, with the docs quotes cross-checked against my own fetch of discover-plugins)

**Official plugins** https://code.claude.com/docs/en/discover-plugins#code-intelligence — 11 languages: C/C++ `clangd-lsp`, C# `csharp-lsp`, Go `gopls-lsp`, Java `jdtls-lsp`, Kotlin `kotlin-lsp`, Lua `lua-lsp`, PHP `php-lsp`, Python `pyright-lsp`, Rust `rust-analyzer-lsp`, Swift `swift-lsp`, TypeScript `typescript-lsp` (plus `ruby-lsp` in the repo ahead of the docs, per lane). Verbatim (direct):

> **Automatic diagnostics**: after every file edit Claude makes, the language server reports errors and warnings back, so Claude sees type errors, missing imports, and syntax issues without running a compiler or linter. If Claude introduces an error, it notices and fixes it in the same turn.
> In cloud sessions, Claude Code doesn't start plugin language servers, so Claude doesn't get the LSP tool there.
> **High memory usage**: language servers like `rust-analyzer` and `pyright` can consume significant memory on large projects.
> **False positive diagnostics in monorepos**: language servers may report unresolved import errors for internal packages if the workspace isn't configured correctly. These don't affect Claude's ability to edit code.

**Plugins reference** (lane) https://code.claude.com/docs/en/plugins-reference — LSP config has a `diagnostics` flag:

> `diagnostics` — Whether to push diagnostics into Claude's context after edits (default `true`). Set to `false` to keep code navigation but suppress automatic diagnostic injection
> When `diagnostics` is enabled (default), Claude Code automatically injects diagnostic information into the conversation context after edits. You'll see messages like: `Found 3 new diagnostic issues:` ...

The official plugins' `lspServers` config lives in the marketplace manifest (lane, `gh api` on https://github.com/anthropics/claude-plugins-official `.claude-plugin/marketplace.json`): `typescript-lsp` → `typescript-language-server --stdio`; `pyright-lsp` → `pyright-langserver --stdio`. **No official plugin ships a formatter hook, and no eslint-language-server or ruff-server plugin exists** in the official marketplace (lane grep of marketplace.json for `eslint|ruff|linter|format`: none). So (D) as shipped covers type/syntax errors, not formatting or lint rules, unless the user writes a custom LSP plugin.

**CHANGELOG entries** (lane, `gh api repos/anthropics/claude-code/contents/CHANGELOG.md`) https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md — relevant verbatim lines:

- "Added LSP (Language Server Protocol) tool for code intelligence features like go-to-definition, find references, and hover documentation"
- "Fixed LSP diagnostics from before an edit appearing after it, causing the model to re-read files it just edited"
- "Fixed a memory leak where LSP diagnostic data was never cleaned up after delivery, causing unbounded memory growth in long sessions"
- "Fixed a per-turn slowdown when a language server publishes project-wide diagnostics for thousands of files"
- "Fixed several memory leaks in long sessions: ... LSP documents staying open indefinitely (now LRU with 50-doc cap) ..."
- "Added `--bare` flag for scripted `-p` calls — skips hooks, LSP, plugin sync, and skill directory walks"

**Open/closed issues on diagnostics** (lane, `gh search issues --repo anthropics/claude-code`):

| # | Title / symptom | State |
|---|---|---|
| [#95507](https://github.com/anthropics/claude-code/issues/95507) | "LSP: hint-severity (tagged unnecessary) diagnostics are pushed into model context as new-diagnostics — token waste, no way to filter." — "every Edit/Write of a Python file pushes hint-severity diagnostics into the model context as `<new-diagnostics>` system reminders" | open |
| [#93321](https://github.com/anthropics/claude-code/issues/93321) | "LSP diagnostics are never awaited after Edit/Write" — "diagnostics for a file the model just edited arrive after that edit's tool result has already been sealed, and get flushed onto a later tool result or the next user turn" | open |
| [#79744](https://github.com/anthropics/claude-code/issues/79744) | "Interactive LSP client never sends didChange after Edit-tool writes — server buffers stay frozen" | open |
| [#64238](https://github.com/anthropics/claude-code/issues/64238) | "Decouple LSP diagnostic auto-push from the LSP tool" — "The auto-push can flood the context window." Maintainer: set `"diagnostics": false` | closed (shipped) |
| [#50224](https://github.com/anthropics/claude-code/issues/50224) | "LSP diagnostics leak across sibling git worktrees" — "The project's `tsc --noEmit` passes cleanly; the errors are purely an LSP-surface artifact." | closed stale |
| [#82416](https://github.com/anthropics/claude-code/issues/82416) | TypeScript LSP "wedges silently, returning empty results instead of errors" | open |
| [#93474](https://github.com/anthropics/claude-code/issues/93474), [#78604](https://github.com/anthropics/claude-code/issues/78604), [#16804](https://github.com/anthropics/claude-code/issues/16804) | official LSP plugins load zero servers / never send `didOpen` | open |

No issue was found describing LSP diagnostics *duplicating* a PostToolUse `tsc`/`eslint` hook (lane searched; negative).

**serena MCP** (lane) https://github.com/oraios/serena — exposes an on-demand diagnostics tool (visible in this session's tool list as `mcp__serena__get_diagnostics_for_file`); README describes LSP integration for "over 40 programming languages" [paraphrase]. Whether it runs automatically after edits could not be confirmed from the README; the tool name implies on-demand [unverified]. No formatter guidance in the README.

**Other harnesses**: OpenCode LSP — see 1.4 (off by default; docs recommend CLI tools instead in many projects). Codex CLI and Gemini CLI — lane grep of the source repos for "language server"/`publishDiagnostics`: no LSP-to-agent feature found [negative from source grep, not exhaustive]. pi — community extensions `@narumitw/pi-lsp`, `@spences10/pi-lsp` exist (lane, `gh search code "pi-lsp"`); not core-shipped; behavior not read.

**Measured cost/benefit of (D)**: none found beyond Anthropic's qualitative "without running a compiler" claim and OpenCode's qualitative "not always a net positive". No token or defect-rate numbers exist in any source reached.

---

## 5. Summary table and verdicts

### 5.1 Option table

| Option | Who recommends (docs) | Who uses (public GitHub, §3) | Measured cost / benefit | Failure modes on record |
|---|---|---|---|---|
| **(A) per-edit hook** (PostToolUse / afterFileEdit / tool_result / tools/post-execute) | Claude Code hooks-guide (canonical Prettier example); Cursor (`afterFileEdit` "useful for formatters"); OpenCode (built-in formatter, off by default). Anthropic best-practices suggests "a hook that runs eslint after every file edit" as a prompt. | §3.1 — the dominant public pattern for formatters (10/10 top hits verified; includes Anthropic's own `claude-code-action` repo, which runs `prettier --write .` on every edit). | Benefit: exit-0 formatter output costs zero context tokens in Claude Code (hooks ref, "Exit code 0"); per-file formatting is fast. Cost: no vendor figure. Field: marmelab two 4-min loops (Phase 14/19); 22 sessions in 3 weeks hit stale-read errors for one user (#3513 comment); each hit = one forced re-`Read`. | Stale-read errors on the next Edit (#3513 family; mitigated in 2.1.90 for the same-turn case); model "re-reads different bytes than it wrote → doubts itself → re-edits" (marmelab); no-op `--write` still bumps mtime; LSP diagnostics report pre-format line numbers (#80267, maintainer-confirmed, unfixed); does not fire for Bash-written files (hooks ref); fires concurrently on parallel edits (hooks ref); a linter that exits 2 per edit injects text on every edit [inference from exit-2 semantics]. |
| **(B) end-of-turn hook** (Stop / SubagentStop / agent_settled / agent/turn-stopping) | Claude Code best-practices names the Stop hook as "a deterministic gate" for checks; hooks-guide suggests a Stop hook that "scans the working tree once per turn" for full coverage; Codex Stop "creates a new continuation prompt"; Cursor `stop` with `followup_message` (loop limit 5). No vendor recommends Stop specifically for *formatting*. | §3.2 — used as a typecheck/lint/test gate; the hybrid (fast autofix per edit + gate at Stop, e.g. streamlit) was the most common shape in the sample. | Benefit: one run per turn; the model sees results as feedback and fixes in-loop; marmelab's check-mode variant keeps disk and model view in sync. Cost: a failing check triggers another model turn (Claude Code cap 8; Cursor 5; **DSH: no cap**); marmelab Phase 34: hooks "fired redundantly and bloated wall-clock by 60-150s per pause"; Phase 24: model re-ran hook-owned commands (20-25 wasted Bash calls per dev) until blocked. | Loops when the condition can't be met (#78121: 35k tokens / 20 min; #94041 open; 2.1.143 added the cap); Stop fires on *every* response including answers to questions (hooks-guide); a `--write` formatter at Stop re-creates the stale-view problem for the *next* turn [inference]; SubagentStop `stop_hook_active` is always false in DSH's bridge. |
| **(C) outside the loop** (pre-commit, CI, editor, or "run `just fmt` when done" in AGENTS.md/CLAUDE.md) | OpenAI's own `codex` AGENTS.md ("Run `just fmt` ... after you have finished making code changes ... Do not re-run tests after running `fix` or `fmt`"); Codex AGENTS.md guidance ("Run `npm run lint` before opening a pull request"); OpenCode LSP docs ("In many projects it is better to have the agent run lint, typecheck, or other diagnostic CLI tools directly ... Document those commands in ... AGENTS.md"); Claude Code CLAUDE.md example ("Be sure to typecheck when you're done making a series of code changes"). | §3.6 — not observable by code search except as CLAUDE.md/AGENTS.md text; 1,640 PreToolUse `--no-verify` blockers show the (C) gate being defended against bypass. | Benefit: no hook plumbing, no per-edit churn, formatter runs once on the final state. Cost: relies on the model obeying an instruction (advisory, per Anthropic best-practices: "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic"). No numbers found. | Pre-commit formatter touching read files triggers the same stale-read error (#65575); shared-tree formatter runs reformat unrelated files (marmelab Phase 22); agent may bypass with `--no-verify` (§3.6); nothing runs if the model forgets. |
| **(D) LSP diagnostics** | Claude Code costs + best-practices + discover-plugins ("report type errors automatically after edits, so Claude catches mistakes without running a compiler"); OpenCode ships it but says "not always a net positive". | §3.5 — LSP-plugin mentions (hundreds to ~2.6k, partly `false` boilerplate) are fewer than per-edit `tsc`/`mypy`/`pyright` command hooks; 3/5 large repos opened had `typescript-lsp` on. | Benefit: incremental, per-edit, no compiler run (qualitative only; no token/defect numbers anywhere). Cost: memory (docs); hint-noise tokens (#95507 open); `diagnostics:false` exists to stop the flood (#64238). | Diagnostics not awaited → land on a later turn (#93321 open); stale after Bash edits or after a per-edit formatter (#80267); server loads zero (#93474/#78604/#16804); silent empty results (#82416); worktree leakage (#50224); covers type/syntax errors only — **no official eslint/ruff LSP plugin**, so (D) does not replace formatting or lint rules. |

### 5.2 Verdicts per harness, for a solo developer

Each verdict states what it rests on and what is missing. None of the four options is vendor-mandated; the choice is an engineering trade-off with partial evidence.

**Claude Code.**
- *Formatting*: the documented per-edit Prettier hook (A) is cheap in tokens (silent on exit 0) but is the documented trigger of the still-open stale-read bug family and of the LSP line-number staleness; Anthropic patched the same-turn case in 2.1.90 rather than withdrawing the example. The evidence-backed alternative is marmelab's shape: **a Stop hook in check mode that exits 2 with the file list, letting the model apply the formatter itself**, or plain (C) — a CLAUDE.md line to run the formatter when done — accepting that it is advisory. If (A) is kept, the failure-mode data and the large-repo practice (streamlit: per-edit `ruff --fix`/`format` on the edited `.py` only, "must be very fast", exit 0; Anthropic's own `claude-code-action` formats the whole tree per edit, the pattern 2.1.126 had to bound) say: format only the edited file, keep the hook silent, and expect an occasional forced re-Read. The most common verified public shape is the hybrid: silent per-edit autofix (A) plus a Stop gate (B) for typecheck/lint/tests with a `stop_hook_active` guard and truncated output. Rests on: hooks ref exit-0 semantics, #3513/#80267/2.1.90, marmelab Phase 19, streamlit hooks. Missing: any controlled token comparison of A vs. B vs. C.
- *Type-checking*: Anthropic's stated route is (D) via the official LSP plugin for the language, with `diagnostics` left on; the open issues (#93321 not-awaited, #95507 hint noise) mean a Stop-hook `tsc --noEmit` gate (B) is the deterministic backstop. Running `tsc` per edit (A) is not recommended by anyone and has no evidence in its favour. Rests on: costs doc, discover-plugins, LSP issue list. Missing: a report of (D) and a Stop `tsc` gate running together (searched, none found).
- *Lint rules (eslint/ruff)*: no official LSP plugin exists, so (D) does not cover them; the choice is (B) Stop gate vs. (C) pre-commit/instruction. Evidence favours (B) for unattended runs only because Stop is what Anthropic documents as "the deterministic gate", not because anyone measured it.

**Codex CLI.**
- The vendor's own dogfooding is (C)-by-instruction: `just fmt` "after you have finished making code changes", `just fix` "before finalizing", explicitly "do not re-run tests after running `fix` or `fmt`". Codex hooks do support (A) (`PostToolUse` matching `apply_patch`/`Edit`/`Write`; plain stdout ignored, `additionalContext` fed back) and (B) (`Stop` block → continuation prompt, `stop_hook_active` provided), but no formatter example exists in the hooks doc. Verdict: follow the vendor's own AGENTS.md pattern (C) for formatting; use a `Stop` block for a lint/typecheck gate if unattended runs need determinism. Rests on: learn.chatgpt.com/docs/hooks, openai/codex AGENTS.md. Missing: whether `apply_patch` has a read-freshness check that a per-edit formatter could trip [unverified]; no Codex incident reports were searched.

**pi.**
- Extension points exist for both (A) `tool_result` (can rewrite what the model sees) and (B) `turn_end`/`agent_end`/`agent_settled` (the docs steer status integrations to `agent_settled` because `agent_end` may be followed by auto-retry/compaction). No formatter example ships and no maintainer stance was found. pi's `edit` tool has **no mtime/read-freshness check** and fuzzy-matches trailing whitespace, so the Claude-Code-specific (A) failure (stale-read error) cannot occur; a formatter that changes bytes inside a later `oldText` produces a normal "not found" error instead. Verdict: (A) at `tool_result` is *safer* in pi than in Claude Code by construction, and (B) at `agent_settled` is the natural gate; the lack of a consecutive-block cap analogue means any (B) that re-prompts must self-limit. Rests on: local `docs/extensions.md` and `dist/core/tools/edit*.js` of 0.85.1. Missing: maintainer opinion; any pi user report; whether `pi-lsp` community extensions push diagnostics after edits [unverified].

**DSH.**
- Native seams: `tools/post-execute` (A) and `agent/turn-stopping` (B), plus a bridge that runs Claude-format `PostToolUse`/`Stop` command hooks on them. The bridge's own README says `Stop` has **no consecutive-block cap** ("An unconditionally blocking hook therefore force-continues every step unless it self-limits") and `stop_hook_active` is always `false`, so a (B) lint gate on DSH must implement its own retry limit or it can loop indefinitely. `PostToolUse` supports `additionalContext` and block-with-feedback but not `updatedToolOutput`. No built-in formatter or LSP was found in the installed packages. Verdict: a silent per-edit formatter (A) is the lowest-risk deterministic option on DSH today [inference: no freshness-check evidence either way for DSH's `edit`/`str_replace_editor`], and any (B) gate needs a self-imposed cap; (C) via instructions is the fallback. Rests on: `@deepseek-ai/dsh-hooks-claude-code` 0.1.5-rc.2 README and `lib/index.js` (local). Missing: DSH's public docs (the research lane could not locate them), DSH edit-tool freshness semantics, any DSH user reports.

### 5.3 What is missing across the board

1. No controlled measurement of tokens or wall-clock for (A) vs (B) vs (C) vs (D) exists in any source reached. The only numbers are incident-scale (minutes per loop, tokens per runaway) and one confounded before/after (marmelab).
2. Community accounts on Reddit / X / Medium were not reachable in this run (web-search budget exhausted in every lane; Reddit blocks unauthenticated fetches). §2.5 should be re-run before the community-practice claim is relied on.
3. pi and DSH have no public incident record on this question at all; their verdicts rest on reading their code, not on evidence of use.
4. Whether Claude Code's 2.1.90 fix fully removes the same-turn stale-read error, or only when the formatter is a no-op, is unresolved: #3513 stays open and the comment describing the partial fix has an ambiguous attribution.
