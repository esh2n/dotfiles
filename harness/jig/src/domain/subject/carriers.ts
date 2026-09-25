/**
 * The carrier table: programs that execute content the reader cannot see.
 *
 * `eval "$x"`, `xargs rm`, `curl … | sh`, `python -c "$code"`: the string
 * names a program, but what actually runs is decided by data — an argument
 * that is itself code, or whatever arrives on stdin. No amount of parsing
 * the outer string can prove what that is, so a carrier is always a
 * question for the human, in every policy mode.
 *
 * One carrier is re-read instead: a shell with a *literal* `-c` payload
 * (`bash -c 'git status'`). The payload is a bash string we can parse with
 * the same grammar, so the walker recurses into it, bounded by depth.
 */

import type { ShellCommand } from "./types";
import { basename } from "./wrappers";

export type CarrierCheck =
  | { readonly kind: "none" }
  | { readonly kind: "carrier"; readonly carrier: string; readonly detail: string }
  /** `sh -c '<payload>'`: read the payload as a script. */
  | { readonly kind: "shell-payload"; readonly shell: string; readonly payload: string };

/** Where the command's stdin comes from, as far as the walker can tell. */
export interface StdinContext {
  /** Not first in a pipeline, or has a `<`, `<<` or `<<<` redirect. */
  readonly stdinFed: boolean;
}

const ALWAYS: Readonly<Record<string, string>> = {
  eval: "eval runs its arguments as shell code",
  source: "source runs a file as shell code in this shell",
  ".": ". runs a file as shell code in this shell",
  xargs: "xargs builds a command from stdin",
  trap: "trap arms shell code to run later",
};

const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** Bourne-compatible shells whose `-c` payload the same grammar can read. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"]);
/** Shells with their own grammar: a `-c` payload is opaque to us. */
const FOREIGN_SHELLS = new Set(["fish", "nu", "pwsh", "powershell", "csh", "tcsh"]);

/** Shell options that take a value, so the token after them is not the payload. */
const SHELL_VALUED = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);

interface ShellInvocation {
  readonly payload: string | undefined;
  readonly hasScript: boolean;
  readonly wantsPayload: boolean;
}

function readShellArgv(argv: readonly string[]): ShellInvocation {
  let i = 0;
  let wantsPayload = false;
  while (i < argv.length) {
    const token = argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (SHELL_VALUED.has(token)) {
      i += 2;
      continue;
    }
    if ((token.startsWith("-") || token.startsWith("+")) && token.length > 1) {
      if (!token.startsWith("--") && token.includes("c")) wantsPayload = true;
      i += 1;
      continue;
    }
    break;
  }
  const first = argv[i];
  return {
    payload: wantsPayload ? first : undefined,
    hasScript: first !== undefined,
    wantsPayload,
  };
}

interface InterpreterSpec {
  /** Options whose argument is code. */
  readonly codeFlags: readonly string[];
  /** Options that take a value (so it is not a script operand). */
  readonly valued: readonly string[];
}

const INTERPRETERS: Readonly<Record<string, InterpreterSpec>> = {
  node: { codeFlags: ["-e", "--eval", "-p", "--print"], valued: ["-r", "--require", "--import"] },
  bun: { codeFlags: ["-e", "--eval", "-p", "--print"], valued: ["-r", "--preload"] },
  python: { codeFlags: ["-c"], valued: ["-m", "-W", "-X", "-Q"] },
  python2: { codeFlags: ["-c"], valued: ["-m", "-W", "-X", "-Q"] },
  python3: { codeFlags: ["-c"], valued: ["-m", "-W", "-X"] },
  perl: { codeFlags: ["-e", "-E"], valued: ["-I", "-M", "-m", "-C"] },
  ruby: { codeFlags: ["-e"], valued: ["-I", "-r", "-C", "-E", "-F"] },
  php: { codeFlags: ["-r", "-R"], valued: ["-d", "-c", "-f"] },
  osascript: { codeFlags: ["-e"], valued: ["-l", "-s"] },
  lua: { codeFlags: ["-e"], valued: ["-l"] },
};

