/**
 * `jig box new` — render the fork kit, create the box, attach.
 *
 * The box always works on a clone of the repository root, never on the
 * directory the caller happened to be in and never on a worktree: a worktree
 * handed to sbx cannot reach its `.git`, so nothing inside could commit.
 */

import { renderAgentKit } from "./kit";
import type { BoxAgent } from "./kit";
import { listBoxes } from "./list";
import { boxName } from "./name";
import type { BoxPorts, BoxResult, JigSource } from "./ports";
import {
  SSH_FORWARDING_ARGS,
  SSH_FORWARDING_OFF_COMMAND,
  SSH_FORWARDING_SETTING,
  belongsTo,
  createArgs,
  formatSbxCommand,
  runArgs,
  sshForwardingEnabled,
} from "./sbx";

/**
 * The decision record says the SSH agent is not forwarded into a box.
 * Measured on sbx v0.43.0 (2026-09-22): removing `SSH_AUTH_SOCK` from the
 * `sbx` process's own environment does NOT achieve that — `/run/ssh-agent.sock`
 * is present inside the box either way, and it connects, because what sbx
 * forwards is the *daemon's* agent, not the CLI's. The only control is the
 * global `ssh.agentForwardingEnabled` setting, which is machine-wide and
 * therefore not jig's to flip. So jig refuses instead, and prints the one
 * command that changes it — the human decides, and sees that they decided.
 */
const SSH_REFUSAL = [
  `jig box new: refusing — sbx would forward your SSH agent into the box (${SSH_FORWARDING_SETTING} is on).`,
  "A box holds no credentials by design; a forwarded agent is a credential.",
  "Turn it off for this machine, then run this again:",
  `  ${SSH_FORWARDING_OFF_COMMAND}`,
  "jig will not change that setting for you: it is global, and every other sandbox on",
  "this machine would change with it.",
];

export interface CreateBoxInput {
  readonly agent: BoxAgent;
  /** Any directory inside the repository the box should clone. */
  readonly path: string;
  /** The posture mixin: `guarded` (nothing granted) or `connected` (GitHub token via the proxy). */
  readonly postureKitDir: string;
  /**
   * Print the sbx command lines and change nothing. The sbx *setting* is
   * still read — it is read-only, and a dry run that hid the SSH refusal
   * would be showing a command that is going to be refused.
   */
  readonly dryRun: boolean;
  /** Hand the terminal to the agent once the box exists. Off for scripted checks. */
  readonly attach: boolean;
}

export async function createBox(input: CreateBoxInput, ports: BoxPorts): Promise<BoxResult> {
  const repoRoot = await ports.git.toplevel(input.path);
  if (repoRoot === undefined) {
    return { lines: [`jig box new: ${input.path} is not inside a git repository`], code: 2 };
  }

  const branch = await ports.git.branch(repoRoot);
  const name = boxName({ agent: input.agent, repoPath: repoRoot, branch });

  // A name carries only the repository's *basename*, so a different checkout
  // with the same basename on the same branch wants the same name. sbx would
  // refuse the create anyway, but with a message about names rather than
  // about the two repositories that collided.
  const existing = await listBoxes({}, ports);
  const taken = existing.boxes.find((box) => box.name === name);
  if (taken !== undefined && !belongsTo(taken, repoRoot)) {
    return {
      lines: [
        `jig box new: ${name} is already a box cloned from ${taken.workspaces[0] ?? "another path"}`,
        "names carry only a repository's basename, so two checkouts can want the same one.",
        `Free it with: jig box rm ${name}   (or rename this branch, which changes the name)`,
      ],
      code: 2,
    };
  }

  // Reading jig's own source can fail — no guard policy on this machine, a
  // half-installed checkout — and that is a message, not a stack trace out
  // of the entry point.
  let source: JigSource;
  try {
    source = await ports.source.read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { lines: [`jig box new: ${message}`], code: 2 };
  }

  const kitDir = await ports.kit.write(
    name,
    renderAgentKit({
      agent: input.agent,
      jigSource: source.files,
      guardRules: source.guardRules,
      instructions: source.instructions,
    }),
  );

  // The fork kit takes the agent's place in the argv; the posture is a mixin
  // stacked on top with --kit. The posture is the one that may grant a
  // credential, and reading it on the command line is how a review sees that.
  const create = createArgs({
    name,
    kitDir,
    mixinDirs: [input.postureKitDir],
    repoPath: repoRoot,
  });
  const attach = runArgs({ name, agentArgs: [] });

  const forwarding = sshForwardingEnabled(await ports.sbx.run(SSH_FORWARDING_ARGS));

  if (input.dryRun) {
    return {
      lines: [
        `box:    ${name}`,
        `repo:   ${repoRoot} (branch ${branch})`,
        `kit:    ${kitDir}`,
        "",
        formatSbxCommand(create),
        ...(input.attach ? [formatSbxCommand(attach)] : []),
        // A dry run shows what would happen, including the refusal.
        ...(forwarding ? ["", ...SSH_REFUSAL] : []),
      ],
      code: 0,
    };
  }
  if (forwarding) return { lines: SSH_REFUSAL, code: 2 };

  const created = await ports.sbx.run(create);
  if (created.code !== 0) {
    return {
      lines: [
        `jig box new: sbx create failed (exit ${created.code})`,
        created.stderr.trimEnd(),
        `command: ${formatSbxCommand(create)}`,
      ].filter((line) => line !== ""),
      code: created.code,
    };
  }

  if (!input.attach) {
    return {
      lines: [
        `box ${name} created from ${repoRoot} (branch ${branch})`,
        `attach with:  jig box resume ${name}`,
        `fetch with:   jig box fetch ${name}`,
      ],
      code: 0,
    };
  }

  // The lines are printed after the session ends, because attach owns the
  // terminal until then — so they say what is left behind, not what happened.
  const code = await ports.sbx.attach(attach);
  return {
    lines: [
      `box ${name} is still there — resume it, or fetch its work with: jig box fetch ${name}`,
    ],
    code,
  };
}
