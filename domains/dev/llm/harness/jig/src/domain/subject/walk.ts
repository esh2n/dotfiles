/**
 * The two readers over unbash's AST.
 *
 * `readStrict` walks an allowlist of syntax and refuses everything else: it
 * either proves the list of programs that run, or says why it cannot. It
 * never falls back to guessing from the raw string — that fallback is how
 * Claude Code once let `trap`- and `enable`-based bypasses through.
 *
 * `harvest` walks everything the parser produced, including the scripts
 * nested inside `$()`, backticks, process substitutions, heredoc bodies and
 * control structures, and re-reads the string payloads of `sh -c`, `eval`
 * and `env -S`. It collects candidates, not proof: a candidate only ever
 * adds a suspect for a forbid rule to match.
 *
 * This is the one place in `domain/` that imports a package. unbash is pure
 * TypeScript with no dependencies and no IO, pinned to an exact version, so
 * it keeps the layer's discipline (deterministic, testable with plain
 * values) even though it is not hand-written here.
 */

import { parse } from "unbash";
import type { Command, Node, Redirect, Script, Statement, Word, WordPart } from "unbash";
import { type CarrierCheck, classifyCarrier } from "./carriers";
import type { ExtractionLimits, ShellCommand, UnresolvedReason } from "./types";
import { basename, isPrivilegeWrapper, peelTransparent, privilegeInner } from "./wrappers";

export type StrictResult =
  | { readonly kind: "ok"; readonly commands: readonly ShellCommand[] }
  | { readonly kind: "unresolved"; readonly reason: UnresolvedReason }
  | { readonly kind: "carrier"; readonly carrier: string; readonly detail: string };

/** Thrown from inside a walk when the node budget is spent; caught at the entry point. */
export class NodeBudgetExceeded extends Error {
  constructor(readonly limit: number) {
    super(`more than ${limit} nodes`);
  }
}

export interface WalkContext {
  readonly limits: ExtractionLimits;
  /** Mutable on purpose: one budget shared by both readers of one string. */
  nodes: number;
}

export function newContext(limits: ExtractionLimits): WalkContext {
  return { limits, nodes: 0 };
}

