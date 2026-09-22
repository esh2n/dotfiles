/**
 * Projects the canonical guard policy (`guard-rules.json`, parsed by
 * `./parse.ts`'s `parsePolicy`) onto the subset Claude Code's native
 * `permissions.deny`/`allow` arrays can express — `Bash(<prefix> *)` prefix
 * matches and `Write(<glob>)`/`Edit(<glob>)` path globs.
 *
 * This is a lossy, best-effort projection, not a reimplementation of the
 * guard: only the shapes explicitly recognized below convert; everything
 * else (an `ask` effect, a raw `match` string, `net.fetch`/`mcp.call`, or a
 * regex with any metacharacter this module doesn't recognize) is reported
 * as `hookOnly` instead of guessed at. The jig hook stays the real
 * enforcement point for every `hookOnly` rule — this only tells a caller
 * which rules a native `settings.json` could additionally cover.
 *
 * Pure: no I/O, no ports. `toClaudePermissions` is a plain function over an
 * already-parsed `Policy`.
 */

import type { Action, Effect, FloorRule, Policy, Rule, SubjectPattern } from "./types";

export interface HookOnlyRule {
  readonly id: string;
  /** One-line, human-readable reason this rule could not be expressed natively. */
  readonly reason: string;
}

export interface ClaudePermissions {
  /** `Bash(...)`/`Write(...)`/`Edit(...)` deny entries. Deduplicated, stable-sorted. */
  readonly deny: readonly string[];
  /** Same shapes, for `effect: "permit"` rules. Deduplicated, stable-sorted. */
  readonly allow: readonly string[];
  /** Every rule (floor or not) that has no safe native form, with why. Stable-sorted by id. */
  readonly hookOnly: readonly HookOnlyRule[];
}

type Classification =
  | { readonly kind: "deny" | "allow"; readonly values: readonly string[] }
  | { readonly kind: "hookOnly"; readonly reason: string };

/**
 * `parseSubject` (./parse.ts) always compiles `subject.program` as
 * `^(?:<raw>)$`. Reversing that wrapping recovers the author's original
 * alternation text so it can be judged for "simple literal names only".
 */
function unwrapProgramSource(source: string): string | undefined {
  const prefix = "^(?:";
  const suffix = ")$";
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return undefined;
  return source.slice(prefix.length, source.length - suffix.length);
}

const LITERAL_PROGRAM = /^[A-Za-z0-9_.-]+$/;

/** `undefined` unless every `|`-separated alternative is a bare literal program name. */
function literalProgramNames(source: string): readonly string[] | undefined {
  const raw = unwrapProgramSource(source);
  if (raw === undefined || raw === "") return undefined;
  const names = raw.split("|");
  return names.every((name) => LITERAL_PROGRAM.test(name)) ? names : undefined;
}

/**
 * Recognizes only a literal word (or `\s+`-joined literal words) anchored at
 * the start, optionally closed with `\b` or `$` — e.g. `^publish\b` ->
 * `["publish"]`. Anything else (a group, an alternation, a lookahead, `.`,
 * `*`, ...) returns `undefined`: those stay hook-only rather than being
 * guessed at.
 */
function literalArgvPrefix(source: string): readonly string[] | undefined {
  if (!source.startsWith("^")) return undefined;
  let body = source.slice(1);
  if (body.endsWith("\\b")) {
    body = body.slice(0, -2);
  } else if (body.endsWith("$")) {
    body = body.slice(0, -1);
  }
  if (body === "") return undefined;
  const words = body.split("\\s+");
  return words.every((word) => /^[A-Za-z0-9_-]+$/.test(word)) ? words : undefined;
}

/** Turns `\.env` into `.env`; rejects any other backslash escape and any bare regex metacharacter. */
function unescapeLiteralPath(text: string): string | undefined {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next !== ".") return undefined;
      out += ".";
      i++;
      continue;
    }
    if (!/[A-Za-z0-9_\-/]/.test(ch ?? "")) return undefined;
    out += ch;
  }
  return out === "" ? undefined : out;
}

/** `(?:^|/)<literal>$` or `(^|/)<literal>$` -> `**\/<literal>` (a file, anywhere under any directory). */
function anchoredDirLiteralGlob(source: string): string | undefined {
  const m = /^\((?:\?:)?\^\|\/\)(.+)\$$/.exec(source);
  if (!m) return undefined;
  const literal = unescapeLiteralPath(m[1] ?? "");
  return literal === undefined ? undefined : `**/${literal}`;
}

/** `^~\/<literal>$` -> `~/<literal>` (a specific home-anchored file, no globbing needed). */
function homeAnchoredLiteral(source: string): string | undefined {
  const m = /^\^~\/(.+)\$$/.exec(source);
  if (!m) return undefined;
  const literal = unescapeLiteralPath(m[1] ?? "");
  return literal === undefined ? undefined : `~/${literal}`;
}

