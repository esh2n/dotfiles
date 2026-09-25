/**
 * The two Codex files `jig retire yoki` rewrites rather than removes, as
 * pure text transforms over files jig does not own:
 *
 * - **`~/.codex/config.toml`**: yoki's `# yoki:begin … # yoki:end` block
 *   goes (`removeMarkedBlock`, the helper `jig codex register` and `jig
 *   apply --target codex` strip their own blocks with), and so do the
 *   `[permissions.yoki]` and `[permissions.yoki.filesystem]` tables wherever
 *   they stand. Every other byte is carried through — `[projects.*]`,
 *   `[sandbox_workspace_write]`, jig's two blocks, Codex's own keys.
 *
 *   Two things the block holds are not yoki's, and are carried out of it
 *   rather than dropped: the `[features]` tables. `hooks = true` there is
 *   what makes Codex run hooks at all, jig's registered guard included, and
 *   `multi_agent` is a Codex switch the owner chose; yoki's generator merely
 *   wrote them inside its markers. Dropping the block whole would switch the
 *   guard off silently, which is the one outcome a retirement must not have.
 *
 *   The `[hooks.state."<hooks.json>:<event>:<group>:<handler>"]` trust
 *   tables yoki's `codex-trust.js` wrote sit OUTSIDE the block, one per
 *   handler. Those whose positional key named a handler the hooks.json
 *   rewrite removes go too (the caller says which); a table for a handler
 *   that stays is kept even where its index shifts, and the shift is
 *   reported, because re-trusting is Codex's prompt to give, not jig's
 *   guess to write.
 *
 * - **`~/.codex/hooks.json`**: every group whose handler commands reference
 *   `run-with-flags.js`, `$YOKI_ROOT` or `YOKI_` is yoki's and goes; jig's
 *   registered group (`isJigGroup`) and every other group (orca's, herdr's)
 *   stay in order; an event left with no group is dropped from the file.
 *   Parsed with `parseHooksDocument`, the reader `jig codex register` uses,
 *   so a shape that command would refuse is refused here the same way.
 */

import {
  type HooksDocument,
  isJigGroup,
  isRecord,
  parseHooksDocument,
  removeMarkedBlock,
} from "../codex/register";

export const YOKI_BLOCK_BEGIN = "# yoki:begin";
export const YOKI_BLOCK_END = "# yoki:end";

/** The tables the block holds that are Codex's switches, not yoki's runtime. */
const CARRIED_TABLE_PREFIX = "[features";

export const YOKI_PERMISSION_TABLES = [
  "[permissions.yoki]",
  "[permissions.yoki.filesystem]",
] as const;

/** A handler the hooks.json rewrite removes, by its position in the ORIGINAL file. */
export interface RemovedHandler {
  readonly event: string;
  readonly groupIndex: number;
  readonly handlerIndex: number;
  readonly command: string;
}

/** A handler that stays but moves down, because a yoki group ahead of it went. */
export interface ShiftedHandler {
  readonly event: string;
  readonly from: number;
  readonly to: number;
  readonly command: string;
}

export interface HooksJsonRetirePlan {
  readonly text: string;
  readonly changed: boolean;
  readonly removed: readonly RemovedHandler[];
  readonly shifted: readonly ShiftedHandler[];
  /** Events whose every group was yoki's, dropped from the file. */
  readonly droppedEvents: readonly string[];
  /** Groups that stay, jig's included. */
  readonly keptGroups: number;
}

const YOKI_COMMAND_RE = /run-with-flags\.js|\$YOKI_ROOT|YOKI_/;

/** A group is yoki's when any of its handlers runs through yoki's runner or reads yoki's environment. */
export function isYokiGroup(group: unknown): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (h) => isRecord(h) && typeof h.command === "string" && YOKI_COMMAND_RE.test(h.command),
  );
}

function commandsOf(group: unknown): readonly string[] {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return [];
  return group.hooks.map((h) =>
    isRecord(h) && typeof h.command === "string" ? h.command : "(no command)",
  );
}

/** hooks.json without yoki's groups. Throws on a shape `parseHooksDocument` refuses. */
export function planHooksJsonRetire(text: string | undefined): HooksJsonRetirePlan {
  const doc = parseHooksDocument(text);
  const removed: RemovedHandler[] = [];
  const shifted: ShiftedHandler[] = [];
  const droppedEvents: string[] = [];
  const events: Record<string, unknown[]> = {};
  let keptGroups = 0;
  for (const [event, groups] of Object.entries(doc.hooks)) {
    const kept: unknown[] = [];
    groups.forEach((group, index) => {
      if (isYokiGroup(group) && !isJigGroup(group)) {
        commandsOf(group).forEach((command, handlerIndex) =>
          removed.push({ event, groupIndex: index, handlerIndex, command }),
        );
        return;
      }
      if (kept.length !== index) {
        for (const command of commandsOf(group)) {
          shifted.push({ event, from: index, to: kept.length, command });
        }
      }
      kept.push(group);
    });
    keptGroups += kept.length;
    if (kept.length === 0 && groups.length > 0) droppedEvents.push(event);
    else events[event] = kept;
  }
  const next: HooksDocument = { ...doc, hooks: events };
  const rendered = `${JSON.stringify(next, null, 2)}\n`;
  // Only a removed group justifies a rewrite: a file with nothing of yoki's
  // keeps its own bytes, whatever its formatting.
  const changed = removed.length > 0;
  return {
    text: changed ? rendered : (text ?? rendered),
    changed,
    removed,
    shifted,
    droppedEvents,
    keptGroups,
  };
}

