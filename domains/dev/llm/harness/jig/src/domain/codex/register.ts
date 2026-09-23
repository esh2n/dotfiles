/**
 * Registering jig's guard with codex, as pure text transforms.
 *
 * codex reads hooks from `~/.codex/hooks.json` (Claude Code's shape,
 * wrapped in a top-level `hooks` key) and runs a handler only when
 * `~/.codex/config.toml` carries a trust entry for it:
 *
 *   [hooks.state."<hooks.json path>:<event>:<group>:<handler>"]
 *   trusted_hash = "sha256:<hex of the handler's canonical identity>"
 *   enabled = true
 *
 * The key is positional — the group's index in the event's array and the
 * handler's index in the group — so a hook silently stops running when
 * something is inserted ahead of it. Two consequences shape this module:
 * jig's group goes at index 0 of PreToolUse (yoki's own generator keeps
 * foreign groups in front, in order, so first stays first), and the trust
 * entry is recomputed from the file as finally written, never assumed.
 *
 * The canonical identity and hash follow what codex checks (reproduced by
 * yoki's `codex-trust.js`, verified against a live trusted entry): the
 * handler normalized to `{type, command, timeout, async}` under
 * `{event_name, matcher?, hooks:[…]}`, keys sorted recursively, compact
 * JSON, sha256 hex.
 */

export const PRE_TOOL_USE = "PreToolUse";
export const PRE_TOOL_USE_LABEL = "pre_tool_use";

/** The fragment that marks a handler as jig's guard, whatever paths it carries. */
export const JIG_CODEX_MARK = "hooks pre-tool-use --harness codex";

export const JIG_BLOCK_BEGIN = "# jig:begin hooks";
export const JIG_BLOCK_END = "# jig:end hooks";

interface Handler {
  readonly type: "command";
  readonly command: string;
  readonly timeout: number;
  readonly async?: boolean;
}

interface Group {
  readonly matcher?: string;
  readonly hooks: readonly Handler[];
}

export type HooksDocument = { hooks: Record<string, unknown[]> } & Record<string, unknown>;

export interface RegistrationInput {
  /** The exact command line codex will run. Absolute paths only: no env reaches the hook. */
  readonly command: string;
  /** Tool names, `|`-separated, as codex matches them. */
  readonly matcher: string;
  readonly timeoutSeconds: number;
}

export interface RegistrationPlan {
  /** hooks.json as it should read afterwards. */
  readonly hooksJson: string;
  readonly hooksJsonChanged: boolean;
  readonly groupIndex: number;
  readonly handlerIndex: number;
  /** What codex hashes for this handler, compact and key-sorted. */
  readonly canonicalIdentity: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A group holding jig's guard handler, whatever else it carries. Shared with `jig retire yoki`, which keeps it. */
export function isJigGroup(group: unknown): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(
    (h) => isRecord(h) && typeof h.command === "string" && h.command.includes(JIG_CODEX_MARK),
  );
}

/**
 * hooks.json as an object of event arrays, every other top-level key kept.
 * Shared with `jig retire yoki` (`domain/retire/codex-config.ts`), so both
 * commands read the file the same way and refuse the same malformed shapes.
 */
export function parseHooksDocument(text: string | undefined): HooksDocument {
  if (text === undefined || text.trim() === "") return { hooks: {} };
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("hooks.json: expected an object at the top level");
  const hooks = parsed.hooks;
  if (hooks !== undefined && !isRecord(hooks)) {
    throw new Error('hooks.json: "hooks" must be an object of event arrays');
  }
  const events: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) throw new Error(`hooks.json: hooks.${event} must be an array`);
    events[event] = groups;
  }
  return { ...parsed, hooks: events };
}

/**
 * Place jig's PreToolUse group at index 0, replacing an earlier jig group
 * wherever it sat. Everything else in the file is preserved as parsed.
 */
