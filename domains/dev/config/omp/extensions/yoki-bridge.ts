/**
 * yoki-bridge (omp) — dispatches every yoki hook event omp exposes to the
 * shared harness-bridge runners, replacing yoki-guard.ts.
 *
 * yoki-guard.ts only ever covered tool_call and only ever reimplemented the
 * PreToolUse translation locally (bash/write/edit -> Claude's tool_name +
 * tool_input, plus its own hashline/apply_patch path extraction). That
 * translation has since moved into a shared library
 * (../../claude-profiles/runtime/yoki/scripts/lib/harness/{payload,response}.js)
 * consumed by run-with-flags.js and run-bash-hook.js, so this file does NOT
 * reimplement anything. It is a thin dispatcher:
 *
 *   1. Wrap whatever omp hands the handler as {event, payload, ctx}, where
 *      `payload` is omp's own event object untouched (normalizePayload()
 *      reads fields like payload.toolName / payload.input directly, so
 *      renaming anything here would break it).
 *   2. For every hook registered for that event whose `matcher` covers the
 *      tool being called (a tool_call/tool_result spec's `matcher` is a
 *      `|`-separated set of omp tool names; a missing/`*`/empty matcher, and
 *      every session-scoped event, matches all — see matcherMatchesTool),
 *      spawn
 *        node <YOKI_ROOT>/scripts/hooks/run-with-flags.js --harness omp <id> <script>
 *      (kind:'js') or
 *        node <YOKI_ROOT>/scripts/hooks/run-bash-hook.js --harness omp <hook.sh>
 *      (kind:'bash') with that envelope as JSON stdin. Each spawn already
 *      normalizes the payload, runs the real hook (git-guard.sh unmodified),
 *      and renders the result back into omp's own event-shaped JSON — this
 *      file only has to parse that JSON off stdout and combine verdicts
 *      across the hooks registered for one event (first deny wins).
 *
 * The hook list is NOT hard-coded: it is read from
 * <OMP_AGENT_DIR>/yoki-hooks.json (~/.omp/agent/yoki-hooks.json by default —
 * the directory yoki-switch generates into, honoured under the same env name
 * so writer and reader never diverge; YOKI_HOOKS_MANIFEST names the file
 * outright and wins over both)
 * (an {event: [{id, kind, script, args?, profiles?, timeout?}]} map the
 * generator produces from the composed hook config), falling back to today's
 * two bash guards — git-guard.sh, unattended-guard.sh — on tool_call when
 * that file is absent or unreadable, so a machine that has only run
 * yoki-switch (and not the generator) still gets the guard it has today.
 *
 * The floor those guards represent is DECLARED, not hardcoded: a generated
 * manifest carries a top-level `floor` array of absolute hook-script paths,
 * built from the `guardFloor:` block in the layered permissions.yaml. When
 * it is there, that array IS the floor, and every entry tool_call does not
 * already register is put back (withDeclaredFloor) — raising the floor is
 * an edit to permissions.yaml rather than an edit to this file. The two
 * literal filenames below survive only for a manifest written before that
 * field existed (or for no manifest at all), where the older, coarser rule
 * applies: any tool_call bash guard at all is taken as the generator's own
 * translation of the same settings layers (withFallbackGuards). Either way
 * a manifest may add protection and never remove the floor.
 *
 * Fails OPEN everywhere: every hook invocation is wrapped, a broken/slow/
 * missing hook resolves to "no opinion" (null), and every registered handler
 * catches and swallows so a thrown error never becomes omp's fail-closed
 * default. Timeouts are enforced with ctx.setTimeout, never a raw
 * setTimeout/setInterval, so a hung hook cannot outlive the extension's own
 * lifecycle tracking.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EVENTS = [
	"session_start",
	"before_agent_start",
	"tool_call",
	"tool_result",
	"session_before_compact",
	"session_stop",
	"session_shutdown",
	"tool_approval_requested",
] as const;

type OmpEvent = (typeof EVENTS)[number];

/** omp's agent directory. OMP_AGENT_DIR is the same knob yoki-switch (which
 *  WRITES the manifest into this directory) and pre-permission-guard.js (which
 *  reads `<OMP_AGENT_DIR>/.yoki/permissions.json` out of it) already honour —
 *  reading it here keeps the writer and the reader pointed at one directory on
 *  a machine that has redirected it. Without this the bridge would silently
 *  read ~/.omp/agent while the generator wrote somewhere else. */
const OMP_AGENT_DIR = process.env.OMP_AGENT_DIR || join(homedir(), ".omp", "agent");

