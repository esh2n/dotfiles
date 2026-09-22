/**
 * omp's tool calls, translated into jig's vocabulary.
 *
 * Pure: names and inputs in, canonical `ToolCall`s out. Nothing here judges
 * — `domain/policy/request.ts` turns a canonical call into a request and
 * `domain/policy/evaluate.ts` decides. This module exists because omp's tool
 * surface differs from every other harness's in four ways that would
 * otherwise be silent holes:
 *
 *  1. `eval` runs a Python or JavaScript cell in a retained kernel and is
 *     declared `exec`, but omp's `bash.patterns` allow/deny list gates the
 *     `bash` tool ONLY (`docs/approval-mode.md`: "This pattern policy
 *     controls approval for the `bash` tool"). A command denied as `bash`
 *     runs unchallenged as `os.system(...)` inside `eval`. So the cell body
 *     is handed to jig as a shell command: subject extraction reads it
 *     leniently (suspects, not proofs), which is the fail-safe direction —
 *     `rm -rf /` inside a Python string is caught, and the cost is the
 *     occasional ask on a cell that merely mentions a guarded command.
 *
 *  2. `edit` does not carry a path. Its default `hashline` mode takes one
 *     string of `[PATH#TAG]` sections (`docs/tools/edit.md`), `apply_patch`
 *     mode takes codex's patch envelope, and only `replace`/`patch` mode
 *     carry `path` (`packages/coding-agent/src/edit/schemas.ts`). Judged as
 *     one opaque call, every fs.edit rule — the shell-rc floor, the
 *     credential ask — would fail open for omp. Each mode is fanned out into
 *     one file operation per file it touches.
 *
 *  3. omp has no separate web-fetch tool: `read` takes "Filesystem path,
 *     internal URL, or web URL" through one `path` string
 *     (`docs/tools/read.md`), so an http(s) path is a `net.fetch`, not an
 *     `fs.read`.
 *
 *  4. MCP tools are named `mcp__<server>_<tool>` — ONE underscore between
 *     server and tool (`docs/mcp-server-tool-authoring.md`), where every
 *     other harness writes two. jig splits on `__`, so an omp MCP name would
 *     arrive with the whole thing as the server and an empty tool, and
 *     serena's editing tools would miss the fs.edit routing that
 *     `MCP_EDIT_TOOLS` gives them. Names are canonicalized here.
 */

import type { ToolCall } from "../../../src/domain/hooks/decision";

/** What an omp tool call amounts to for the guard. */
export type Mapping =
  /** Judge these, strictest verdict wins. */
  | { readonly kind: "judge"; readonly calls: readonly ToolCall[] }
  /** A tool that writes, reads or executes, whose target could not be read. Fail closed. */
  | { readonly kind: "unreadable"; readonly reason: string }
  /** Nothing the policy speaks about (`grep`, `todo`, `task`, …). */
  | { readonly kind: "out-of-scope" };

export interface MapOptions {
  /**
   * Sanitized MCP server names, longest match first, used to split
   * `mcp__<server>_<tool>`. Empty is fine: the split then falls back to the
   * first underscore, which is right for every single-word server name
   * (`serena`) and wrong only for one that sanitizes to several
   * (`codebase-memory-mcp` → `codebase_memory_mcp`).
   */
  readonly mcpServers?: readonly string[];
}

