/**
 * Reading skill usage out of the harnesses' own session transcripts.
 *
 * Two formats, one parser. They differ in field names, not in what they say, and a
 * parser per harness would mean two places to fix when a harness renames something — so
 * the shapes are read side by side, and a line that matches neither is skipped rather
 * than guessed at. The one thing this deliberately does NOT do is resolve symlinks: a
 * read of `~/.claude/.skills-merged/<name>/SKILL.md` and a read of the repo path it
 * points at both name the same skill by directory name, which is all the report needs.
 *
 * The transcripts are the record the harnesses already keep. Nothing here is installed in
 * a harness, so a harness that stops writing a field shows up as a smaller number rather
 * than as a broken hook.
 */

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Harness, type SkillTurn, skillNameFromPath } from "../../domain/skills/usage";

/**
 * The router's reminder, in the two shapes it has been written in.
 *
 * The list form is what the router writes now; the single form is what it wrote before
 * 2026-09-20, when the question could only name one skill. Sessions from before that date are
 * still on disk and still being read, so both are parsed — a parser that knew only the new
 * shape would file every older turn as if nothing had been injected.
 */
const REMINDER_LIST_NAMES = /^- "([^"]+)": /gm;
const REMINDER_LIST_CONFIDENCE = /judgment confidence ([0-9., ]+)\)/;
const REMINDER_SINGLE = /matches the "([^"]+)" skill \(judgment confidence ([0-9.]+)\)/;

/**
 * The fallback catalog (`domain/skills/fallback-catalog.ts`) writes its skills in the same
 * `- "<name>": …` shape, on purpose — one format for the reader. It is not a selection, and
 * counting a 20-skill catalog dump as 20 skills the router chose would put a router failure
 * into the report as the router's best hour. The fallback's own record is the router log's
 * `fallback` field, which is where the experiment reads it.
 */