/** The generated hook manifest. YOKI_HOOKS_MANIFEST redirects the file itself
 *  (test seam, same escape hatch as YOKI_HOOKS_DIR below) and wins over
 *  OMP_AGENT_DIR — an explicit path is never overridden by a directory
 *  default, so a real installed manifest cannot leak into a run that named
 *  the manifest it wants. */
const HOOKS_MANIFEST_PATH = process.env.YOKI_HOOKS_MANIFEST || join(OMP_AGENT_DIR, "yoki-hooks.json");

/** Installed personal hooks (symlinks into the repo via yoki-switch), used
 *  only for the fallback when the manifest is absent. */
const HOOKS_DIR = process.env.YOKI_HOOKS_DIR || join(homedir(), ".claude", "hooks");

/** Today's guard set, consulted in this order (first deny wins) when no
 *  manifest has been generated yet, or when a manifest predates the `floor`
 *  field. Both are PreToolUse-only, so the fallback populates tool_call and
 *  nothing else. A manifest that declares `floor` overrides this list
 *  entirely — these names are the last resort, not the definition. */
const FALLBACK_BASH_HOOKS = ["git-guard.sh", "unattended-guard.sh"];

/** The runtime the two runner scripts live in. Baked into settings.json's
 *  global env as CLAUDE_PLUGIN_ROOT on every machine that has run
 *  yoki-switch; YOKI_ROOT is the same value under its own name (see
 *  domains/dev/bin/yoki-switch). Without it, nothing can be resolved. */
const YOKI_ROOT = process.env.YOKI_ROOT || process.env.CLAUDE_PLUGIN_ROOT || "";
const RUN_WITH_FLAGS = YOKI_ROOT ? join(YOKI_ROOT, "scripts", "hooks", "run-with-flags.js") : "";
const RUN_BASH_HOOK = YOKI_ROOT ? join(YOKI_ROOT, "scripts", "hooks", "run-bash-hook.js") : "";

/** Matches the 5s timeout the shell hooks are registered with in Claude Code. */
const DEFAULT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Hook manifest
// ---------------------------------------------------------------------------

type HookKind = "js" | "bash";

interface HookSpec {
	id: string;
	kind: HookKind;
	script: string;
	/** kind:'bash' only — the extra argv the wrapped .sh expects (the
	 *  personal layer's `exec bash "$h" session` form). */
	args?: string[];
	profiles?: string[];
	timeout?: number;
	/** tool_call/tool_result only — a `|`-separated set of omp tool names
	 *  (e.g. `"bash"`, `"read|grep|glob"`) the generator translated from the
	 *  Claude matcher (lib/targets/omp-hooks.js). A missing/`*`/empty matcher
	 *  means "every tool". dispatch() runs a spec on a tool event ONLY when
	 *  its matcher matches the tool being called (matcherMatchesTool); the
	 *  fallback/floor guards carry no matcher and so still run on every tool
	 *  call. */
	matcher?: string;
}

type HooksByEvent = Partial<Record<OmpEvent, HookSpec[]>>;

/** A parsed manifest: the per-event specs plus the declared guard floor
 *  (absolute script paths; empty when the manifest predates the field). */
interface Manifest {
	hooks: HooksByEvent;
	floor: string[];
}

function isHookKind(value: unknown): value is HookKind {
	return value === "js" || value === "bash";
}

/** Validates one manifest entry defensively — a malformed entry is dropped
 *  rather than crashing the whole load (fail-open: guard with what parses,
 *  not nothing). */
function toHookSpec(value: unknown): HookSpec | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const { id, kind, script } = record;
	if (typeof id !== "string" || typeof script !== "string" || !isHookKind(kind)) return null;

	const spec: HookSpec = { id, kind, script };
	if (Array.isArray(record.args) && record.args.every((a) => typeof a === "string")) {
		spec.args = record.args as string[];
	}
	if (Array.isArray(record.profiles) && record.profiles.every((p) => typeof p === "string")) {
		spec.profiles = record.profiles as string[];
	}
	if (typeof record.timeout === "number" && Number.isFinite(record.timeout) && record.timeout > 0) {
		spec.timeout = record.timeout;
	}
	if (typeof record.matcher === "string" && record.matcher.length > 0) {
		spec.matcher = record.matcher;
	}
	return spec;
}

/** Absolute paths from the manifest's top-level `floor`. A non-string entry
 *  is dropped rather than fatal, matching toHookSpec's defensive stance: one
 *  malformed entry must not cost us the entries that did parse. */
