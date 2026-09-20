/**
 * Entry points of subject extraction. `fromString` is what Claude Code, pi
 * and DSH hand over (the command as one string); `fromArgv` is what codex
 * hands over (`["bash", "-lc", "…"]`).
 *
 * Both apply the same caps — bytes, wall time, nodes — and both answer with
 * the same shape (see `./types`). Exceeding a cap is `unresolved`, never a
 * partial `resolved`: a command nobody could read in 50ms is a command
 * nobody has reviewed.
 */

import { parse } from "unbash";
import { DEFAULT_LIMITS, type Extraction, type ExtractionLimits, type ShellCommand } from "./types";
import {
  NodeBudgetExceeded,
  type StrictResult,
  dedupe,
  expandSuspect,
  harvest,
  newContext,
  readStrict,
  resolveCommand,
} from "./walk";

function finish(strict: StrictResult, suspects: readonly ShellCommand[]): Extraction {
  const unique = dedupe(suspects);
  switch (strict.kind) {
    case "ok":
      return { kind: "resolved", commands: strict.commands, suspects: unique };
    case "unresolved":
      return { kind: "unresolved", reason: strict.reason, suspects: unique };
    case "carrier":
      return { kind: "carrier", carrier: strict.carrier, detail: strict.detail, suspects: unique };
  }
}

function overBudget(
  kind: "too-many-nodes" | "too-slow",
  detail: string,
  suspects: readonly ShellCommand[],
): Extraction {
  return { kind: "unresolved", reason: { kind, detail }, suspects: dedupe(suspects) };
}

/** Read one shell command string. */
export function fromString(command: string, limits: ExtractionLimits = DEFAULT_LIMITS): Extraction {
  const bytes = Buffer.byteLength(command, "utf8");
  if (bytes > limits.maxBytes) {
    return {
      kind: "unresolved",
      reason: { kind: "too-large", detail: `${bytes} bytes > ${limits.maxBytes}` },
      suspects: [],
    };
  }

  const started = performance.now();
  const ctx = newContext(limits);
  const suspects: ShellCommand[] = [];
  try {
    const script = parse(command);
    harvest(script, ctx, 0, suspects);
    if (script.errors !== undefined && script.errors.length > 0) {
      const detail = script.errors.map((e) => e.message).join("; ");
      return {
        kind: "unresolved",
        reason: { kind: "parse-error", detail },
        suspects: dedupe(suspects),
      };
    }
    const strict = readStrict(script, ctx);
    const elapsed = performance.now() - started;
    if (elapsed > limits.maxMillis) {
      return overBudget("too-slow", `${elapsed.toFixed(1)}ms > ${limits.maxMillis}ms`, suspects);
    }
    return finish(strict, suspects);
  } catch (error) {
    if (error instanceof NodeBudgetExceeded)
      return overBudget("too-many-nodes", error.message, suspects);
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "unresolved",
      reason: { kind: "parse-error", detail },
      suspects: dedupe(suspects),
    };
  }
}

/**
 * Read an argv array. The first element is already the program, so no shell
 * grammar applies to the array itself; only a `sh -c` payload inside it is
 * re-read as a string.
 */
export function fromArgv(
  argv: readonly string[],
  limits: ExtractionLimits = DEFAULT_LIMITS,
): Extraction {
  const program = argv[0];
  if (program === undefined) {
    return {
      kind: "unresolved",
      reason: { kind: "parse-error", detail: "empty argv" },
      suspects: [],
    };
  }
  const bytes = argv.reduce((sum, a) => sum + Buffer.byteLength(a, "utf8") + 1, 0);
  if (bytes > limits.maxBytes) {
    return {
      kind: "unresolved",
      reason: { kind: "too-large", detail: `${bytes} bytes > ${limits.maxBytes}` },
      suspects: [],
    };
  }

  const started = performance.now();
  const ctx = newContext(limits);
  const base: ShellCommand = { program, argv: argv.slice(1), wrappers: [], writes: [] };
  const suspects: ShellCommand[] = [];
  try {
    expandSuspect(base, ctx, 0, suspects);
    const strict = resolveCommand(base, false, ctx);
    const elapsed = performance.now() - started;
    if (elapsed > limits.maxMillis) {
      return overBudget("too-slow", `${elapsed.toFixed(1)}ms > ${limits.maxMillis}ms`, suspects);
    }
    return finish(strict, suspects);
  } catch (error) {
    if (error instanceof NodeBudgetExceeded)
      return overBudget("too-many-nodes", error.message, suspects);
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "unresolved",
      reason: { kind: "parse-error", detail },
      suspects: dedupe(suspects),
    };
  }
}
