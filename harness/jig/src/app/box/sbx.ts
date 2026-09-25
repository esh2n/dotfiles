/**
 * The exact `sbx` command lines jig emits, and the shape of what `sbx` says
 * back. Pure on purpose: what a box launch does is the argv, so the argv is
 * what the tests pin and what `--dry-run` prints. Every flag here appears in
 * `sbx create --help` / `sbx run --help` on v0.43.0.
 */

import { repoBasename } from "./name";

/** The git daemon sbx runs inside a clone-mode box. Published on a fresh host port every start. */
export const GIT_DAEMON_PORT = 9418;

export interface PublishedPort {
  readonly sandboxPort: number;
  readonly hostPort: number;
}

export interface Box {
  readonly name: string;
  readonly id: string;
  readonly agent: string;
  readonly status: string;
  readonly lastUsedAt: string;
  readonly workspaces: readonly string[];
  /** Present only while the box is running. */
  readonly ports: readonly PublishedPort[];
}

export interface CreateArgsInput {
  readonly name: string;
  /**
   * jig's fork kit. It takes the *agent's* place in the argv, not a `--kit`
   * slot: "Launch by passing the sandbox kit in place of a built-in agent
   * name" (docs.docker.com/ai/sandboxes/customize/kit-examples). `--kit`
   * only accepts mixins, so a fork passed there would be rejected.
   */
  readonly kitDir: string;
  /** Mixins stacked on top of the fork; today, exactly one posture. */
  readonly mixinDirs: readonly string[];
  readonly repoPath: string;
}

/**
 * `--clone` is the whole posture: the box works on a private in-container
 * clone and the host checkout is mounted read-only, so no agent writes
 * through virtiofs and no worktree is ever handed over. `--skills=off`
 * because sbx otherwise mounts a host skills store over ~/.claude/skills,
 * which both leaks the host's skill tree in and breaks anything that wants
 * to write there. No extra workspaces: layering sub-mounts over a clone
 * hangs create on v0.43.0.
 */
export function createArgs(input: CreateArgsInput): string[] {
  const mixins = input.mixinDirs.flatMap((dir) => ["--kit", dir]);
  return [
    "create",
    "--clone",
    "--skills=off",
    "--name",
    input.name,
    ...mixins,
    input.kitDir,
    input.repoPath,
  ];
}

export interface RunArgsInput {
  readonly name: string;
  /** Passed to the agent after `--`; empty means "just attach". */
  readonly agentArgs: readonly string[];
}

/** Re-attach by name. The agent is read from the box's own spec, so it is not repeated here. */
export function runArgs(input: RunArgsInput): string[] {
  const base = ["run", "--name", input.name];
  return input.agentArgs.length === 0 ? base : [...base, "--", ...input.agentArgs];
}

/** Wake a stopped box without attaching, so its ports get published again. */
export function wakeArgs(name: string): string[] {
  return ["exec", name, "--", "true"];
}

/** `--force` because jig is never the interactive confirmation prompt's audience. */
export function removeArgs(name: string): string[] {
  return ["rm", "--force", name];
}

export const LIST_ARGS: readonly string[] = ["ls", "--json"];

/**
 * The global daemon setting that decides whether the host's SSH agent is
 * forwarded into every sandbox. jig reads it and never writes it: it is
 * machine-wide, so flipping it would silently change every other sandbox on
 * the machine, and a tool that quietly widens or narrows a security setting
 * behind its user is the thing the decision record is against.
 */
export const SSH_FORWARDING_SETTING = "ssh.agentForwardingEnabled";

export const SSH_FORWARDING_ARGS: readonly string[] = ["settings", "get", SSH_FORWARDING_SETTING];

/** The command the human runs to turn it off. jig prints this rather than running it. */
export const SSH_FORWARDING_OFF_COMMAND = `sbx settings set ${SSH_FORWARDING_SETTING} false`;

/**
 * Whether forwarding is on. Anything other than a clear "false" reads as on:
 * an unreadable setting is not evidence that the agent is not being
 * forwarded, and this gate is the kind that fails closed.
 */
export function sshForwardingEnabled(result: {
  readonly code: number;
  readonly stdout: string;
}): boolean {
  return result.code !== 0 || result.stdout.trim().toLowerCase() !== "false";
}

/**
 * The command line as a human would have to type it. This is what `--dry-run`
 * prints, so it is quoted well enough to paste back into a shell rather than
 * merely joined.
 */
export function formatSbxCommand(args: readonly string[]): string {
  const rendered = args.map((arg) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`,
  );
  return `sbx ${rendered.join(" ")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parsePorts(value: unknown): PublishedPort[] {
  if (!Array.isArray(value)) return [];
  const ports: PublishedPort[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === undefined) continue;
    const sandboxPort = record.sandbox_port;
    const hostPort = record.host_port;
    if (typeof sandboxPort !== "number" || typeof hostPort !== "number") continue;
    ports.push({ sandboxPort, hostPort });
  }
  return ports;
}

/**
 * Tolerant by design: `sbx ls --json` omits `ports` for a stopped box and is
 * an experimental surface besides, so a missing or oddly-typed field drops
 * that box's detail rather than failing the whole listing.
 */
export function parseSandboxList(json: string): Box[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const root = asRecord(parsed);
  const sandboxes = root?.sandboxes;
  if (!Array.isArray(sandboxes)) return [];

  const boxes: Box[] = [];
  for (const entry of sandboxes) {
    const record = asRecord(entry);
    if (record === undefined) continue;
    const name = asString(record.name);
    if (name === "") continue;
    boxes.push({
      name,
      id: asString(record.id),
      agent: asString(record.agent),
      status: asString(record.status),
      lastUsedAt: asString(record.last_used_at),
      workspaces: Array.isArray(record.workspaces) ? record.workspaces.map(asString) : [],
      ports: parsePorts(record.ports),
    });
  }
  return boxes;
}

/**
 * Which repository a box actually came from. The *name* cannot answer this —
 * it carries only the repository's basename, so two checkouts both called
 * `app` on the same branch would collide, and `resume` would attach to the
 * wrong one. `sbx ls --json` reports the host paths the box was created
 * against, which is identity rather than a label. Read-only extra mounts
 * carry a `:ro` suffix, so compare on the path in front of it.
 */
export function belongsTo(box: Box, repoRoot: string): boolean {
  return box.workspaces.some((workspace) => workspace.split(":")[0] === repoRoot);
}

/** Newest first, which is the order a resume picker wants. */
export function byNewest(boxes: readonly Box[]): Box[] {
  return [...boxes].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

/**
 * The host port the box's git daemon is on right now. It changes on every
 * start, so it is read per fetch and never cached.
 */
export function gitDaemonPort(boxes: readonly Box[], name: string): number | undefined {
  const box = boxes.find((candidate) => candidate.name === name);
  return box?.ports.find((port) => port.sandboxPort === GIT_DAEMON_PORT)?.hostPort;
}

export interface FetchArgsInput {
  readonly repoRoot: string;
  readonly name: string;
  readonly port: number;
}

/**
 * How work leaves a box: a fetch, never a push. The refs land under
 * `refs/remotes/sandbox-<name>/`, so the host sees the box's branches
 * without the box being able to move anything on the host.
 */
export function fetchArgs(input: FetchArgsInput): string[] {
  return [
    "fetch",
    "--prune",
    `git://127.0.0.1:${input.port}/${repoBasename(input.repoRoot)}`,
    `+refs/heads/*:refs/remotes/sandbox-${input.name}/*`,
  ];
}