function toFloorPaths(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Returns null (not {}) when the file is absent, unreadable, or malformed,
 *  so the caller can tell "nothing configured" apart from "fall back". */
function loadHooksManifest(): Manifest | null {
	let raw: string;
	try {
		raw = readFileSync(HOOKS_MANIFEST_PATH, "utf8");
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;

	const hooks: HooksByEvent = {};
	for (const event of EVENTS) {
		const list = (parsed as Record<string, unknown>)[event];
		if (!Array.isArray(list)) continue;
		const specs = list.map(toHookSpec).filter((s): s is HookSpec => s !== null);
		if (specs.length > 0) hooks[event] = specs;
	}
	return { hooks, floor: toFloorPaths((parsed as Record<string, unknown>).floor) };
}

/** One bash spec per floor script, dropping any that is not installed on
 *  this machine — the same existsSync gate the fallback applies, for the
 *  same reason: spawning a path that isn't there buys nothing. */
function floorSpecs(paths: string[]): HookSpec[] {
	return paths
		.map((script) => ({ id: basename(script).replace(/\.sh$/, ""), kind: "bash" as const, script }))
		.filter((spec) => existsSync(spec.script));
}

function fallbackHooksByEvent(): HooksByEvent {
	const specs: HookSpec[] = FALLBACK_BASH_HOOKS.map((name) => ({
		id: name.replace(/\.sh$/, ""),
		kind: "bash" as const,
		script: join(HOOKS_DIR, name),
	})).filter((spec) => existsSync(spec.script));

	return specs.length > 0 ? { tool_call: specs } : {};
}

/** A manifest must never REDUCE protection below the fallback. The fallback
 *  set is the tool_call bash guard chain (git-guard.sh, unattended-guard.sh);
 *  if a generated manifest carries no tool_call bash guard at all — because
 *  the generator could not translate them, or because it wrote an empty
 *  object — taking the manifest at face value would silently disarm guards
 *  that were running a minute earlier. So they are put back at the front of
 *  tool_call in that case. A manifest that DOES ship bash guards is trusted
 *  as-is: it is the generator's translation of the same settings layers, and
 *  prepending duplicates would run every guard twice. */
/** The declared-floor rule: every floor script tool_call does not already
 *  register is prepended. Unlike withFallbackGuards below, this compares
 *  SCRIPT PATHS rather than asking "is there any bash guard at all" — the
 *  manifest names exactly which scripts the floor consists of, so a manifest
 *  that ships one guard and drops another is caught instead of passing on
 *  the strength of the one it kept. A script already registered is not
 *  duplicated. */
function withDeclaredFloor(hooks: HooksByEvent, floor: string[]): HooksByEvent {
	const toolCall = hooks.tool_call ?? [];
	const alreadyRegistered = new Set(toolCall.filter((spec) => spec.kind === "bash").map((spec) => spec.script));
	const missing = floorSpecs(floor.filter((script) => !alreadyRegistered.has(script)));
	if (missing.length === 0) return hooks;
	return { ...hooks, tool_call: [...missing, ...toolCall] };
}

function withFallbackGuards(manifest: HooksByEvent): HooksByEvent {
	const toolCall = manifest.tool_call ?? [];
	if (toolCall.some((spec) => spec.kind === "bash")) return manifest;

	const fallback = fallbackHooksByEvent().tool_call ?? [];
	if (fallback.length === 0) return manifest;

	return { ...manifest, tool_call: [...fallback, ...toolCall] };
}

function resolveHooksByEvent(): HooksByEvent {
	if (!YOKI_ROOT) return {}; // nothing to spawn — fail open across every event
	const manifest = loadHooksManifest();
	if (manifest === null) return fallbackHooksByEvent();
	return manifest.floor.length > 0
		? withDeclaredFloor(manifest.hooks, manifest.floor)
		: withFallbackGuards(manifest.hooks);
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

interface SessionManagerLike {
	getSessionId?: () => string;
	getSessionFile?: () => string;
}

/** ctx.model may be a bare string or a {id} object depending on the model
 *  source; either way the id (or the string itself) is what the hooks care
 *  about. */
function resolveModelId(model: unknown): unknown {
	if (model && typeof model === "object" && "id" in (model as Record<string, unknown>)) {
		return (model as Record<string, unknown>).id;
	}
	return model;
}

function safeCall<T>(fn: (() => T) | undefined): T | undefined {
	if (typeof fn !== "function") return undefined;
	try {
		return fn();
	} catch {
		return undefined;
	}
}

/** Builds the exact envelope normalizePayload('omp', ...) expects:
 *  {event, payload, ctx:{session_id, session_file, cwd, model, context_usage}}.
 *  `payload` is omp's own event object, forwarded verbatim. Never throws —
 *  every accessor is wrapped so a broken ctx still yields a usable envelope. */
function buildEnvelope(event: OmpEvent, payload: unknown, ctx: ExtensionContext): string {
	const session = ctx.sessionManager as SessionManagerLike | undefined;

	const envelope = {
		event,
		payload,
		ctx: {
			session_id: safeCall(() => session?.getSessionId?.()),
			session_file: safeCall(() => session?.getSessionFile?.()),
			cwd: ctx.cwd,
			model: resolveModelId(ctx.model as unknown),
			context_usage: safeCall(() => (ctx as unknown as { getContextUsage?: () => unknown }).getContextUsage?.()),
		},
	};

	return JSON.stringify(envelope);
}

// ---------------------------------------------------------------------------
// Running one hook
// ---------------------------------------------------------------------------

function buildArgs(spec: HookSpec): string[] {
	if (spec.kind === "js") {
		const args = [RUN_WITH_FLAGS, "--harness", "omp", spec.id, spec.script];
		if (spec.profiles && spec.profiles.length > 0) args.push(spec.profiles.join(","));
		return args;
	}
	return [RUN_BASH_HOOK, "--harness", "omp", spec.script, ...(spec.args ?? [])];
}

/** Resolves to the hook's parsed JSON result, or null for "no opinion".
 *  Never rejects. Both runners already render omp-shaped output
 *  ({block,reason} / {input} / {content,isError} / {continue,...} /
 *  {message} / {summary}), so this only has to parse it. */
function runHook(ctx: ExtensionContext, spec: HookSpec, envelopeJson: string): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (v: Record<string, unknown> | null) => {
			if (settled) return;
			settled = true;
			resolve(v);
		};

		const options: { env?: NodeJS.ProcessEnv } = {};
		if (spec.kind === "js") {
			// run-with-flags.js resolves scripts relative to CLAUDE_PLUGIN_ROOT
			// (defaulting to its own __dirname/../.. when unset); pin it
			// explicitly so an unrelated ambient value can't misroute it.
			options.env = { ...process.env, CLAUDE_PLUGIN_ROOT: YOKI_ROOT };
		}

		let child: ReturnType<typeof execFile>;
		try {
			child = execFile("node", buildArgs(spec), options, (err, stdout) => {
				if (err) return done(null); // crash / non-zero exit / kill(): no opinion
				const text = String(stdout).trim();
				if (!text) return done(null); // silence means "no opinion"
				try {
					const parsed = JSON.parse(text);
					done(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null);
				} catch {
					done(null);
				}
			});
		} catch {
			return done(null);
		}

		child.on("error", () => done(null));
		try {
			child.stdin?.on("error", () => done(null));
			child.stdin?.end(envelopeJson);
		} catch {
			done(null);
		}

		// Timeout via ctx.setTimeout (never a raw timer) so a hung hook cannot
		// outlive the extension's own lifecycle tracking.
		if (typeof ctx.setTimeout === "function") {
			ctx.setTimeout(() => {
				try {
					child.kill();
				} catch {
					// already exited
				}
				done(null);
			}, spec.timeout ?? DEFAULT_TIMEOUT_MS);
		}
	});
}

