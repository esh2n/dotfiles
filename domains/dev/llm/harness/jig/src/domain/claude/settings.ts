/**
 * Composing `~/.claude/settings.json`.
 *
 * The invariant this module exists to hold, from
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md`:
 *
 *   「生成器の依存は元 → 出力の一方向。出力先やハーネス自身のファイルを
 *    読んでよいのは、自分が管理しない鍵をそのまま戻すためだけで、読んだ内容で
 *    管理する鍵の値や診断の出力を変えない。」
 *
 * So `current` enters this function for exactly two purposes: to carry
 * unmanaged keys through unchanged, and to say what is being removed. No
 * managed value is ever derived from it. `autoMode`, `enabledPlugins`,
 * `statusLine`, `model`, `effortLevel`, `theme` and everything else Claude
 * Code writes for itself survive byte-for-byte in value — the same
 * runtime-owned-key carryover yoki-switch does for `.autoMode`, generalized to
 * "everything jig did not claim".
 *
 * Key order follows `current` so a diff shows changes and not a reshuffle;
 * keys jig adds that were not there (`sandbox`) append at the end.
 *
 * One key is neither owned nor carried: `mcpServers`. Milestone 1 wrote it on
 * the assumption that Claude Code reads MCP servers from settings.json; it does
 * not (mcp.md, settings.md — the user-scope source is `~/.claude.json`, written
 * only by `claude mcp add`). So the key is jig's own dead value: it leaves on
 * write and is reported under the removals with that reason. The servers
 * themselves are delivered as printed `claude mcp add` lines
 * (domain/mcp/claude-mcp-add.ts).
 *
 * Pure. No IO, no clock, no paths.
 */

import type { Json, JsonObject } from "../compose/merge";

/**
 * Environment variables the retired harness owned. Their removal is jig's one
 * claim on `env` — every other key is carried through, because no ruling makes
 * the generator the owner of the environment block.
 *
 * `CLAUDE_PLUGIN_ROOT` is named explicitly and not covered by the prefix: it
 * does not start with `YOKI_`, but its value points into
 * `claude-profiles/runtime/yoki`, so it retires with the runtime it names.
 * Naming it here rather than matching on the value keeps the rule readable and
 * keeps this module from inspecting what it removes.
 */
export const RETIRED_ENV_PREFIX = /^YOKI_/;
export const RETIRED_ENV_NAMES: ReadonlySet<string> = new Set(["CLAUDE_PLUGIN_ROOT"]);

/** Whether an `env` key belongs to the retiring harness and leaves with it. */
export function isRetiredEnvKey(key: string): boolean {
  return RETIRED_ENV_PREFIX.test(key) || RETIRED_ENV_NAMES.has(key);
}

export interface ClaudeManagedInput {
  /** The five hook entries (domain/claude/hooks.ts). Replaces the key outright. */
  readonly hooks: JsonObject;
  /** Projected from guard-rules.json plus the decision's default permits. */
  readonly allow: readonly string[];
  /** Projected from guard-rules.json. */
  readonly deny: readonly string[];
  readonly defaultMode: string;
  /** The host-mode sandbox block (domain/claude/sandbox.ts). */
  readonly sandbox: JsonObject;
}

/** One group of values the apply would drop, named so the dry-run can print them. */
export interface Removal {
  /** Dotted path of the key the values are leaving, e.g. `hooks.PreToolUse`. */
  readonly key: string;
  readonly items: readonly string[];
  /** Why the whole key goes, when it is not merely "no longer generated". */
  readonly reason?: string;
}

/**
 * Keys jig wrote in an earlier milestone on a wrong assumption. They are not
 * owned (nothing regenerates them) and not carried (they are jig's, not the
 * user's); the apply removes each with its reason.
 */
export const DEAD_KEYS: ReadonlyMap<string, string> = new Map([
  [
    "mcpServers",
    "settings.json is not an MCP source (docs: mcp.md); delivered through `claude mcp add` instead",
  ],
]);

export interface ClaudeComposition {
  readonly settings: JsonObject;
  /** Dotted paths jig now owns the value of. */
  readonly owned: readonly string[];
  /** Dotted paths present in `current` and carried through untouched. */
  readonly left: readonly string[];
  readonly removed: readonly Removal[];
}

