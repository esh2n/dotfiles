/**
 * Hand-written parser for the `permissions.yaml` subset used by
 * core/personal/packs/<name>/permissions.yaml — no YAML dependency, ported
 * line-for-line from yoki's
 * `runtime/yoki/scripts/lib/permissions/parse.js` (`parseYamlPermissions`).
 *
 * Supported shape only (anything else is a parse error):
 *
 *   allow:
 *     - pattern: "Bash(git status *)"
 *       reason: "optional text"
 *     - pattern: "Read(**)"
 *   deny:
 *     - pattern: "Bash(rm -rf /*)"
 *       reason: "optional text"
 *       enforce: [hook]
 *   guardFloor:
 *     - hook: git-guard.sh
 *       event: PreToolUse
 *       matcher: Bash
 *   defaultMode: auto
 *
 * `allow`/`deny`/`guardFloor` may also be the empty-list form (`allow: []`).
 * Blank lines and full-line `#` comments are ignored; there is no
 * inline-comment or multi-line-string support because these files never need
 * it. A missing file is not this module's concern — the caller (app/compose)
 * treats ENOENT as an empty layer by parsing `""`, which yields the same
 * result as yoki's `loadLayer` catch branch.
 */

import type { GuardFloorEntry, PermissionEntry, PermissionLayer } from "./types";

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(value: string): string[] {
  const v = value.trim();
  if (v === "[]") return [];
  const m = /^\[(.*)\]$/.exec(v);
  if (!m) {
    throw new Error(`permissions.yaml: expected an inline array, got: ${value}`);
  }
  const inner = m[1] ?? "";
  return inner
    .split(",")
    .map((part) => stripQuotes(part))
    .filter((part) => part.length > 0);
}

const LIST_KEYS = new Set(["allow", "deny", "guardFloor"]);

type ListKey = "allow" | "deny" | "guardFloor";
/** A permission entry ({pattern, reason?, enforce?}) or a guardFloor entry
 * ({hook, event?, matcher?, reason?}) under construction. The two shapes
 * never mix within one entry — which fields end up set depends only on
 * which block (`currentKey`) the entry was opened inside. */
type MutableEntry = Record<string, string | string[]>;

export function parseYamlPermissions(text: string): PermissionLayer {
  const allow: PermissionEntry[] = [];
  const deny: PermissionEntry[] = [];
  const guardFloor: GuardFloorEntry[] = [];
  let defaultMode: string | undefined;

  const lists: Record<ListKey, unknown[]> = { allow, deny, guardFloor };

  let currentKey: ListKey | null = null;
  let currentEntry: MutableEntry | null = null;

  const lines = String(text ?? "").split(/\r?\n/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Top-level key (no leading whitespace): "allow:", "deny:", "defaultMode: auto"
    const topMatch = /^(\w+):\s*(.*)$/.exec(rawLine);
    if (topMatch && rawLine[0] !== " " && rawLine[0] !== "-") {
      const key = topMatch[1] ?? "";
      const rest = topMatch[2] ?? "";
      currentEntry = null;

      if (LIST_KEYS.has(key)) {
        currentKey = key as ListKey;
        if (rest.trim() === "[]") {
          lists[currentKey].length = 0;
          currentKey = null; // inline empty list closes the block immediately
        }
        continue;
      }

      if (key === "defaultMode") {
        defaultMode = stripQuotes(rest);
        currentKey = null;
        continue;
      }

      throw new Error(`permissions.yaml:${lineNo + 1}: unsupported top-level key "${key}"`);
    }

    // List item start: "  - pattern: ..."
    const itemMatch = /^\s*-\s*pattern:\s*(.+)$/.exec(rawLine);
    if (itemMatch) {
      if (currentKey !== "allow" && currentKey !== "deny") {
        throw new Error(`permissions.yaml:${lineNo + 1}: "- pattern:" outside an allow/deny block`);
      }
      const entry: MutableEntry = { pattern: stripQuotes(itemMatch[1] ?? "") };
      currentEntry = entry;
      lists[currentKey].push(entry);
      continue;
    }

    // guardFloor item start: "  - hook: git-guard.sh"
    const hookMatch = /^\s*-\s*hook:\s*(.+)$/.exec(rawLine);
    if (hookMatch) {
      if (currentKey !== "guardFloor") {
        throw new Error(`permissions.yaml:${lineNo + 1}: "- hook:" outside a guardFloor block`);
      }
      const entry: MutableEntry = { hook: stripQuotes(hookMatch[1] ?? "") };
      currentEntry = entry;
      lists[currentKey].push(entry);
      continue;
    }

    // Nested guardFloor fields: "    event: PreToolUse" / "    matcher: Bash"
    const eventMatch = /^\s*event:\s*(.+)$/.exec(rawLine);
    if (eventMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "event:" outside a list entry`);
      }
      currentEntry.event = stripQuotes(eventMatch[1] ?? "");
      continue;
    }

    const matcherMatch = /^\s*matcher:\s*(.+)$/.exec(rawLine);
    if (matcherMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "matcher:" outside a list entry`);
      }
      currentEntry.matcher = stripQuotes(matcherMatch[1] ?? "");
      continue;
    }

    // Nested field on the current entry: "    reason: ..." / "    enforce: [...]"
    const reasonMatch = /^\s*reason:\s*(.+)$/.exec(rawLine);
    if (reasonMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "reason:" outside a list entry`);
      }
      currentEntry.reason = stripQuotes(reasonMatch[1] ?? "");
      continue;
    }

    const enforceMatch = /^\s*enforce:\s*(.+)$/.exec(rawLine);
    if (enforceMatch) {
      if (!currentEntry) {
        throw new Error(`permissions.yaml:${lineNo + 1}: "enforce:" outside a list entry`);
      }
      currentEntry.enforce = parseInlineArray(enforceMatch[1] ?? "");
      continue;
    }

    throw new Error(`permissions.yaml:${lineNo + 1}: unrecognized line: ${rawLine}`);
  }

  return { allow, deny, guardFloor, defaultMode };
}