// ---------------------------------------------------------------------------
// Combining verdicts across the hooks registered for one event
// ---------------------------------------------------------------------------

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The omp tool being called, read straight off the event payload — the same
 *  `payload.toolName` field normalizePayload('omp', …) keys the run-with-flags
 *  envelope on. Returns undefined for a non-tool event (which carries no
 *  toolName) or a malformed payload, in which case matcherMatchesTool fails
 *  open. */
function resolveOmpToolName(payload: unknown): string | undefined {
	if (payload && typeof payload === "object") {
		const name = (payload as Record<string, unknown>).toolName;
		if (typeof name === "string" && name.length > 0) return name;
	}
	return undefined;
}

/** Whether a spec registered for a tool event should run for `toolName`.
 *  `matcher` is the `|`-separated set of omp tool names the generator wrote
 *  (lib/targets/omp-hooks.js); a missing/`*`/empty matcher means "every tool"
 *  (the fallback and floor guards carry none, so they keep running on every
 *  tool call). Matching is case-insensitive. FAILS OPEN: an unresolvable tool
 *  name or any parse error runs the hook — a guard must never be silently
 *  skipped because its matcher could not be read. Exported for unit tests. */
export function matcherMatchesTool(matcher: string | undefined, toolName: string | undefined): boolean {
	try {
		if (matcher === undefined || matcher === null) return true;
		const raw = String(matcher).trim();
		if (raw === "" || raw === "*") return true;
		const set = raw
			.split("|")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
		if (set.length === 0 || set.includes("*")) return true;
		const tool = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
		if (tool === "") return true; // no tool name to gate on -> fail open
		return set.includes(tool);
	} catch {
		return true;
	}
}