/** Every key whose value this module replaces; `env` is partial (see RETIRED_ENV_PREFIX). */
export const OWNED_KEYS: readonly string[] = [
  "hooks",
  "permissions.allow",
  "permissions.deny",
  "permissions.defaultMode",
  "sandbox",
];

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStrings(value: Json | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Every `command` string under a hooks event, however deeply the harness
 * nested it. Defensive on purpose: this is read from a file another program
 * writes, and a shape jig does not recognize must still be *reported* as
 * removed rather than silently vanish from the diff summary.
 */
function hookCommandsOf(eventValue: Json | undefined): readonly string[] {
  if (!Array.isArray(eventValue)) return [];
  const out: string[] = [];
  for (const group of eventValue) {
    if (!isJsonObject(group)) {
      out.push("(unrecognized entry)");
      continue;
    }
    const inner = group.hooks;
    if (!Array.isArray(inner)) {
      out.push("(entry with no hooks array)");
      continue;
    }
    for (const hook of inner) {
      const command = isJsonObject(hook) ? hook.command : undefined;
      out.push(typeof command === "string" ? command : "(entry with no command)");
    }
  }
  return out;
}

/** Order-preserving replace-and-append: `current`'s keys first, then anything new. */
function mergeInOrder(
  current: JsonObject | undefined,
  replacements: Readonly<Record<string, Json>>,
): JsonObject {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(current ?? {})) {
    const replacement = replacements[key];
    out[key] = replacement === undefined ? value : replacement;
  }
  for (const [key, value] of Object.entries(replacements)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function composePermissions(
  current: Json | undefined,
  managed: ClaudeManagedInput,
): { readonly value: JsonObject; readonly left: readonly string[] } {
  const currentObject = isJsonObject(current) ? current : undefined;
  const value = mergeInOrder(currentObject, {
    allow: [...managed.allow],
    deny: [...managed.deny],
    defaultMode: managed.defaultMode,
  });
  const owned = new Set(["allow", "deny", "defaultMode"]);
  const left = Object.keys(currentObject ?? {})
    .filter((key) => !owned.has(key))
    .map((key) => `permissions.${key}`);
  return { value, left };
}

function composeEnv(current: Json | undefined): {
  readonly value: JsonObject | undefined;
  readonly removed: readonly string[];
} {
  if (!isJsonObject(current)) return { value: undefined, removed: [] };
  const kept: Record<string, Json> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    if (isRetiredEnvKey(key)) removed.push(`${key}=${JSON.stringify(value)}`);
    else kept[key] = value;
  }
  return { value: kept, removed };
}

function removedFromArray(
  key: string,
  current: Json | undefined,
  next: readonly string[],
): readonly Removal[] {
  const keep = new Set(next);
  const gone = asStrings(current).filter((entry) => !keep.has(entry));
  return gone.length === 0 ? [] : [{ key, items: gone }];
}

function removedHooks(current: Json | undefined, next: JsonObject): readonly Removal[] {
  if (!isJsonObject(current)) return [];
  const out: Removal[] = [];
  for (const [event, value] of Object.entries(current)) {
    const keep = new Set(hookCommandsOf(next[event]));
    const gone = hookCommandsOf(value).filter((command) => !keep.has(command));
    if (gone.length > 0) out.push({ key: `hooks.${event}`, items: gone });
  }
  return out;
}

/**
 * A dead key leaves whole. Its items are named for the report — the server
 * names of a `mcpServers` object — so the reader sees what to re-register with
 * `claude mcp add`; a shape jig does not recognize is still reported, as one
 * opaque entry, rather than vanishing from the summary.
 */
function removedDeadKeys(current: JsonObject | undefined): readonly Removal[] {
  if (current === undefined) return [];
  const out: Removal[] = [];
  for (const [key, reason] of DEAD_KEYS) {
    if (!(key in current)) continue;
    const value = current[key];
    const items = isJsonObject(value) ? Object.keys(value) : ["(unrecognized value)"];
    out.push({ key, items, reason });
  }
  return out;
}

function withoutDeadKeys(current: JsonObject | undefined): JsonObject | undefined {
  if (current === undefined) return undefined;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!DEAD_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * @param current the parsed `~/.claude/settings.json`, or `undefined` when the
 *   file does not exist yet. Read for preservation and for the removal report
 *   only — never to decide a managed value.
 */
export function composeClaudeSettings(
  current: JsonObject | undefined,
  managed: ClaudeManagedInput,
): ClaudeComposition {
  const permissions = composePermissions(current?.permissions, managed);
  const env = composeEnv(current?.env);

  const replacements: Record<string, Json> = {
    hooks: managed.hooks,
    permissions: permissions.value,
    sandbox: managed.sandbox,
    ...(env.value === undefined ? {} : { env: env.value }),
  };

  const settings = mergeInOrder(withoutDeadKeys(current), replacements);

  const claimed = new Set(["hooks", "permissions", "sandbox", "env", ...DEAD_KEYS.keys()]);
  const left = [
    ...Object.keys(current ?? {}).filter((key) => !claimed.has(key)),
    ...permissions.left,
    ...(env.value === undefined ? [] : [`env (${Object.keys(env.value).length} keys)`]),
  ];

  const removed: Removal[] = [
    ...removedHooks(current?.hooks, managed.hooks),
    ...removedFromArray(
      "permissions.allow",
      isJsonObject(current?.permissions) ? current.permissions.allow : undefined,
      managed.allow,
    ),
    ...removedFromArray(
      "permissions.deny",
      isJsonObject(current?.permissions) ? current.permissions.deny : undefined,
      managed.deny,
    ),
    ...removedDeadKeys(current),
    ...(env.removed.length === 0 ? [] : [{ key: "env", items: env.removed }]),
  ];

  return { settings, owned: OWNED_KEYS, left, removed };
}

/** Exactly how the file is written: 2-space JSON, one trailing newline. */
export function renderClaudeSettings(settings: JsonObject): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