function spend(ctx: WalkContext, n = 1): void {
  ctx.nodes += n;
  if (ctx.nodes > ctx.limits.maxNodes) throw new NodeBudgetExceeded(ctx.limits.maxNodes);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * A word whose value is fixed at parse time: bare text (escapes already
 * resolved by the parser), single quotes, or double quotes around plain
 * text. Anything that the shell would expand — including `$'…'`, whose
 * escapes can spell a different program than the text shows — is not.
 */
function nonLiteralPart(parts: readonly WordPart[] | undefined): string | undefined {
  if (parts === undefined) return undefined;
  for (const part of parts) {
    switch (part.type) {
      case "Literal":
      case "SingleQuoted":
        break;
      case "DoubleQuoted": {
        const inner = part.parts.find((p) => p.type !== "Literal");
        if (inner !== undefined) return inner.type;
        break;
      }
      default:
        return part.type;
    }
  }
  return undefined;
}

function nonLiteralIn(word: Word | undefined): string | undefined {
  return word === undefined ? undefined : nonLiteralPart(word.parts);
}

const OUTPUT_REDIRECTS = new Set<Redirect["operator"]>([">", ">>", ">|", "&>", "&>>", "<>"]);
const INPUT_REDIRECTS = new Set<Redirect["operator"]>(["<", "<<", "<<-", "<<<"]);
const FD_REDIRECTS = new Set<Redirect["operator"]>(["<&", ">&"]);

// ---------------------------------------------------------------------------
// Strict reader
// ---------------------------------------------------------------------------

function unsupported(detail: string): StrictResult {
  return { kind: "unresolved", reason: { kind: "unsupported-syntax", detail } };
}

interface RedirectReading {
  readonly writes: readonly string[];
  readonly stdinFed: boolean;
  readonly nonLiteral: string | undefined;
}

function readRedirects(redirects: readonly Redirect[]): RedirectReading {
  const writes: string[] = [];
  let stdinFed = false;
  let nonLiteral: string | undefined;
  for (const r of redirects) {
    if (r.operator === "<<" || r.operator === "<<-") {
      stdinFed = true;
      if (r.heredocQuoted !== true) {
        const inner = nonLiteralIn(r.body);
        if (inner !== undefined) nonLiteral ??= `heredoc ${inner}`;
      }
      continue;
    }
    const target = nonLiteralIn(r.target);
    if (target !== undefined) nonLiteral ??= `redirect ${target}`;
    if (INPUT_REDIRECTS.has(r.operator)) stdinFed = true;
    if (OUTPUT_REDIRECTS.has(r.operator) && r.target !== undefined && target === undefined) {
      writes.push(r.target.value);
    }
    if (
      FD_REDIRECTS.has(r.operator) &&
      r.target !== undefined &&
      !/^(\d+|-)$/.test(r.target.value)
    ) {
      // `>&file` is `&>file` in disguise; `>&-` closes.
      writes.push(r.target.value);
    }
  }
  return { writes, stdinFed, nonLiteral };
}

/**
 * Follow wrappers and carriers from one literal command to the programs
 * that finally run. `wrapperDepth` counts peeled transparent wrappers;
 * `shellDepth` counts `sh -c` payloads re-read.
 */
export function resolveCommand(
  cmd: ShellCommand,
  stdinFed: boolean,
  ctx: WalkContext,
  wrapperDepth = 0,
  shellDepth = 0,
): StrictResult {
  spend(ctx);
  const carrier = classifyCarrier(cmd, { stdinFed });
  if (carrier.kind === "carrier") return carrier;
  if (carrier.kind === "shell-payload") {
    if (shellDepth >= ctx.limits.maxShellDepth) {
      return {
        kind: "carrier",
        carrier: `${carrier.shell} -c`,
        detail: "nested shells too deep to read",
      };
    }
    const script = parse(carrier.payload);
    if (script.errors !== undefined && script.errors.length > 0) {
      return {
        kind: "unresolved",
        reason: {
          kind: "parse-error",
          detail: `in ${carrier.shell} -c: ${script.errors[0]?.message ?? "unknown"}`,
        },
      };
    }
    return readStrict(script, ctx, shellDepth + 1);
  }

  const peel = peelTransparent(cmd);
  switch (peel.kind) {
    case "self":
      return { kind: "ok", commands: [cmd] };
    case "reject":
      return { kind: "unresolved", reason: { kind: "wrapper-option", detail: peel.detail } };
    case "carrier":
      return peel;
    case "peeled": {
      if (wrapperDepth + 1 > ctx.limits.maxWrapperDepth) {
        return {
          kind: "unresolved",
          reason: {
            kind: "wrapper-depth",
            detail: `more than ${ctx.limits.maxWrapperDepth} wrappers`,
          },
        };
      }
      return resolveCommand(peel.inner, stdinFed, ctx, wrapperDepth + 1, shellDepth);
    }
  }
}

function readCommand(
  node: Command,
  stdinFed: boolean,
  ctx: WalkContext,
  shellDepth: number,
): StrictResult {
  spend(ctx, 1 + node.suffix.length + node.prefix.length + node.redirects.length);

  for (const assignment of node.prefix) {
    const inner = nonLiteralIn(assignment.value);
    if (inner !== undefined) return unsupported(`assignment ${inner}`);
    if (assignment.array !== undefined) return unsupported("array assignment");
  }

  const redirects = readRedirects(node.redirects);

  if (node.name === undefined) {
    // `x=1` runs nothing; `> file` alone truncates a file with no program to name.
    if (node.redirects.length > 0) return unsupported("redirect without a command");
    return { kind: "ok", commands: [] };
  }

  const dynamicName = nonLiteralIn(node.name);
  if (dynamicName !== undefined) {
    return {
      kind: "carrier",
      carrier: "dynamic program",
      detail: `program name is a ${dynamicName}`,
    };
  }

  const argv: string[] = [];
  let nonLiteral = redirects.nonLiteral;
  for (const word of node.suffix) {
    const inner = nonLiteralPart(word.parts);
    if (inner !== undefined) nonLiteral ??= `argument ${inner}`;
    argv.push(word.value);
  }

  const cmd: ShellCommand = {
    program: node.name.value,
    argv,
    wrappers: [],
    writes: redirects.writes,
  };
  const fed = stdinFed || redirects.stdinFed;

  if (nonLiteral !== undefined) {
    // A carrier is a carrier even when its arguments cannot be read: `eval
    // "$x"` and `bash -c "$x"` are questions, not merely unreadable.
    const carrier: CarrierCheck = classifyCarrier(cmd, { stdinFed: fed });
    if (carrier.kind === "carrier") return carrier;
    if (carrier.kind === "shell-payload") {
      return {
        kind: "carrier",
        carrier: `${carrier.shell} -c`,
        detail: "payload is not a literal string",
      };
    }
    return unsupported(nonLiteral);
  }

  return resolveCommand(cmd, fed, ctx, 0, shellDepth);
}

function readNode(
  node: Node,
  stdinFed: boolean,
  ctx: WalkContext,
  shellDepth: number,
): StrictResult {
  spend(ctx);
  switch (node.type) {
    case "Command":
      return readCommand(node, stdinFed, ctx, shellDepth);
    case "Pipeline": {
      const commands: ShellCommand[] = [];
      for (const [i, part] of node.commands.entries()) {
        const result = readNode(part, stdinFed || i > 0, ctx, shellDepth);
        if (result.kind !== "ok") return result;
        commands.push(...result.commands);
      }
      return { kind: "ok", commands };
    }
    case "AndOr": {
      const commands: ShellCommand[] = [];
      for (const part of node.commands) {
        const result = readNode(part, false, ctx, shellDepth);
        if (result.kind !== "ok") return result;
        commands.push(...result.commands);
      }
      return { kind: "ok", commands };
    }
    case "Statement":
      return readStatement(node, ctx, shellDepth);
    default:
      return unsupported(node.type);
  }
}

function readStatement(statement: Statement, ctx: WalkContext, shellDepth: number): StrictResult {
  if (statement.redirects.length > 0) return unsupported("redirect on a compound command");
  return readNode(statement.command, false, ctx, shellDepth);
}

/** Prove the programs a script runs, or say why that is not possible. */
export function readStrict(script: Script, ctx: WalkContext, shellDepth = 0): StrictResult {
  const commands: ShellCommand[] = [];
  for (const statement of script.commands) {
    const result = readStatement(statement, ctx, shellDepth);
    if (result.kind !== "ok") return result;
    commands.push(...result.commands);
  }
  return { kind: "ok", commands };
}

// ---------------------------------------------------------------------------
// Lenient harvester
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function commandOf(node: Command): ShellCommand | undefined {
  if (node.name === undefined) return undefined;
  const writes: string[] = [];
  for (const r of node.redirects) {
    if (OUTPUT_REDIRECTS.has(r.operator) && r.target !== undefined) writes.push(r.target.value);
  }
  return {
    program: node.name.value,
    argv: node.suffix.map((w) => w.value),
    wrappers: [],
    writes,
  };
}

/**
 * Every `Command` node anywhere in the tree, including inside nested scripts
 * (`$()`, `<()`, heredoc bodies, arithmetic). Walks the object graph
 * generically so a node type this file does not name is still searched.
 */
function collectCommands(value: unknown, ctx: WalkContext, out: ShellCommand[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, ctx, out);
    return;
  }
  if (!isObject(value)) return;
  spend(ctx);
  if (value.type === "Command") {
    const cmd = commandOf(value as unknown as Command);
    if (cmd !== undefined) out.push(cmd);
  }
  for (const child of Object.values(value)) collectCommands(child, ctx, out);
  // unbash resolves a word's `parts` lazily through a prototype getter, so
  // they are not among the own values above.
  if ("parts" in value && !Object.hasOwn(value, "parts")) collectCommands(value.parts, ctx, out);
}

