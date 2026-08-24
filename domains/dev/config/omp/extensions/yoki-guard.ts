/**
 * yoki-guard (omp) — runs the yoki PreToolUse hooks against omp's tool calls.
 *
 * omp ships approvalMode: yolo by default and auto-executes repo-local .omp/
 * extensions, so without this the same machine runs Claude Code behind
 * git-guard and omp behind nothing. Same rationale as the pi version
 * (domains/dev/config/pi/extensions/yoki-guard.ts), ported to omp's hook API.
 *
 * It does NOT reimplement the rules. It shells out to the very files Claude
 * Code runs, so force push, push to main, reset --hard, --no-verify, the
 * preflight PR gate, the .yoki.json relaxation and the unattended guard all
 * behave identically in every agent and cannot drift apart.
 *
 * Fails OPEN everywhere. omp itself treats a thrown tool_call handler as
 * fail-closed (the call is blocked), which is the opposite of yoki's policy —
 * a guard that breaks the agent when it itself is broken is worse than no
 * guard — so every path in here is wrapped and nothing may throw.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/** Installed hooks, not the repo sources: ~/.claude/hooks/* are symlinks into
 *  the repo, so this follows whatever yoki-switch composed. YOKI_HOOKS_DIR
 *  redirects it (test seam / sandbox escape hatch, same as the pi version). */
const HOOKS_DIR = process.env.YOKI_HOOKS_DIR || join(homedir(), ".claude", "hooks");

/** Consulted in this order; the first deny wins. Mirrors the PreToolUse order
 *  in settings.personal.json, where guards run before rewriters. */
const HOOKS = ["git-guard.sh", "unattended-guard.sh"];

/** The shell hooks are registered with a 5s timeout in Claude Code; match it. */
const TIMEOUT_MS = 5000;

/**
 * omp's edit tool consumes hashline patches — one `input` string holding
 * `[PATH#TAG]` sections — or, for models on the apply_patch contract, an
 * envelope with `*** Update File: <path>` headers. A `replace`-mode variant
 * passes a plain `path`. Pull every referenced path so the hooks judge each
 * file the call touches.
 */
function editPaths(input: Record<string, unknown>): string[] {
	if (typeof input.path === "string") return [input.path];
	const text = typeof input.input === "string" ? input.input : "";
	const paths = new Set<string>();
	for (const m of text.matchAll(/^\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/gm)) paths.add(m[1]);
	for (const m of text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) paths.add(m[1].trim());
	return [...paths];
}

/** omp's tool vocabulary is lowercase; the hooks speak Claude Code's
 *  PreToolUse schema. One omp call can map to several payloads (a hashline
 *  patch touching many files). Tools with no counterpart return [] and are
 *  never sent — the hooks would ignore them anyway. */
function toPreToolUse(toolName: string, input: Record<string, unknown>): Record<string, unknown>[] {
	switch (toolName) {
		case "bash":
			return typeof input.command === "string"
				? [{ tool_name: "Bash", tool_input: { command: input.command } }]
				: [];
		case "write":
			return typeof input.path === "string"
				? [{ tool_name: "Write", tool_input: { file_path: input.path } }]
				: [];
		case "edit":
		case "apply_patch":
			return editPaths(input).map((p) => ({ tool_name: "Edit", tool_input: { file_path: p } }));
		default:
			return [];
	}
}

interface HookVerdict {
	deny?: string;
	context?: string;
}

/** Resolves to a verdict, or null for "no opinion". Never rejects. */
function runHook(script: string, payload: unknown): Promise<HookVerdict | null> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (v: HookVerdict | null) => {
			if (!settled) {
				settled = true;
				resolve(v);
			}
		};

		try {
			const child = execFile("bash", [script], { timeout: TIMEOUT_MS }, (err, stdout) => {
				// A non-zero exit means the hook itself failed (syntax error from a
				// half-finished merge, missing jq, timeout). Treat as no opinion.
				if (err) return done(null);
				const text = String(stdout).trim();
				if (!text) return done(null); // silence means allow

				try {
					const out = JSON.parse(text)?.hookSpecificOutput;
					if (out?.permissionDecision === "deny") {
						return done({ deny: String(out.permissionDecisionReason ?? "blocked by yoki guard") });
					}
					// The pr-gate release path carries an instruction without a
					// decision; surface it to the human instead of dropping it.
					if (out?.additionalContext) return done({ context: String(out.additionalContext) });
					return done(null);
				} catch {
					return done(null);
				}
			});

			child.on("error", () => done(null));
			child.stdin?.on("error", () => done(null));
			child.stdin?.end(JSON.stringify(payload));
		} catch {
			done(null);
		}
	});
}

export default function (pi: HookAPI): void {
	const available = HOOKS.map((name) => join(HOOKS_DIR, name)).filter((p) => existsSync(p));

	if (available.length === 0) {
		// yoki-switch has not run on this machine. Say so once rather than
		// silently guarding nothing — a guard believed to be on is worse than a
		// guard known to be off.
		pi.on("session_start", async (_event, ctx) => {
			ctx.ui.notify("yoki-guard: no hooks found in ~/.claude/hooks — run yoki-switch apply", "warning");
		});
		return;
	}

	pi.on("tool_call", async (event, ctx) => {
		// Everything inside try: omp blocks the call when a handler throws
		// (fail-closed), and yoki guards are fail-open by policy.
		try {
			const payloads = toPreToolUse(event.toolName, event.input as Record<string, unknown>);
			if (payloads.length === 0) return;

			// session_id keys the hooks' warn-once markers; transcript_path is what
			// the shared-checkout nudge reads. omp's own session file means it sees
			// other omp sessions.
			const session = ctx.sessionManager as {
				getSessionId?: () => string;
				getSessionFile?: () => string;
			};
			const sessionId = session?.getSessionId?.() ?? "omp-nosession";
			const transcript = session?.getSessionFile?.() ?? "";

			for (const payload of payloads) {
				const full = {
					...payload,
					session_id: sessionId,
					cwd: ctx.cwd,
					transcript_path: transcript,
				};

				for (const script of available) {
					const verdict = await runHook(script, full);
					if (verdict?.deny) return { block: true, reason: verdict.deny };
					if (verdict?.context) ctx.ui.notify(verdict.context, "warning");
				}
			}
		} catch {
			return; // fail open
		}
	});
}