export function planRegistration(
  existing: string | undefined,
  input: RegistrationInput,
): RegistrationPlan {
  const doc = parseHooksDocument(existing);
  const group: Group = {
    matcher: input.matcher,
    hooks: [{ type: "command", command: input.command, timeout: input.timeoutSeconds }],
  };
  const others = (doc.hooks[PRE_TOOL_USE] ?? []).filter((g) => !isJigGroup(g));
  const next: HooksDocument = {
    ...doc,
    hooks: { ...doc.hooks, [PRE_TOOL_USE]: [group, ...others] },
  };
  const hooksJson = `${JSON.stringify(next, null, 2)}\n`;
  return {
    hooksJson,
    hooksJsonChanged: existing === undefined || existing !== hooksJson,
    groupIndex: 0,
    handlerIndex: 0,
    canonicalIdentity: canonicalIdentity(
      PRE_TOOL_USE_LABEL,
      group.matcher,
      group.hooks[0] as Handler,
    ),
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
  return out;
}

/** The string codex hashes for one handler. */
export function canonicalIdentity(
  eventLabel: string,
  matcher: string | undefined,
  handler: Handler,
): string {
  const normalized = {
    type: "command",
    command: handler.command,
    timeout: Math.max(1, handler.timeout),
    async: handler.async === true,
  };
  const identity: Record<string, unknown> = { event_name: eventLabel, hooks: [normalized] };
  if (matcher !== undefined) identity.matcher = matcher;
  return JSON.stringify(sortKeysDeep(identity));
}

export function trustKey(
  hooksJsonPath: string,
  eventLabel: string,
  groupIndex: number,
  handlerIndex: number,
): string {
  return `${hooksJsonPath}:${eventLabel}:${groupIndex}:${handlerIndex}`;
}

/** The `[hooks.state.…]` table for one handler, as TOML text. */
export function trustTable(key: string, hashHex: string): string {
  return `[hooks.state."${key}"]\ntrusted_hash = "sha256:${hashHex}"\nenabled = true\n`;
}

export interface TrustPlan {
  readonly configToml: string;
  readonly changed: boolean;
}

/**
 * Upsert jig's managed block at the end of config.toml. The block holds
 * only `[hooks.state]` tables, so appending it after any other table is
 * valid TOML. A previous jig block is removed wholesale, so a stale key
 * from an earlier index never lingers to collide with someone else's.
 */
export function planTrust(existing: string | undefined, tables: readonly string[]): TrustPlan {
  const before = existing ?? "";
  const stripped = removeJigBlock(before).replace(/\s+$/, "");
  const block = `${JIG_BLOCK_BEGIN}\n${tables.join("\n")}${JIG_BLOCK_END}\n`;
  const configToml = stripped === "" ? block : `${stripped}\n\n${block}`;
  return { configToml, changed: configToml !== before };
}

function removeJigBlock(text: string): string {
  return removeMarkedBlock(text, JIG_BLOCK_BEGIN, JIG_BLOCK_END);
}

/**
 * The text without one marked block (markers included). Shared with the MCP
 * block `jig apply --target codex` keeps in the same file (`./config.ts`):
 * the two blocks have distinct markers and each command removes only its own.
 */
export function removeMarkedBlock(text: string, beginMarker: string, endMarker: string): string {
  const begin = text.indexOf(beginMarker);
  if (begin === -1) return text;
  const endAt = text.indexOf(endMarker, begin);
  if (endAt === -1) throw new Error(`config.toml: "${beginMarker}" without "${endMarker}"`);
  const end = endAt + endMarker.length;
  return text.slice(0, begin) + text.slice(end).replace(/^\n/, "");
}

/** Does the TOML already carry a table for this key outside jig's block? Such a duplicate would break codex's config load. */
export function keyDeclaredElsewhere(configToml: string, key: string): boolean {
  const outside = removeJigBlock(configToml);
  return outside.includes(`[hooks.state."${key}"]`);
}