interface InterpreterInvocation {
  readonly codeFlag: string | undefined;
  readonly readsStdinExplicitly: boolean;
  readonly hasOperand: boolean;
}

function readInterpreterArgv(
  argv: readonly string[],
  spec: InterpreterSpec,
): InterpreterInvocation {
  let i = 0;
  let codeFlag: string | undefined;
  while (i < argv.length) {
    const token = argv[i] as string;
    if (token === "--") {
      i += 1;
      break;
    }
    if (token === "-") return { codeFlag, readsStdinExplicitly: true, hasOperand: true };
    if (!token.startsWith("-")) break;
    const eq = token.indexOf("=");
    const flag = token.startsWith("--") && eq !== -1 ? token.slice(0, eq) : token;
    // `-e code`, `-e=code` (long form) and the attached `-ecode` all carry code.
    const code = spec.codeFlags.find((f) => flag === f || (f.length === 2 && token.startsWith(f)));
    if (code !== undefined) {
      codeFlag = code;
      break;
    }
    // `-m module`: the module is a program to run, i.e. an operand.
    if (flag === "-m") return { codeFlag, readsStdinExplicitly: false, hasOperand: true };
    if (spec.valued.includes(flag) && eq === -1) {
      i += 2;
      continue;
    }
    i += 1;
  }
  const operand = argv[i];
  return {
    codeFlag,
    readsStdinExplicitly: operand === "-",
    hasOperand: codeFlag !== undefined || operand !== undefined,
  };
}

/** Is this invocation a carrier, and if so which kind? */
export function classifyCarrier(cmd: ShellCommand, ctx: StdinContext): CarrierCheck {
  const name = basename(cmd.program);

  const always = ALWAYS[name];
  if (always !== undefined) return { kind: "carrier", carrier: name, detail: always };

  if (name === "find" && cmd.argv.some((a) => FIND_EXEC.has(a))) {
    return { kind: "carrier", carrier: "find -exec", detail: "find runs a command per match" };
  }

  if (name === "su" && cmd.argv.some((a) => /^-[A-Za-z]*c/.test(a) || a === "--command")) {
    return { kind: "carrier", carrier: "su -c", detail: "su -c runs a string as another user" };
  }

  if (FOREIGN_SHELLS.has(name)) {
    const inv = readShellArgv(cmd.argv);
    if (inv.wantsPayload || (!inv.hasScript && ctx.stdinFed)) {
      return {
        kind: "carrier",
        carrier: `${name} -c`,
        detail: `${name} runs code in its own grammar`,
      };
    }
    return { kind: "none" };
  }

  if (SHELLS.has(name)) {
    const inv = readShellArgv(cmd.argv);
    if (inv.wantsPayload) {
      if (inv.payload === undefined) {
        return { kind: "carrier", carrier: `${name} -c`, detail: `${name} -c without a payload` };
      }
      return { kind: "shell-payload", shell: name, payload: inv.payload };
    }
    if (!inv.hasScript && ctx.stdinFed) {
      return {
        kind: "carrier",
        carrier: `${name} <stdin`,
        detail: `${name} runs whatever arrives on stdin`,
      };
    }
    return { kind: "none" };
  }

  const spec = INTERPRETERS[name];
  if (spec !== undefined) {
    const inv = readInterpreterArgv(cmd.argv, spec);
    if (inv.codeFlag !== undefined) {
      return {
        kind: "carrier",
        carrier: `${name} ${inv.codeFlag}`,
        detail: `${name} runs code given as an argument`,
      };
    }
    if (inv.readsStdinExplicitly || (!inv.hasOperand && ctx.stdinFed)) {
      return {
        kind: "carrier",
        carrier: `${name} <stdin`,
        detail: `${name} runs whatever arrives on stdin`,
      };
    }
  }

  return { kind: "none" };
}
