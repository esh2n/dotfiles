/**
 * `jig` with no arguments on a terminal: pick a harness, pick where it runs,
 * and go. The point is not to be a launcher — every path here is something
 * you could type — but to make the one choice that matters visible at the
 * moment it is made: host or box, and with a box, whether it gets a token.
 *
 * All prompting goes through the `Prompter` port, so the whole flow is
 * testable by answering with numbers.
 */

import { createBox } from "../app/box/create";
import type { BoxAgent } from "../app/box/kit";
import { listBoxes } from "../app/box/list";
import type { BoxPorts, BoxResult } from "../app/box/ports";
import { resumeBox } from "../app/box/resume";
import type { BoxCliContext, BoxCliResult } from "./box";

export interface Prompter {
  /** Returns the chosen index, or `undefined` when the answer was empty or unusable. */
  select(title: string, options: readonly string[]): Promise<number | undefined>;
  confirm(question: string): Promise<boolean>;
}

export interface Harness {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  /**
   * How this harness is told to pick the last session back up, or `undefined`
   * when it has no such flag. Read from each `--help` on this machine
   * (2026-09-22): claude `--continue`, codex `resume --last`, pi `--continue`,
   * omp `--continue`. dsh is not installed here, so it gets no continue
   * option rather than a guessed one.
   */
  readonly continueArgs?: readonly string[];
  /** The built-in sbx agent, when there is one. */
  readonly boxAgent?: BoxAgent;
}

export const HARNESSES: readonly Harness[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    continueArgs: ["--continue"],
    boxAgent: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    continueArgs: ["resume", "--last"],
    boxAgent: "codex",
  },
  { id: "pi", label: "pi", command: "pi", continueArgs: ["--continue"] },
  { id: "omp", label: "omp", command: "omp", continueArgs: ["--continue"] },
  { id: "dsh", label: "DSH", command: "dsh" },
];

export interface InteractiveDeps {
  readonly prompt: Prompter;
  /** Whether a command is on PATH — what marks a harness "(not installed)". */
  readonly which: (command: string) => Promise<boolean>;
  /** Start a harness on the host with the terminal inherited; resolves with its exit code. */
  readonly spawn: (command: string, args: readonly string[], cwd: string) => Promise<number>;
  readonly box: BoxPorts;
  readonly context: BoxCliContext;
}

const CANCELLED: BoxCliResult = { stdout: "", code: 0 };

function render(result: BoxResult): BoxCliResult {
  const body = result.lines.join("\n");
  return { stdout: body === "" ? "" : `${body}\n`, code: result.code };
}

async function runOnHost(harness: Harness, deps: InteractiveDeps): Promise<BoxCliResult> {
  const options = ["new session"];
  if (harness.continueArgs !== undefined) options.push("continue the last session");

  const choice = await deps.prompt.select(`${harness.label} — session`, options);
  if (choice === undefined) return CANCELLED;

  const args = choice === 1 ? (harness.continueArgs ?? []) : [];
  return { stdout: "", code: await deps.spawn(harness.command, args, deps.context.cwd) };
}

async function runInBox(harness: Harness, deps: InteractiveDeps): Promise<BoxCliResult> {
  const agent = harness.boxAgent;
  if (agent === undefined) {
    return {
      stdout: `jig: no built-in sbx agent for ${harness.id} yet — run it on the host\n`,
      code: 2,
    };
  }

  const repoRoot = await deps.box.git.toplevel(deps.context.cwd);
  if (repoRoot === undefined) {
    return { stdout: `jig: ${deps.context.cwd} is not inside a git repository\n`, code: 2 };
  }

  const listed = await listBoxes({ repoPath: repoRoot }, deps.box);
  if (listed.error !== undefined) {
    // An sbx that cannot answer is not "there are no boxes here". Offering
    // "new box" as the only option would hide the failure and invite a
    // duplicate of a box that already exists.
    return { stdout: `jig box list: sbx ls failed\n${listed.error}\n`, code: listed.code };
  }

  const options = [
    "new box",
    ...listed.boxes.map((box) => `resume ${box.name} (${box.status}, ${box.lastUsedAt})`),
  ];
  const choice = await deps.prompt.select(`${harness.label} — box`, options);
  if (choice === undefined) return CANCELLED;

  if (choice > 0) {
    const box = listed.boxes[choice - 1];
    if (box === undefined) return CANCELLED;
    return render(
      await resumeBox({ name: box.name, repoRoot, dryRun: deps.context.dryRun }, deps.box),
    );
  }

  // The one question a new box has to ask: a box that can open a pull request
  // is a box that holds a GitHub token, and that reach is outside the VM
  // boundary, so it is never the default.
  const pr = await deps.prompt.confirm("let this box open a pull request? (grants a GitHub token)");
  return render(
    await createBox(
      {
        agent,
        path: repoRoot,
        postureKitDir: pr ? deps.context.postureKits.connected : deps.context.postureKits.guarded,
        dryRun: deps.context.dryRun,
        attach: !deps.context.noAttach,
      },
      deps.box,
    ),
  );
}

export async function interactive(deps: InteractiveDeps): Promise<BoxCliResult> {
  const installed = await Promise.all(HARNESSES.map((harness) => deps.which(harness.command)));
  const labels = HARNESSES.map(
    (harness, index) => `${harness.label}${installed[index] === true ? "" : " (not installed)"}`,
  );

  const chosen = await deps.prompt.select("harness", labels);
  if (chosen === undefined) return CANCELLED;
  const harness = HARNESSES[chosen];
  if (harness === undefined) return CANCELLED;

  const whereLabels = [
    "this machine (host: the harness's own sandbox + jig's guard)",
    harness.boxAgent === undefined
      ? "a box (microVM) — no built-in sbx agent for this harness yet"
      : "a box (microVM: a clone of this repo, no credentials, work leaves by fetch)",
  ];
  const where = await deps.prompt.select("where", whereLabels);
  if (where === undefined) return CANCELLED;

  return where === 1 ? await runInBox(harness, deps) : await runOnHost(harness, deps);
}