/** Codex's positional trust key label for an event name: `PreToolUse` → `pre_tool_use`. */
export function eventLabel(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export interface ConfigTomlRetireInput {
  readonly text: string;
  /** The absolute hooks.json path, as Codex spells it in the trust keys. */
  readonly hooksJsonPath: string;
  /** From `planHooksJsonRetire`: the trust tables for these go too. */
  readonly removedHandlers: readonly RemovedHandler[];
}

export interface ConfigTomlRetirePlan {
  readonly text: string;
  readonly changed: boolean;
  /** What went, one line each. */
  readonly removed: readonly string[];
  /** Tables lifted out of the block and kept. */
  readonly carried: readonly string[];
}

/**
 * config.toml without yoki's block, its permission tables, and the trust
 * tables of the handlers hooks.json drops. Throws when the block has a
 * begin marker and no end — the file is then not safely editable and the
 * caller reports it.
 */
export function planConfigTomlRetire(input: ConfigTomlRetireInput): ConfigTomlRetirePlan {
  const removed: string[] = [];
  const carried: string[] = [];
  let text = input.text;

  const begin = text.indexOf(YOKI_BLOCK_BEGIN);
  if (begin !== -1) {
    const endAt = text.indexOf(YOKI_BLOCK_END, begin);
    if (endAt === -1) {
      throw new Error(`"${YOKI_BLOCK_BEGIN}" without "${YOKI_BLOCK_END}"`);
    }
    const inside = text.slice(begin + YOKI_BLOCK_BEGIN.length, endAt);
    const lifted = tablesWithPrefix(inside, CARRIED_TABLE_PREFIX);
    const stripped = removeMarkedBlock(text, YOKI_BLOCK_BEGIN, YOKI_BLOCK_END);
    const rest = stripped.slice(begin);
    const liftedText = lifted.map((table) => `${table.trimEnd()}\n`).join("\n");
    text =
      lifted.length === 0
        ? stripped
        : `${stripped.slice(0, begin)}${liftedText}${rest === "" ? "" : `\n${rest.replace(/^\n+/, "")}`}`;
    const lineCount = inside.split("\n").length - 1;
    removed.push(
      `${YOKI_BLOCK_BEGIN} … ${YOKI_BLOCK_END} block (${lineCount} lines): ${summarizeBlock(inside, lifted.length)}`,
    );
    for (const table of lifted) {
      const header = table.slice(
        0,
        table.indexOf("\n") === -1 ? table.length : table.indexOf("\n"),
      );
      carried.push(header.trim());
    }
  }

  for (const header of YOKI_PERMISSION_TABLES) {
    const next = removeTomlTable(text, header);
    if (next !== text) {
      removed.push(`${header} table`);
      text = next;
    }
  }

  for (const handler of input.removedHandlers) {
    const key = `${input.hooksJsonPath}:${eventLabel(handler.event)}:${handler.groupIndex}:${handler.handlerIndex}`;
    const header = `[hooks.state."${key}"]`;
    const next = removeTomlTable(text, header);
    if (next !== text) {
      removed.push(`${header} (trust entry of a removed yoki handler)`);
      text = next;
    }
  }

  return { text, changed: text !== input.text, removed, carried };
}

/** The trust tables in the file for handlers that stay but shift: keyed by their OLD position, so stale after the rewrite. */
export function staleTrustTables(
  configToml: string,
  hooksJsonPath: string,
  shifted: readonly ShiftedHandler[],
): readonly string[] {
  const found: string[] = [];
  for (const handler of shifted) {
    // A group's handlers keep their index within the group; only the group index moves.
    const prefix = `[hooks.state."${hooksJsonPath}:${eventLabel(handler.event)}:${handler.from}:`;
    if (configToml.includes(prefix)) found.push(`${prefix}…"] (now group ${handler.to})`);
  }
  return [...new Set(found)];
}

/**
 * The text without one top-level table: from its header line up to the line
 * before the next header (or the end). Trailing blank lines of the table go
 * with it, so the neighbours' spacing is what it was. Unchanged when the
 * header is not there.
 */
export function removeTomlTable(text: string, header: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return text;
  let end = start + 1;
  while (end < lines.length && !isTableHeader(lines[end] ?? "")) end++;
  // The blank line that separated this table from the next header is part of
  // the range, so the neighbours end up one blank line apart, as they were.
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function isTableHeader(line: string): boolean {
  return /^\s*\[/.test(line);
}

/**
 * What the block holds, for the dry-run: its top-level keys and table
 * headers, with the `[hooks.state.*]` trust tables counted rather than
 * listed and the lifted `[features*]` tables named as kept.
 */
function summarizeBlock(inside: string, liftedCount: number): string {
  const parts: string[] = [];
  let trust = 0;
  let inTable = false;
  for (const raw of inside.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (isTableHeader(line)) {
      inTable = true;
      if (line.startsWith("[hooks.state.")) trust++;
      else if (line.startsWith(CARRIED_TABLE_PREFIX)) parts.push(`${line} (kept, lifted out)`);
      else parts.push(line);
      continue;
    }
    if (!inTable) {
      const eq = line.indexOf("=");
      if (eq !== -1) parts.push(line.slice(0, eq).trim());
    }
  }
  if (trust > 0) parts.push(`${trust} [hooks.state.*] trust tables of yoki's handlers`);
  if (liftedCount === 0 && parts.length === 0) return "(empty)";
  return parts.join(", ");
}

/** Every complete table in `text` whose header starts with `prefix`, header line through the line before the next header. */
function tablesWithPrefix(text: string, prefix: string): readonly string[] {
  const lines = text.split("\n");
  const tables: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith(prefix) || !isTableHeader(line)) continue;
    let end = i + 1;
    while (end < lines.length && !isTableHeader(lines[end] ?? "")) end++;
    tables.push(lines.slice(i, end).join("\n"));
    i = end - 1;
  }
  return tables;
}
