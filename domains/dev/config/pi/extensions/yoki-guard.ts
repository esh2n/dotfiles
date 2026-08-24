/**
 * yoki-guard — runs the yoki PreToolUse hooks against pi's tool calls.
 *
 * pi ships no permission layer by design ("Pi is aggressively extensible so it
 * doesn't have to dictate your workflow"), so without this the same machine
 * runs Claude Code behind git-guard and pi behind nothing.
 *
 * It does NOT reimplement the rules. It shells out to the very files Claude
 * Code runs, so force push, push to main, reset --hard, --no-verify, the
 * preflight PR gate, the .yoki.json relaxation and the unattended guard all
 * behave identically in both agents and cannot drift apart. The repo's own
 * convention is that the hook is the authority; this keeps that true.
 *
 * Fails OPEN everywhere — a guard that breaks the agent when it itself is
 * broken is worse than no guard. That is the same call the shell hooks make
 * (they exit 0 on every internal error) and the same one the `bash -n`
 * wrapper in settings makes.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Installed hooks, not the repo sources: ~/.claude/hooks/* are symlinks into
 *  the repo, so this follows whatever yoki-switch composed.
 *
 *  YOKI_HOOKS_DIR redirects it. That is an escape hatch as much as a test seam
 *  — pointing it at an empty directory turns the guard off — but the rules it
 *  runs already honour GIT_GUARD_DISABLED=1, so this adds no reach that a
 *  determined caller did not already have, and it keeps the guard runnable
 *  where ~/.claude is not the install root (a sandbox, another user). */
const HOOKS_DIR = process.env.YOKI_HOOKS_DIR || join(homedir(), ".claude", "hooks");

/** Consulted in this order; the first deny wins. Mirrors the PreToolUse order
 *  in settings.personal.json, where guards run before rewriters. */
const HOOKS = ["git-guard.sh", "unattended-guard.sh"];

/** A hook that hangs would hang the agent. The shell hooks are registered with
 *  a 5s timeout in Claude Code; match it. */
const TIMEOUT_MS = 5000;

/** pi's tool vocabulary is lowercase and uses `path`; the hooks speak Claude
 *  Code's PreToolUse schema. Tools with no counterpart (read, grep, find, ls)
 *  return null and are never sent — the hooks would ignore them anyway, and
 *  spawning two processes per read would be a real cost on a hot path. */
function toPreToolUse(toolName: string, input: Record<string, unknown>): Record<string, unknown> | null {
	switch (toolName) {
		case "bash":
			return typeof input.command === "string" ? { tool_name: "Bash", tool_input: { command: input.command } } : null;
		case "write":
			return typeof input.path === "string" ? { tool_name: "Write", tool_input: { file_path: input.path } } : null;
		case "edit":
			return typeof input.path === "string" ? { tool_name: "Edit", tool_input: { file_path: input.path } } : null;
		default:
			return null;
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
				// half-finished merge, missing jq, timeout). Treat as no opinion:
				// this exact failure mode once killed every Bash call in every
				// session, which is what fail-open exists to prevent.
				if (err) return done(null);
				const text = String(stdout).trim();
				if (!text) return done(null); // silence means allow

				try {
					const out = JSON.parse(text)?.hookSpecificOutput;
					if (out?.permissionDecision === "deny") {
						return done({ deny: String(out.permissionDecisionReason ?? "blocked by yoki guard") });
					}
					// The pr-gate release path carries an instruction without a
					// decision. There is no way to inject it into the model's context
					// from tool_call, so surface it to the human instead of dropping it.
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

export default function (pi: ExtensionAPI) {
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
		const payload = toPreToolUse(event.toolName, event.input as Record<string, unknown>);
		if (!payload) return;

		// session_id keys the hooks' warn-once markers, so re-running the same
		// command in one pi session proceeds exactly as it does in Claude Code.
		// transcript_path is what the shared-checkout nudge reads to notice other
		// live sessions; pi's own session file means it sees other pi sessions.
		const session = ctx.sessionManager;
		const full = {
			...payload,
			session_id: session.getSessionId?.() ?? "pi-nosession",
			cwd: ctx.cwd,
			transcript_path: session.getSessionFile?.() ?? "",
		};

		for (const script of available) {
			const verdict = await runHook(script, full);
			if (verdict?.deny) return { block: true, reason: verdict.deny };
			if (verdict?.context) ctx.ui.notify(verdict.context, "warning");
		}
	});
}
