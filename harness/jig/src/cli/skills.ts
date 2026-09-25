/**
 * `jig skills hide|show [--write] [--root <dir>]` — argv and formatting for the experiment's
 * listing switch. Thin: the edit is `domain/skills/invocation.ts`, the walk is
 * `app/skills/toggle-invocation.ts`, and this module touches neither the filesystem nor the
 * environment, so it is testable with any fake ports and any root.
 */

import {
  type InvocationMode,
  type SkillRootPorts,
  type TogglePlan,
  toggleSkillInvocation,
} from "../app/skills/toggle-invocation";
import type { RefusalReason } from "../domain/skills/invocation";

export interface SkillsCliResult {
  readonly stdout: string;
  readonly code: number;
}

const USAGE = "usage: jig skills <hide|show> [--write] [--root <dir>]\n";

interface ParsedArgs {
  readonly mode: InvocationMode;
  readonly write: boolean;
  readonly root?: string;
}

function parseArgs(args: readonly string[]): ParsedArgs | { readonly error: string } {
  const [subcommand, ...rest] = args;
  if (subcommand !== "hide" && subcommand !== "show") {
    return { error: `unknown skills subcommand ${JSON.stringify(subcommand ?? "")}` };
  }

  let write = false;
  let root: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--write") write = true;
    else if (arg === "--root") {
      index += 1;
      root = rest[index];
    } else if (arg?.startsWith("--root=")) root = arg.slice("--root=".length);
    else return { error: `unknown argument ${JSON.stringify(arg)}` };
  }
  if (root === "") return { error: "--root needs a directory" };

  return { mode: subcommand, write, ...(root === undefined ? {} : { root }) };
}

const REFUSAL: Readonly<Record<RefusalReason, string>> = {
  "user-invocable": "sets user-invocable, so hiding it would leave no way to invoke it",
  "no-frontmatter": "has no frontmatter to edit",
};

function render(plan: TogglePlan): string {
  const verb = plan.mode === "hide" ? "hide" : "show";
  const lines = [`root: ${plan.root}`];

  if (plan.changing.length === 0) {
    lines.push(`nothing to ${verb}: ${plan.unchanged.length} skill(s) already in that state.`);
  } else {
    lines.push(
      plan.written
        ? `${verb === "hide" ? "hid" : "showed"} ${plan.changing.length} skill(s):`
        : `would ${verb} ${plan.changing.length} skill(s):`,
    );
    for (const entry of plan.changing) lines.push(`  - ${entry.name}`);
    lines.push(`unchanged: ${plan.unchanged.length}`);
  }

  if (plan.refused.length > 0) {
    lines.push(`left alone (${plan.refused.length}):`);
    for (const entry of plan.refused) lines.push(`  - ${entry.name} — ${REFUSAL[entry.why]}`);
  }

  if (plan.changing.length > 0 && !plan.written) {
    lines.push("dry run: nothing written. Re-run with --write to apply.");
  }
  // The list above is the review step for `show`, which cannot tell a skill jig hid from one
  // its author hid — see `domain/skills/invocation.ts`.
  if (plan.mode === "show" && plan.changing.length > 0) {
    lines.push("check the list: a skill its author hid looks exactly like one jig hid.");
  }

  return `${lines.join("\n")}\n`;
}

export async function skillsCli(
  args: readonly string[],
  ports: SkillRootPorts,
  defaultRoot: string,
): Promise<SkillsCliResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) return { stdout: `${parsed.error}\n${USAGE}`, code: 2 };

  try {
    const plan = await toggleSkillInvocation(parsed.root ?? defaultRoot, parsed.mode, ports, {
      write: parsed.write,
    });
    return { stdout: render(plan), code: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: `jig skills ${parsed.mode}: ${message}\n`, code: 1 };
  }
}