const FALLBACK_HEADER = /^jig skill router: no selection for this request \(/m;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Which harness wrote the line. Claude Code marks every entry with `parentUuid` and its
 * hook context arrives as an `attachment`; pi writes `type`-tagged entries. Anything
 * else is reported as `unknown` rather than being filed under a guess — a format change
 * should be visible in the report, not silently averaged into one harness's numbers.
 */
function harnessOf(entry: Record<string, unknown>): Harness {
  // `parentUuid` is present on every Claude Code line — null on the first one — so the
  // test is presence, not a string type check.
  if (entry.type === "attachment" || "parentUuid" in entry) return "claude";
  if ("parentId" in entry || entry.type === "message" || entry.type === "custom_message") {
    return "pi";
  }
  return "unknown";
}

function timestampOf(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" ? entry.timestamp : "";
}

/** Whether this entry is a user prompt, as opposed to a tool result or a system note. */
function isPrompt(entry: Record<string, unknown>, harness: Harness): boolean {
  const message = asRecord(entry.message);
  if (message === undefined || message.role !== "user") return false;
  // Each harness has one entry type that carries a prompt; anything else with role "user"
  // is a tool result or a system note. An unrecognized format is exempt from this check
  // on purpose: its prompts still count, and land in the report's own `unknown` row,
  // which is how a changed format becomes visible instead of silent.
  if (harness !== "unknown") {
    const carrier = harness === "pi" ? "message" : "user";
    if (entry.type !== carrier) return false;
  }

  // Both harnesses carry the text as either a bare string or a list of parts; pi uses the
  // list even for a plain prompt, so "a string means a prompt" would miss every one of them.
  const content = message.content;
  if (typeof content === "string") return content.trim() !== "";
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((part) => asRecord(part)?.type === "text");
}

interface Injection {
  readonly skills: readonly string[];
  readonly confidence: number | undefined;
}

/** The router's reminder, from either harness's carrier for hook context. */
function injectionOf(entry: Record<string, unknown>, harness: Harness): Injection | undefined {
  let text: string | undefined;

  if (harness === "claude" && entry.type === "attachment") {
    const attachment = asRecord(entry.attachment);
    if (attachment?.type === "hook_additional_context" && Array.isArray(attachment.content)) {
      text = attachment.content
        .filter((part): part is string => typeof part === "string")
        .join("\n");
    }
  }

  if (
    harness === "pi" &&
    entry.type === "custom_message" &&
    entry.customType === "jig-skill-router"
  ) {
    text = typeof entry.content === "string" ? entry.content : undefined;
  }

  if (text === undefined) return undefined;
  if (FALLBACK_HEADER.test(text)) return undefined;

  const skills = [...text.matchAll(REMINDER_LIST_NAMES)].map((match) => match[1] ?? "");
  if (skills.length > 0) {
    const reported = REMINDER_LIST_CONFIDENCE.exec(text)?.[1] ?? "";
    const top = Number.parseFloat(reported.split(",")[0]?.trim() ?? "");
    return { skills, confidence: Number.isFinite(top) ? top : undefined };
  }

  const single = REMINDER_SINGLE.exec(text);
  if (single?.[1] === undefined) return undefined;
  const confidence = Number.parseFloat(single[2] ?? "");
  return { skills: [single[1]], confidence: Number.isFinite(confidence) ? confidence : undefined };
}

/** Every file this entry opened through a read tool, in call order. */
function readPathsOf(entry: Record<string, unknown>, harness: Harness): readonly string[] {
  const message = asRecord(entry.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];

  const paths: string[] = [];
  for (const part of content) {
    const call = asRecord(part);
    if (call === undefined) continue;

    if (harness === "claude" && entry.type === "assistant" && call.type === "tool_use") {
      if (call.name !== "Read") continue;
      const input = asRecord(call.input);
      if (typeof input?.file_path === "string") paths.push(input.file_path);
      continue;
    }

    if (harness === "pi" && message?.role === "assistant" && call.type === "toolCall") {
      if (call.name !== "read") continue;
      const args = asRecord(call.arguments);
      if (typeof args?.path === "string") paths.push(args.path);
    }
  }

  return paths;
}

/**
 * Every skill this entry loaded through the harness's own skill tool, in call order.
 *
 * Claude Code records it as an ordinary `tool_use` named `Skill`, whose input names the
 * skill rather than a path: `{"type":"tool_use","name":"Skill","input":{"skill":"writeup"}}`
 * (an optional `args` string may sit alongside). The name comes back unresolved, which is
 * why the caller filters it against the installed catalog exactly as it does a read path —
 * the tool also loads plugin and bundled skills the router never sees, and those are not
 * this report's business.
 *
 * pi has no equivalent entry in the transcripts read here, so this returns nothing for it
 * rather than guessing at a shape; a pi skill invocation still shows up as the read it does.
 */
function skillCallsOf(entry: Record<string, unknown>, harness: Harness): readonly string[] {
  if (harness !== "claude" || entry.type !== "assistant") return [];
  const content = asRecord(entry.message)?.content;
  if (!Array.isArray(content)) return [];

  const names: string[] = [];
  for (const part of content) {
    const call = asRecord(part);
    if (call === undefined || call.type !== "tool_use" || call.name !== "Skill") continue;
    const input = asRecord(call.input);
    if (typeof input?.skill === "string" && input.skill !== "") names.push(input.skill);
  }
  return names;
}

interface TurnBuilder {
  readonly harness: Harness;
  readonly at: string;
  injected: readonly string[];
  confidence: number | undefined;
  readonly read: string[];
  readonly skilled: string[];
}

/**
 * Read one session file into turns.
 *
 * `known` is the installed catalog. Without it the parser would count jig's own
 * `src/infra/skills/` reads as skill usage — a directory named `skills` is not a skill,
 * and only the catalog can tell the two apart.
 *
 * Claude Code records a subagent's work inline with `isSidechain`; those entries are
 * folded into the turn whose prompt caused them, because the read was the parent
 * request's doing. A subagent running as its own session (pi) is its own turn, as it
 * should be — that process runs the router too.
 */
export function parseSkillTurns(
  text: string,
  session: string,
  known: ReadonlySet<string>,
): readonly SkillTurn[] {
  const turns: SkillTurn[] = [];
  let current: TurnBuilder | undefined;

  const flush = (): void => {
    if (current === undefined) return;
    turns.push({
      session,
      harness: current.harness,
      at: current.at,
      injected: current.injected,
      confidence: current.confidence,
      read: current.read,
      skilled: current.skilled,
    });
    current = undefined;
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = asRecord(parsed);
    if (entry === undefined) continue;

    const harness = harnessOf(entry);
    const sidechain = entry.isSidechain === true;
    const injected = injectionOf(entry, harness);
    const paths = readPathsOf(entry, harness);
    const invoked = skillCallsOf(entry, harness);

    if (!sidechain && isPrompt(entry, harness)) {
      flush();
      current = {
        harness,
        at: timestampOf(entry),
        injected: [],
        confidence: undefined,
        read: [],
        skilled: [],
      };
    }
    if (
      current === undefined &&
      (injected !== undefined || paths.length > 0 || invoked.length > 0)
    ) {
      current = {
        harness,
        at: timestampOf(entry),
        injected: [],
        confidence: undefined,
        read: [],
        skilled: [],
      };
    }
    if (current === undefined) continue;

    if (injected !== undefined) {
      current.injected = injected.skills;
      current.confidence = injected.confidence;
    }

    for (const path of paths) {
      const name = skillNameFromPath(path);
      if (name === undefined || !known.has(name) || current.read.includes(name)) continue;
      current.read.push(name);
    }

    for (const name of invoked) {
      if (!known.has(name) || current.skilled.includes(name)) continue;
      current.skilled.push(name);
    }
  }

  flush();
  return turns;
}

export interface FindTranscriptsOptions {
  /** Only files modified at or after this time. Session trees hold years of files. */
  readonly since: Date;
  /** Directories this deep hold no session files, and walking them is not free. */
  readonly maxDepth?: number;
}

/** Session files under `dirs`, newest first. Missing directories are not an error. */
export async function findTranscripts(
  dirs: readonly string[],
  options: FindTranscriptsOptions,
): Promise<readonly string[]> {
  const maxDepth = options.maxDepth ?? 6;
  const found: { path: string; modifiedAt: number }[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const info = await stat(path);
        if (info.mtime.getTime() >= options.since.getTime()) {
          found.push({ path, modifiedAt: info.mtime.getTime() });
        }
      } catch {
        // A file that vanished between listing and stat is simply not part of the report.
      }
    }
  };

  for (const dir of dirs) await walk(dir, 0);
  return found.sort((left, right) => right.modifiedAt - left.modifiedAt).map((file) => file.path);
}