const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a", "-i", "-l"]);

/** The command `xargs` would build, options skipped loosely. */
function xargsInner(cmd: ShellCommand): ShellCommand | undefined {
  let i = 0;
  while (i < cmd.argv.length) {
    const token = cmd.argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (!token.startsWith("-")) break;
    i += XARGS_VALUED.has(token) ? 2 : 1;
  }
  const program = cmd.argv[i];
  return program === undefined
    ? undefined
    : {
        program,
        argv: cmd.argv.slice(i + 1),
        wrappers: [...cmd.wrappers, "xargs"],
        writes: cmd.writes,
      };
}

/** The command after `find … -exec`, up to its `;` or `+` terminator. */
function findExecInner(cmd: ShellCommand): ShellCommand | undefined {
  const at = cmd.argv.findIndex(
    (a) => a === "-exec" || a === "-execdir" || a === "-ok" || a === "-okdir",
  );
  if (at === -1) return undefined;
  const tail = cmd.argv.slice(at + 1);
  const end = tail.findIndex((a) => a === ";" || a === "+");
  const words = end === -1 ? tail : tail.slice(0, end);
  const program = words[0];
  return program === undefined
    ? undefined
    : { program, argv: words.slice(1), wrappers: [...cmd.wrappers, "find"], writes: cmd.writes };
}