function record(input: unknown): Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function stringField(
  input: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

function stringArrayField(
  input: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): readonly string[] | undefined {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) {
      const strings = value.filter((v): v is string => typeof v === "string" && v !== "");
      if (strings.length > 0) return strings;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// read/write paths
// ---------------------------------------------------------------------------

/**
 * omp's `read` and `write` accept a trailing selector on the path
 * (`:raw`, `:img`, `:conflicts`, `:50-100`, `:5-16,960-973`, `:raw:10-20`).
 * It is stripped before the path reaches a rule, so `~/.ssh/config:1-10` is
 * judged as `~/.ssh/config`. Stripping can only make a path match MORE rules
 * (a suffix never turns a guarded path into an unguarded one), so it is the
 * fail-safe direction; a real file whose name ends in `:raw` loses nothing
 * but precision in the audit line.
 */
const SELECTOR =
  /:(?:raw|img|conflicts|L?\d+(?:(?:-|\.\.|\+)\d*)?(?:,L?\d+(?:(?:-|\.\.|\+)\d*)?)*)$/;

export function stripSelector(path: string): string {
  let out = path;
  // `:range:raw` and `:raw:range` are both legal, so peel at most twice.
  for (let i = 0; i < 2; i += 1) {
    const next = out.replace(SELECTOR, "");
    if (next === out || next === "") break;
    out = next;
  }
  return out;
}

/** The URL a `read`/`write` path is, when it is a web URL rather than a file. */
export function webUrlOf(path: string): string | undefined {
  if (!/^https?:\/\//i.test(path)) return undefined;
  try {
    new URL(path);
    return path;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

/** A hashline section header: `[src/example.ts#1A2B]`. */
const HASHLINE_HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]$/;
/** `MV dest` renames the section's file; `REM` deletes it. */
const HASHLINE_MV = /^MV\s+(.+?)\s*$/;
const HASHLINE_REM = /^REM\s*$/;

export interface HashlineOperation {
  readonly path: string;
  readonly kind: "edit" | "delete";
  /** Where a `MV` sends it. */
  readonly to?: string;
}

/**
 * The files a hashline payload touches. Only the section headers and the
 * two whole-file operations are read; the patch body is not needed and is
 * never mistaken for a header, because body rows are `+`-prefixed.
 */
export function hashlineOperations(text: string): readonly HashlineOperation[] {
  const ops: HashlineOperation[] = [];
  let current: number | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = HASHLINE_HEADER.exec(line);
    if (header !== null) {
      const [, path = ""] = header;
      if (path === "") continue;
      current = ops.push({ path, kind: "edit" }) - 1;
      continue;
    }
    if (current === undefined) continue;
    const op = ops[current];
    if (op === undefined) continue;
    if (HASHLINE_REM.test(line)) {
      ops[current] = { ...op, kind: "delete" };
      continue;
    }
    const mv = HASHLINE_MV.exec(line);
    if (mv !== null) {
      const [, dest = ""] = mv;
      const to = dest.replace(/^"(.*)"$/, "$1");
      if (to !== "") ops[current] = { ...op, to };
    }
  }
  return ops;
}

/** Is this text codex's patch envelope (omp's `apply_patch` edit mode)? */
function isApplyPatch(text: string): boolean {
  return /^\*\*\* Begin Patch$/m.test(text) || /^\*\*\* (?:Add|Update|Delete) File: /m.test(text);
}

/**
 * The calls a hashline payload amounts to, in the vocabulary the core's
 * write rules already use — the same convention `domain/policy/apply-patch`
 * established for codex: a change is an `Edit`, a deletion is a `Write` of
 * the path it removes, a move is an `Edit` of the source plus a `Write` at
 * the destination.
 */
function hashlineCalls(text: string): readonly ToolCall[] {
  const calls: ToolCall[] = [];
  for (const op of hashlineOperations(text)) {
    calls.push({
      tool: op.kind === "delete" ? "Write" : "Edit",
      input: { file_path: stripSelector(op.path) },
    });
    if (op.to !== undefined) calls.push({ tool: "Write", input: { file_path: op.to } });
  }
  return calls;
}

function editMapping(input: Readonly<Record<string, unknown>>): Mapping {
  // omp's normalized `tool_call` view carries derived gate-only fields for
  // hashline edits — "the normalized `event.input` view … may carry derived
  // gate-only fields (e.g. hashline `edit` `path`/`paths`)"
  // (`extensibility/shared-events.ts`, `ToolCallEventResult.input`). When
  // they are there they are authoritative; the payload is parsed only when
  // they are not.
  const paths = stringArrayField(input, "paths");
  if (paths !== undefined) {
    return {
      kind: "judge",
      calls: paths.map((p) => ({ tool: "Edit", input: { file_path: stripSelector(p) } })),
    };
  }
  const path = stringField(input, "path", "file_path");
  if (path !== undefined) {
    const calls: ToolCall[] = [{ tool: "Edit", input: { file_path: stripSelector(path) } }];
    // `patch` mode's entries may carry `rename`, which lands a file elsewhere.
    const edits = input.edits;
    if (Array.isArray(edits)) {
      for (const entry of edits) {
        const rename = stringField(record(entry), "rename");
        if (rename !== undefined) calls.push({ tool: "Write", input: { file_path: rename } });
      }
    }
    return { kind: "judge", calls };
  }
  const text = stringField(input, "input", "patch", "command");
  if (text === undefined) {
    return {
      kind: "unreadable",
      reason: "an edit whose payload carries neither a path nor a patch — nothing to judge",
    };
  }
  // `apply_patch` mode: hand the envelope to the core, which already fans a
  // patch out per file (`domain/policy/apply-patch.ts`).
  if (isApplyPatch(text))
    return { kind: "judge", calls: [{ tool: "apply_patch", input: { input: text } }] };
  const calls = hashlineCalls(text);
  if (calls.length > 0) return { kind: "judge", calls };
  return {
    kind: "unreadable",
    reason:
      "an edit payload in no recognized form (hashline `[path#TAG]` sections or an apply_patch envelope) — " +
      "the files it writes cannot be read, so it cannot be judged",
  };
}

// ---------------------------------------------------------------------------
// eval cells
// ---------------------------------------------------------------------------

const LITERAL = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
/** What may sit between two literals of one argument list: `["rm", "-rf"]`. */
const LIST_SEPARATOR = /^[\s,[\]()]*$/;
/** Enough to cover a realistic cell without flooding the audit log. */
const MAX_EMBEDDED = 16;

/**
 * The command strings embedded in a cell.
 *
 * A cell is not shell, so handing its text to subject extraction reads
 * `os.system("rm -rf /tmp/x")` as a program called `os.system` — the rule
 * about `rm` never fires, and the hole `eval` opens in `bash.patterns` stays
 * open. So the quoted string literals are pulled out too, and consecutive
 * literals of one argument list are joined, which is what turns
 * `subprocess.run(["rm", "-rf", "/tmp/x"])` back into a command a rule can
 * read. This is the same move the extractor already makes for `$(…)`: look
 * inside, judge what is seen, and let the lenient side (forbid and ask on
 * suspicion) do the work. A literal that is only prose costs at most one
 * extra audit line.
 */
export function embeddedCommands(code: string): readonly string[] {
  const literals: { readonly text: string; readonly start: number; readonly end: number }[] = [];
  LITERAL.lastIndex = 0;
  for (;;) {
    const match = LITERAL.exec(code);
    if (match === null) break;
    const text = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (text !== "") {
      literals.push({ text, start: match.index, end: match.index + match[0].length });
    }
  }
  const out: string[] = [];
  const add = (value: string): void => {
    if (value !== "" && !out.includes(value) && out.length < MAX_EMBEDDED) out.push(value);
  };
  let group: string[] = [];
  let previousEnd: number | undefined;
  for (const literal of literals) {
    const joined =
      previousEnd !== undefined && LIST_SEPARATOR.test(code.slice(previousEnd, literal.start));
    if (!joined) {
      if (group.length > 1) add(group.join(" "));
      group = [];
    }
    group.push(literal.text);
    add(literal.text);
    previousEnd = literal.end;
  }
  if (group.length > 1) add(group.join(" "));
  return out;
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/**
 * omp's own sanitization of a server or tool name, from
 * `docs/mcp-server-tool-authoring.md`: "lowercases; non-`[a-z0-9_]` chars
 * become `_`; repeated underscores collapse".
 */
export function sanitizeMcpName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_");
}

/**
 * omp's `mcp__<server>_<tool>` rewritten as the `mcp__<server>__<tool>` the
 * core splits on. A name that already carries a double underscore (a server
 * whose sanitized name ends in `_`, or a call arriving from a Claude-shaped
 * bridge) is left alone.
 */
export function canonicalMcpName(raw: string, servers: readonly string[] = []): string {
  if (!raw.startsWith("mcp__")) return raw;
  const rest = raw.slice("mcp__".length);
  if (rest === "" || rest.includes("__")) return raw;
  let server = "";
  for (const candidate of servers) {
    const sane = sanitizeMcpName(candidate);
    if (sane === "" || sane.length <= server.length) continue;
    if (rest === sane || rest.startsWith(`${sane}_`)) server = sane;
  }
  if (server === "") {
    const cut = rest.indexOf("_");
    if (cut <= 0) return raw;
    server = rest.slice(0, cut);
  }
  const tool = rest.slice(server.length + 1);
  return tool === "" ? raw : `mcp__${server}__${tool}`;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * One omp tool call, as the calls jig should judge.
 *
 * | omp tool             | jig action  | read from                          |
 * |----------------------|-------------|------------------------------------|
 * | `bash`               | shell.exec  | `command`                          |
 * | `eval`               | shell.exec  | `code` (the cell body)             |
 * | `write`              | fs.write    | `path`                             |
 * | `edit`, `apply_patch`| fs.edit/write | `paths`/`path`/patch payload     |
 * | `read` (file)        | fs.read     | `path`                             |
 * | `read` (http(s) URL) | net.fetch   | `path`                             |
 * | `mcp__<server>_<tool>` | mcp.call  | the name, canonicalized            |
 * | anything else        | —           | out of scope                       |
 */
export function mapToolCall(
  toolName: string,
  rawInput: unknown,
  options: MapOptions = {},
): Mapping {
  const input = record(rawInput);
  switch (toolName) {
    case "bash": {
      const command = stringField(input, "command");
      return command === undefined
        ? { kind: "unreadable", reason: "a bash call with no command to read" }
        : { kind: "judge", calls: [{ tool: "bash", input: { command } }] };
    }
    case "eval": {
      const code = stringField(input, "code");
      if (code === undefined) {
        return { kind: "unreadable", reason: "an eval call with no cell body to read" };
      }
      // Judged as a shell command, and named `eval` so the audit line says
      // which tool asked: `bash.patterns` does not cover this one, jig does.
      // The whole cell goes first (that is what a raw-string rule reads),
      // then each command string embedded in it.
      const language = stringField(input, "language");
      const extra = language === undefined ? {} : { language };
      return {
        kind: "judge",
        calls: [
          { tool: "eval", input: { command: code, ...extra } },
          ...embeddedCommands(code).map((command) => ({
            tool: "eval",
            input: { command, ...extra },
          })),
        ],
      };
    }
    case "write": {
      const path = stringField(input, "path", "file_path");
      if (path === undefined) {
        return { kind: "unreadable", reason: "a write call with no path to read" };
      }
      const url = webUrlOf(path);
      // A `write` to an http(s) URL is not a file write; omp routes it to an
      // internal-resource handler. Judged as a fetch of that host.
      if (url !== undefined)
        return { kind: "judge", calls: [{ tool: "WebFetch", input: { url } }] };
      return { kind: "judge", calls: [{ tool: "write", input: { path: stripSelector(path) } }] };
    }
    case "edit":
    case "apply_patch":
      return editMapping(input);
    case "read": {
      const path = stringField(input, "path", "file_path");
      if (path === undefined) {
        return { kind: "unreadable", reason: "a read call with no path to read" };
      }
      const url = webUrlOf(path);
      if (url !== undefined)
        return { kind: "judge", calls: [{ tool: "WebFetch", input: { url } }] };
      return { kind: "judge", calls: [{ tool: "read", input: { path: stripSelector(path) } }] };
    }
    default: {
      if (!toolName.startsWith("mcp__")) return { kind: "out-of-scope" };
      // The original input rides along: serena's editing tools are routed to
      // fs.edit by the core, which reads their `relative_path`.
      return {
        kind: "judge",
        calls: [{ tool: canonicalMcpName(toolName, options.mcpServers ?? []), input }],
      };
    }
  }
}

/** The files a finished `edit`/`write` touched, for the formatter. */
export function editedPaths(
  toolName: string,
  rawInput: unknown,
  details: unknown,
): readonly string[] {
  const input = record(rawInput);
  const resolved = stringField(record(details), "resolvedPath");
  if (resolved !== undefined) return [resolved];
  const mapping = mapToolCall(toolName, rawInput);
  if (mapping.kind !== "judge") return [];
  const paths: string[] = [];
  for (const call of mapping.calls) {
    const path = stringField(call.input, "file_path", "path");
    if (path !== undefined && !paths.includes(path)) paths.push(path);
  }
  // `apply_patch` is forwarded whole; its files are inside the envelope.
  if (paths.length === 0) {
    const text = stringField(input, "input", "patch");
    if (text !== undefined) {
      for (const op of hashlineOperations(text)) if (!paths.includes(op.path)) paths.push(op.path);
    }
  }
  return paths;
}