/** `^<literal>$` -> `<literal>` (an exact, repo-relative-style path). Tried last: `~` isn't in the literal char set, so the home-anchored case never falls through to here. */
function anchoredExactLiteral(source: string): string | undefined {
  const m = /^\^(.+)\$$/.exec(source);
  if (!m) return undefined;
  return unescapeLiteralPath(m[1] ?? "");
}

/**
 * `RegExp.prototype.source` escapes every literal `/` as `\/` so the
 * pattern can be safely re-embedded in a `/.../ ` literal — semantically
 * still a plain slash, not a regex escape, so it is undone before any of
 * the literal-shape matchers below see the string.
 */
function unescapeSourceSlashes(source: string): string {
  return source.replace(/\\\//g, "/");
}

function convertPathToGlob(rawSource: string): string | undefined {
  const source = unescapeSourceSlashes(rawSource);
  return (
    anchoredDirLiteralGlob(source) ?? homeAnchoredLiteral(source) ?? anchoredExactLiteral(source)
  );
}

function denyOrAllow(effect: Effect, values: readonly string[]): Classification {
  return { kind: effect === "permit" ? "allow" : "deny", values };
}

function classifyShell(effect: Effect, subject: SubjectPattern): Classification {
  if (subject.program === undefined) {
    return {
      kind: "hookOnly",
      reason: "shell.exec rule has no subject.program to anchor a Bash prefix",
    };
  }
  const programs = literalProgramNames(subject.program.source);
  if (programs === undefined) {
    return {
      kind: "hookOnly",
      reason: "subject.program is not a simple alternation of literal program names",
    };
  }

  let suffixWords: readonly string[] = [];
  if (subject.argv !== undefined) {
    const words = literalArgvPrefix(subject.argv.source);
    if (words === undefined) {
      return {
        kind: "hookOnly",
        reason:
          "subject.argv regex is too complex for a literal Bash prefix (only a `^`-anchored literal word sequence converts)",
      };
    }
    suffixWords = words;
  }

  const values = programs.map((program) => `Bash(${[program, ...suffixWords].join(" ")} *)`);
  return denyOrAllow(effect, values);
}

function classifyFs(
  effect: Effect,
  action: "fs.write" | "fs.edit",
  subject: SubjectPattern,
): Classification {
  if (subject.path === undefined) {
    return { kind: "hookOnly", reason: `${action} rule has no subject.path to convert to a glob` };
  }
  const glob = convertPathToGlob(subject.path.source);
  if (glob === undefined) {
    return {
      kind: "hookOnly",
      reason:
        "subject.path regex is not a recognized literal/glob shape (anchored literal or `(?:^|/)name$` only)",
    };
  }
  const tool = action === "fs.write" ? "Write" : "Edit";
  return denyOrAllow(effect, [`${tool}(${glob})`]);
}

function classifyRule(
  effect: Effect,
  action: Action,
  subject: SubjectPattern | undefined,
  match: RegExp | undefined,
): Classification {
  if (effect === "ask") {
    return {
      kind: "hookOnly",
      reason: 'effect "ask" has no native form — Claude Code has no ask list',
    };
  }
  if (match !== undefined) {
    return { kind: "hookOnly", reason: 'raw "match" (string) rule has no native prefix/glob form' };
  }
  if (subject === undefined) {
    return { kind: "hookOnly", reason: "rule has no subject to convert" };
  }
  if (action === "shell.exec") return classifyShell(effect, subject);
  if (action === "fs.write" || action === "fs.edit") return classifyFs(effect, action, subject);
  return {
    kind: "hookOnly",
    reason: `action "${action}" has no native form in scope (net.fetch/mcp.call stay hook-only)`,
  };
}

function convertOne(
  id: string,
  effect: Effect,
  action: Action,
  subject: SubjectPattern | undefined,
  match: RegExp | undefined,
  deny: Set<string>,
  allow: Set<string>,
  hookOnly: HookOnlyRule[],
): void {
  const result = classifyRule(effect, action, subject, match);
  if (result.kind === "hookOnly") {
    hookOnly.push({ id, reason: result.reason });
    return;
  }
  const target = result.kind === "allow" ? allow : deny;
  for (const value of result.values) target.add(value);
}

export function toClaudePermissions(policy: Policy): ClaudePermissions {
  const deny = new Set<string>();
  const allow = new Set<string>();
  const hookOnly: HookOnlyRule[] = [];

  for (const rule of policy.floor as readonly FloorRule[]) {
    convertOne(rule.id, "forbid", rule.action, rule.subject, rule.match, deny, allow, hookOnly);
  }
  for (const rule of policy.rules as readonly Rule[]) {
    convertOne(rule.id, rule.effect, rule.action, rule.subject, rule.match, deny, allow, hookOnly);
  }

  return {
    deny: [...deny].sort(),
    allow: [...allow].sort(),
    hookOnly: [...hookOnly].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