/** A string argument this command would run as shell code, if any. */
function shellPayloadOf(cmd: ShellCommand): string | undefined {
  const carrier = classifyCarrier(cmd, { stdinFed: false });
  if (carrier.kind === "shell-payload") return carrier.payload;
  const name = basename(cmd.program);
  if (name === "eval") return cmd.argv.join(" ");
  if (name === "env") {
    const at = cmd.argv.findIndex((a) => a === "-S" || a === "--split-string");
    if (at !== -1) return cmd.argv.slice(at + 1).join(" ");
    const attached = cmd.argv.find((a) => /^-S./.test(a) || a.startsWith("--split-string="));
    if (attached !== undefined) return attached.replace(/^(-S|--split-string=)/, "");
  }
  if (name === "su") {
    const at = cmd.argv.findIndex((a) => /^-[A-Za-z]*c$/.test(a) || a === "--command");
    const payload = at === -1 ? undefined : cmd.argv[at + 1];
    if (payload !== undefined) return payload;
  }
  return undefined;
}

/**
 * When the strict peel refused a wrapper's options, the inner command is
 * somewhere in its argv but nobody knows where. Every tail (up to a small
 * bound) becomes a candidate: over-suspicion is the lenient reader's job.
 */
function looseInners(cmd: ShellCommand): readonly ShellCommand[] {
  const name = basename(cmd.program);
  const out: ShellCommand[] = [];
  for (let i = 0; i < Math.min(cmd.argv.length, 8); i += 1) {
    const program = cmd.argv[i] as string;
    if (program.startsWith("-")) continue;
    out.push({
      program,
      argv: cmd.argv.slice(i + 1),
      wrappers: [...cmd.wrappers, name],
      writes: cmd.writes,
    });
  }
  return out;
}

/**
 * Expand one candidate into everything it might run: peeled wrappers, the
 * inner command of `sudo`/`xargs`/`find -exec`, and the commands inside any
 * shell-code payload. Bounded by the shared node budget and by shell depth.
 */
export function expandSuspect(
  cmd: ShellCommand,
  ctx: WalkContext,
  shellDepth: number,
  out: ShellCommand[],
): void {
  spend(ctx);
  out.push(cmd);

  const peel = peelTransparent(cmd);
  if (peel.kind === "peeled") {
    expandSuspect(peel.inner, ctx, shellDepth, out);
    return;
  }
  if (peel.kind === "reject") {
    for (const inner of looseInners(cmd)) expandSuspect(inner, ctx, shellDepth, out);
    return;
  }

  if (isPrivilegeWrapper(cmd.program)) {
    const inner = privilegeInner(cmd);
    if (inner !== undefined) expandSuspect(inner, ctx, shellDepth, out);
  }
  const name = basename(cmd.program);
  const viaXargs = name === "xargs" ? xargsInner(cmd) : undefined;
  if (viaXargs !== undefined) expandSuspect(viaXargs, ctx, shellDepth, out);
  const viaFind = name === "find" ? findExecInner(cmd) : undefined;
  if (viaFind !== undefined) expandSuspect(viaFind, ctx, shellDepth, out);

  const payload = shellPayloadOf(cmd);
  if (payload !== undefined && shellDepth < ctx.limits.maxShellDepth) {
    harvest(parse(payload), ctx, shellDepth + 1, out);
  }
}

/** Every command the parser can see, expanded into everything it might run. */
export function harvest(
  script: Script,
  ctx: WalkContext,
  shellDepth: number,
  out: ShellCommand[],
): void {
  const found: ShellCommand[] = [];
  collectCommands(script, ctx, found);
  for (const cmd of found) expandSuspect(cmd, ctx, shellDepth, out);
}

/** Drop exact duplicates, keeping first occurrence order. */
export function dedupe(commands: readonly ShellCommand[]): readonly ShellCommand[] {
  const seen = new Set<string>();
  const out: ShellCommand[] = [];
  for (const cmd of commands) {
    const key = JSON.stringify([cmd.program, cmd.argv, cmd.writes]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  return out;
}
