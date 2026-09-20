/**
 * The wrapper table: programs that run another program.
 *
 * Two families, treated oppositely on purpose:
 *
 *  - Transparent wrappers (`timeout`, `nice`, `nohup`, `stdbuf`, `command`,
 *    `exec`, `env` with only NAME=VALUE) change how the inner program runs,
 *    not what it is. They are peeled, so `timeout 10 git push --force` is
 *    judged as `git push --force`. Every option each one accepts is listed
 *    with a pattern for its value; an option that is not listed, or a value
 *    that does not fit, refuses the peel. That refusal is the fix for the
 *    `timeout -k$(id) 10 ls` class of bypass Claude Code was reported for:
 *    an unlisted option can never smuggle a command into the "value" slot.
 *
 *  - Privilege wrappers (`sudo`, `doas`, `su`, `chroot`, `nsenter`,
 *    `unshare`) are not peeled. Changing who or where a program runs as is
 *    itself the thing to judge, so the rule sees `sudo` as the program. The
 *    inner command is still surfaced as a suspect, so a forbid on `rm -rf /`
 *    also catches `sudo rm -rf /`.
 */

import type { ShellCommand } from "./types";

export type Peel =
  /** `cmd` is a transparent wrapper around `inner`. */
  | { readonly kind: "peeled"; readonly inner: ShellCommand }
  /** Not a wrapper, or a wrapper invoked without a command (`nohup` alone). */
  | { readonly kind: "self" }
  /** A wrapper whose options could not be read safely. */
  | { readonly kind: "reject"; readonly detail: string }
  /** `env -S`: the wrapper re-splits a string into a command. */
  | { readonly kind: "carrier"; readonly carrier: string; readonly detail: string };

/** `/usr/bin/git` and `git` are the same program to the table. */
export function basename(program: string): string {
  const slash = program.lastIndexOf("/");
  return slash === -1 ? program : program.slice(slash + 1);
}

interface OptionSpec {
  /** Short flags (single letter) that take no value. */
  readonly bare: readonly string[];
  /** Long flags that take no value. */
  readonly bareLong: readonly string[];
  /** Short flags that take a value (`-k 5`, `-k5`), with the value's allowed shape. */
  readonly valued: Readonly<Record<string, RegExp>>;
  /** Long flags that take a value (`--kill-after 5`, `--kill-after=5`). */
  readonly valuedLong: Readonly<Record<string, RegExp>>;
  /** Required positional operands before the command (timeout's DURATION). */
  readonly positionals: readonly RegExp[];
}

type Consumed = { readonly rest: readonly string[] } | { readonly reject: string };

/**
 * Consume a wrapper's own options and operands from argv, returning what is
 * left: the inner command. Every token before the command must be accounted
 * for by the spec; anything else is a rejection, never a guess.
 */
function consume(name: string, argv: readonly string[], spec: OptionSpec): Consumed {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const flag = eq === -1 ? token : token.slice(0, eq);
      if (spec.bareLong.includes(flag)) {
        if (eq !== -1) return { reject: `${name}: ${flag} takes no value` };
        i += 1;
        continue;
      }
      const pattern = spec.valuedLong[flag];
      if (pattern === undefined) return { reject: `${name}: unknown option ${flag}` };
      const value = eq === -1 ? argv[i + 1] : token.slice(eq + 1);
      if (value === undefined || !pattern.test(value)) {
        return { reject: `${name}: bad value for ${flag}` };
      }
      i += eq === -1 ? 2 : 1;
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      // A cluster of short flags: `-vk5` is -v then -k with value "5".
      let j = 1;
      while (j < token.length) {
        const flag = `-${token[j]}`;
        if (spec.bare.includes(flag)) {
          j += 1;
          continue;
        }
        const pattern = spec.valued[flag];
        if (pattern === undefined) return { reject: `${name}: unknown option ${flag}` };
        const attached = token.slice(j + 1);
        const value = attached === "" ? argv[i + 1] : attached;
        if (value === undefined || !pattern.test(value)) {
          return { reject: `${name}: bad value for ${flag}` };
        }
        if (attached === "") i += 1;
        break;
      }
      i += 1;
      continue;
    }
    break;
  }
  for (const pattern of spec.positionals) {
    const operand = argv[i];
    if (operand === undefined || !pattern.test(operand)) {
      return { reject: `${name}: missing or malformed operand` };
    }
    i += 1;
  }
  return { rest: argv.slice(i) };
}

const NONE: OptionSpec = { bare: [], bareLong: [], valued: {}, valuedLong: {}, positionals: [] };
const DURATION = /^\d+(\.\d+)?[smhd]?$/;
const SIGNAL = /^[A-Za-z0-9]+$/;
const NICENESS = /^-?\d{1,3}$/;
const BUFFER = /^(L|0|\d+[KMGkmg]?B?)$/;

