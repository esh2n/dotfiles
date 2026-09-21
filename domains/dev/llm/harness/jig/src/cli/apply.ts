/**
 * `jig apply` — regenerate pi/dsh/litellm's tier config from the canonical
 * `policy/tiers.json` and either show the diff (default) or write it
 * (`--write`). Thin: argv parsing and text formatting only, delegating the
 * actual decision-making to `app/apply/apply-tiers.ts`. The composition
 * root (`./jig.ts`) builds the real `ApplyPorts` and resolves the repo-root
 * paths; this module never touches `process.env` or the filesystem itself,
 * so it is testable with any fake `ApplyPorts` and any paths.
 */

import { type ClaudeApplyPaths, applyClaudeSettings } from "../app/apply/apply-claude";
import {
  ALL_APPLY_TARGETS,
  type ApplyTarget,
  type ApplyTargetPaths,
  type TargetResult,
  applyTiers,
} from "../app/apply/apply-tiers";
import type { ApplyPorts } from "../app/apply/ports";

export interface ApplyCliResult {
  readonly stdout: string;
  readonly code: number;
}

interface ParsedArgs {
  readonly targets: readonly ApplyTarget[];
  readonly write: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs | { readonly error: string } {
  let targetArg: string | undefined;
  let write = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") {
      write = true;
    } else if (arg === "--target") {
      i++;
      targetArg = args[i];
    } else if (arg?.startsWith("--target=")) {
      targetArg = arg.slice("--target=".length);
    } else {
      return { error: `unknown argument ${JSON.stringify(arg)}` };
    }
  }

  const targetName = targetArg ?? "all";
  if (targetName === "all") {
    return { targets: ALL_APPLY_TARGETS, write };
  }
  // "claude" is deliberately not folded into "all" this phase — see
  // apply-tiers.ts's ApplyTarget comment: it never runs through applyTiers.
  if (targetName === "claude") {
    return { targets: ["claude"], write };
  }
  if ((ALL_APPLY_TARGETS as readonly string[]).includes(targetName)) {
    return { targets: [targetName as ApplyTarget], write };
  }
  return {
    error: `unknown --target ${JSON.stringify(targetName)} (expected pi, dsh, litellm, claude, or all)`,
  };
}

function formatResult(result: TargetResult): string {
  const lines: string[] = [`== ${result.target} ==`, `outcome: ${result.outcome}`];
  if (result.message) {
    lines.push(`message: ${result.message}`);
  }
  if (result.diff !== "") {
    lines.push("--- diff (current vs generated) ---", result.diff);
  } else if (result.preview !== undefined) {
    lines.push("--- generated block (no diff: markers not present yet) ---", result.preview);
  } else {
    lines.push("(no differences)");
  }
  if (result.dropped.length > 0) {
    lines.push(`dropped fields (${result.dropped.length}):`);
    for (const d of result.dropped) {
      lines.push(`  - ${d.tier}:${d.field} — ${d.reason}`);
    }
  }
  return lines.join("\n");
}

/** A --write request for pi/dsh that could not actually write (no markers, no dest) is a real failure; litellm refusing --write is the documented, correct behavior. */
function isBlockedWriteFailure(result: TargetResult, wroteRequested: boolean): boolean {
  if (!wroteRequested || result.target === "litellm") return false;
  return result.outcome === "markers-missing" || result.outcome === "dest-missing";
}

export async function applyCli(
  args: readonly string[],
  ports: ApplyPorts,
  paths: {
    readonly tiersJsonPath: string;
    readonly destPaths: ApplyTargetPaths;
    /** Only needed for `--target claude`; the pi/dsh/litellm path never touches it. */
    readonly claudePaths?: ClaudeApplyPaths;
  },
): Promise<ApplyCliResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    return { stdout: `jig apply: ${parsed.error}\n`, code: 2 };
  }

  // "claude" never reaches applyTiers (see ApplyTarget's comment) — dispatch
  // it here instead, on its own dry-run-only path.
  if (parsed.targets.length === 1 && parsed.targets[0] === "claude") {
    if (paths.claudePaths === undefined) {
      return { stdout: "jig apply: --target claude is not configured for this invocation\n", code: 2 };
    }
    const result = await applyClaudeSettings(paths.claudePaths, ports, parsed.write);
    // Never a "conflict" outcome for claude (no hand-edit-manifest tracking
    // yet), and a refused --write is informational, same as litellm's — so
    // this path always exits 0.
    return { stdout: `${formatResult(result)}\n`, code: 0 };
  }

  const report = await applyTiers(
    { tiersJsonPath: paths.tiersJsonPath, destPaths: paths.destPaths, options: parsed },
    ports,
  );

  const out = report.results.map(formatResult).join("\n\n");
  const hasBlockedWrite = report.results.some((r) => isBlockedWriteFailure(r, parsed.write));
  const code = report.hasConflict || hasBlockedWrite ? 1 : 0;

  return { stdout: `${out}\n`, code };
}