/** Runs every hook registered for `event` in order (personal guards first,
 *  matching PreToolUse ordering elsewhere) and combines their verdicts.
 *  Returns undefined for "no opinion" everywhere, matching what an omp
 *  handler returns to leave the default behaviour untouched. */
async function dispatch(
	event: OmpEvent,
	payload: unknown,
	ctx: ExtensionContext,
	hooks: HookSpec[],
): Promise<Record<string, unknown> | undefined> {
	let envelope: string;
	try {
		envelope = buildEnvelope(event, payload, ctx);
	} catch {
		return undefined;
	}

	// Run a spec only when its matcher covers the tool being called. For a
	// non-tool event resolveOmpToolName is undefined and every spec's matcher
	// (`*`/none) passes, so this is a no-op there. The fallback/floor guards
	// carry no matcher and so still run on every tool call — the guard floor
	// is not dropped.
	const toolName = resolveOmpToolName(payload);
	const specs = hooks.filter((spec) => matcherMatchesTool(spec.matcher, toolName));

	switch (event) {
		case "tool_call": {
			let input: unknown;
			for (const spec of specs) {
				const r = await runHook(ctx, spec, envelope);
				if (r?.block === true) return { block: true, reason: asNonEmptyString(r.reason) ?? "blocked by yoki guard" };
				if (r && "input" in r && r.input !== undefined) input = r.input;
			}
			return input !== undefined ? { input } : undefined;
		}

		case "tool_result": {
			let content: string | undefined;
			for (const spec of specs) {
				const r = await runHook(ctx, spec, envelope);
				if (r?.isError === true) return { content: asNonEmptyString(r.content) ?? "", isError: true };
				const c = asNonEmptyString(r?.content);
				if (c) content = c;
			}
			return content !== undefined ? { content } : undefined;
		}

		case "session_stop": {
			const contexts: string[] = [];
			for (const spec of specs) {
				const r = await runHook(ctx, spec, envelope);
				if (r?.decision === "block") return { decision: "block", reason: asNonEmptyString(r.reason) ?? "" };
				const c = asNonEmptyString(r?.additionalContext);
				if (c) contexts.push(c);
			}
			return contexts.length > 0 ? { continue: true, additionalContext: contexts.join("\n") } : { continue: true };
		}

		case "before_agent_start": {
			const contents: string[] = [];
			for (const spec of specs) {
				const r = await runHook(ctx, spec, envelope);
				const message = r?.message;
				const content =
					message && typeof message === "object" ? asNonEmptyString((message as Record<string, unknown>).content) : undefined;
				if (content) contents.push(content);
			}
			return contents.length > 0 ? { message: { role: "user", content: contents.join("\n") } } : undefined;
		}

		case "session_before_compact": {
			const summaries: string[] = [];
			for (const spec of specs) {
				const r = await runHook(ctx, spec, envelope);
				const s = asNonEmptyString(r?.summary);
				if (s) summaries.push(s);
			}
			return summaries.length > 0 ? { summary: summaries.join("\n\n") } : undefined;
		}

		default:
			// session_start, session_shutdown, tool_approval_requested: the
			// spike defines no return contract for these — run every hook for
			// its side effects (logging, warn-once markers) and report nothing.
			for (const spec of specs) {
				await runHook(ctx, spec, envelope);
			}
			return undefined;
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	const manifest = resolveHooksByEvent();

	for (const event of EVENTS) {
		pi.on(event, async (payload: unknown, ctx: ExtensionContext) => {
			// Everything inside try: omp treats a thrown handler as fail-closed
			// (the call/session is blocked), and yoki guards are fail-open by
			// policy — a guard that breaks the agent when it itself is broken is
			// worse than no guard.
			try {
				const hooks = manifest[event];
				if (!hooks || hooks.length === 0) return undefined;
				return await dispatch(event, payload, ctx, hooks);
			} catch {
				return undefined;
			}
		});
	}
}