const TRANSPARENT: Readonly<Record<string, OptionSpec>> = {
  timeout: {
    bare: ["-v"],
    bareLong: ["--foreground", "--preserve-status", "--verbose"],
    valued: { "-k": DURATION, "-s": SIGNAL },
    valuedLong: { "--kill-after": DURATION, "--signal": SIGNAL },
    positionals: [DURATION],
  },
  nice: {
    bare: [],
    bareLong: [],
    valued: { "-n": NICENESS },
    valuedLong: { "--adjustment": NICENESS },
    positionals: [],
  },
  nohup: NONE,
  stdbuf: {
    bare: [],
    bareLong: [],
    valued: { "-i": BUFFER, "-o": BUFFER, "-e": BUFFER },
    valuedLong: { "--input": BUFFER, "--output": BUFFER, "--error": BUFFER },
    positionals: [],
  },
  // `time` as a program (/usr/bin/time); the reserved word is handled by the walker.
  time: {
    bare: ["-p", "-v", "-q", "-a"],
    bareLong: ["--portability", "--verbose", "--quiet", "--append"],
    valued: { "-f": /^[^\n]*$/ },
    valuedLong: { "--format": /^[^\n]*$/ },
    positionals: [],
  },
  command: { ...NONE, bare: ["-p"] },
  exec: { ...NONE, bare: ["-c", "-l"], valued: { "-a": /^[^-].*$/ } },
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** `nice -10 cmd`: the legacy form is a niceness, not a flag cluster. */
function normalizeNiceLegacy(argv: readonly string[]): readonly string[] {
  const first = argv[0];
  if (first !== undefined && /^-\d{1,3}$/.test(first))
    return ["-n", first.slice(1), ...argv.slice(1)];
  return argv;
}

function peelEnv(cmd: ShellCommand): Peel {
  let i = 0;
  for (; i < cmd.argv.length; i += 1) {
    const token = cmd.argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (ASSIGNMENT.test(token)) continue;
    if (
      token === "-S" ||
      token === "--split-string" ||
      /^-S./.test(token) ||
      token.startsWith("--split-string=")
    ) {
      return {
        kind: "carrier",
        carrier: "env -S",
        detail: "env -S re-splits a string into a command",
      };
    }
    if (token.startsWith("-"))
      return { kind: "reject", detail: `env: option ${token} is not transparent` };
    break;
  }
  const rest = cmd.argv.slice(i);
  const program = rest[0];
  if (program === undefined) return { kind: "self" };
  return {
    kind: "peeled",
    inner: {
      program,
      argv: rest.slice(1),
      wrappers: [...cmd.wrappers, "env"],
      writes: cmd.writes,
    },
  };
}

/**
 * Peel one layer of transparent wrapper. The caller loops (with a depth cap)
 * because wrappers nest: `nohup nice -n 5 timeout 60 make`.
 */
export function peelTransparent(cmd: ShellCommand): Peel {
  const name = basename(cmd.program);
  if (name === "env") return peelEnv(cmd);
  const spec = TRANSPARENT[name];
  if (spec === undefined) return { kind: "self" };

  // `command -v git` looks a program up and prints; it does not run it.
  if (name === "command" && cmd.argv.some((a) => a === "-v" || a === "-V")) return { kind: "self" };

  const argv = name === "nice" ? normalizeNiceLegacy(cmd.argv) : cmd.argv;
  const consumed = consume(name, argv, spec);
  if ("reject" in consumed) return { kind: "reject", detail: consumed.reject };

  const program = consumed.rest[0];
  if (program === undefined) return { kind: "self" };
  return {
    kind: "peeled",
    inner: {
      program,
      argv: consumed.rest.slice(1),
      wrappers: [...cmd.wrappers, name],
      writes: cmd.writes,
    },
  };
}

export function isTransparentWrapper(program: string): boolean {
  const name = basename(program);
  return name === "env" || name in TRANSPARENT;
}

/** Short options of each privilege wrapper that take a value, so the lenient reader can skip them. */
const PRIVILEGE_VALUED: Readonly<Record<string, readonly string[]>> = {
  sudo: ["u", "g", "p", "C", "D", "h", "r", "t", "T", "U", "R"],
  doas: ["u", "C"],
  su: ["c", "s", "g", "G"],
  chroot: [],
  nsenter: ["t", "S", "G", "r", "w", "a", "T"],
  unshare: ["R", "w", "S", "G"],
};

export function isPrivilegeWrapper(program: string): boolean {
  return basename(program) in PRIVILEGE_VALUED;
}

/**
 * The command a privilege wrapper would run, read leniently (options skipped
 * on a best-effort basis). Used only to add suspects; a wrong guess here can
 * only fail to add one, never prove anything.
 */
export function privilegeInner(cmd: ShellCommand): ShellCommand | undefined {
  const name = basename(cmd.program);
  const valued = PRIVILEGE_VALUED[name];
  if (valued === undefined) return undefined;
  const argv = cmd.argv;
  let i = 0;
  // chroot's first operand is the new root, not the command.
  let positionalsToSkip = name === "chroot" ? 1 : 0;
  while (i < argv.length) {
    const token = argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (token.startsWith("--")) {
      i +=
        token.includes("=") ||
        !["--user", "--group", "--userspec", "--groups", "--root", "--wd"].includes(token)
          ? 1
          : 2;
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const last = token[token.length - 1] as string;
      if (name === "su" && last === "c") return undefined; // `su -c 'string'` is a carrier; the walker handles it.
      i += valued.includes(last) && token.length === 2 ? 2 : 1;
      continue;
    }
    if (ASSIGNMENT.test(token) && name === "sudo") {
      i += 1;
      continue;
    }
    if (positionalsToSkip > 0) {
      positionalsToSkip -= 1;
      i += 1;
      continue;
    }
    break;
  }
  const program = argv[i];
  if (program === undefined) return undefined;
  return {
    program,
    argv: argv.slice(i + 1),
    wrappers: [...cmd.wrappers, name],
    writes: cmd.writes,
  };
}
