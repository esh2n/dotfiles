/**
 * The policy evaluator. Pure: a policy, a request, a principal in; a judgment
 * out. Order of precedence, fixed:
 *
 *   1. floor      — forbid, ignoring profile, principal and mode
 *   2. forbid     — active rules; matched against suspicion (lenient reading)
 *   3. ask        — active rules; also against suspicion
 *   4. mode       — allowlist: allowed only when proven and covered by a
 *                   permit rule; denylist: allowed
 *
 * A command that hands code to another program (`python -c`, `xargs`,
 * `eval`, `curl | sh`) is not a class of its own here: like any command the
 * reader cannot prove, it is judged by what was seen (forbid and ask on
 * suspicion) and by the mode. Every harness surveyed — Claude Code, Codex,
 * Gemini CLI, OpenHands — does the same, and adds only narrow, named rules
 * on top (`find -exec`, `curl | sh`), which belong in the policy file, not
 * in code. The design's earlier "always ask" for these commands was
 * withdrawn on 2026-09-21 (D-18).
 *
 * "Active" means the rule lists the principal's profile and, when it names
 * principals, the principal's harness.
 *
 * The asymmetry from the design is enforced here, not in the rules: a
 * forbid or ask needs only a suspect to match (so `sudo rm -rf /` and
 * `echo $(rm -rf /)` are caught by a rule about `rm`), while a permit needs
 * the strict reading to have resolved every program (so nothing is waved
 * through on a guess). `match`, the raw-string regex, is tested against the
 * raw command; when a rule has both `subject` and `match`, both must hold.
 */

import type { Decision } from "../hooks/decision";
import type { ShellCommand } from "../subject";
import { basename } from "../subject";
import type { Judgment } from "./judgment";
import type { Principal, Request } from "./request";
import type { FloorRule, Policy, Rule, SubjectPattern } from "./types";

interface Target {
  readonly subject: SubjectPattern | undefined;
  readonly match: RegExp | undefined;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function subjectMatchesCommand(pattern: SubjectPattern, cmd: ShellCommand): boolean {
  if (pattern.host !== undefined) return false;
  if (pattern.program !== undefined && !pattern.program.test(basename(cmd.program))) return false;
  if (pattern.argv !== undefined && !pattern.argv.test(cmd.argv.join(" "))) return false;
  if (pattern.path !== undefined && !cmd.writes.some((w) => pattern.path?.test(w))) return false;
  return true;
}

/** Does the target hold for the request, given the commands to consider? */
function holds(target: Target, request: Request, commands: readonly ShellCommand[]): boolean {
  switch (request.action) {
    case "shell.exec": {
      if (target.match !== undefined && !target.match.test(request.raw)) return false;
      if (target.subject === undefined) return true;
      const subject = target.subject;
      return commands.some((cmd) => subjectMatchesCommand(subject, cmd));
    }
    case "fs.write":
    case "fs.edit": {
      if (target.match !== undefined && !target.match.test(request.path)) return false;
      if (target.subject === undefined) return true;
      const { path, program, argv, host } = target.subject;
      if (program !== undefined || argv !== undefined || host !== undefined) return false;
      return path === undefined || path.test(request.path);
    }
    case "net.fetch": {
      if (target.match !== undefined && !target.match.test(request.url)) return false;
      if (target.subject === undefined) return true;
      const { host, program, argv, path } = target.subject;
      if (program !== undefined || argv !== undefined || path !== undefined) return false;
      return host === undefined || host.test(request.host);
    }
    case "mcp.call": {
      if (target.match !== undefined && !target.match.test(request.raw)) return false;
      if (target.subject === undefined) return true;
      const { program, argv, path, host } = target.subject;
      if (path !== undefined || host !== undefined) return false;
      if (program !== undefined && !program.test(request.server)) return false;
      return argv === undefined || argv.test(request.tool);
    }
  }
}

/** The commands a forbid or ask rule may match: everything suspected. */
function suspects(request: Request): readonly ShellCommand[] {
  return request.action === "shell.exec" ? request.extraction.suspects : [];
}

/** The commands a permit rule must cover: only what was proven. */
function proven(request: Request): readonly ShellCommand[] | undefined {
  if (request.action !== "shell.exec") return [];
  return request.extraction.kind === "resolved" ? request.extraction.commands : undefined;
}

// ---------------------------------------------------------------------------
// Judgment
// ---------------------------------------------------------------------------

function describe(request: Request): readonly string[] {
  switch (request.action) {
    case "shell.exec": {
      const x = request.extraction;
      const commands = x.kind === "resolved" ? x.commands : x.suspects;
      return commands.map((c) => [c.program, ...c.argv].join(" "));
    }
    case "fs.write":
    case "fs.edit":
      return [request.path];
    case "net.fetch":
      return [request.host];
    case "mcp.call":
      return [request.raw];
  }
}

function extractionSummary(request: Request): Judgment["extraction"] {
  if (request.action !== "shell.exec") return undefined;
  const x = request.extraction;
  switch (x.kind) {
    case "resolved":
      return { kind: "resolved" };
    case "unresolved":
      return { kind: "unresolved", detail: `${x.reason.kind}: ${x.reason.detail}` };
    case "carrier":
      return { kind: "carrier", detail: `${x.carrier}: ${x.detail}` };
  }
}

function judgment(
  request: Request,
  decision: Decision,
  source: Judgment["source"],
  ruleId?: string,
): Judgment {
  return {
    decision,
    source,
    ...(ruleId === undefined ? {} : { ruleId }),
    action: request.action,
    subject: describe(request),
    ...(request.action === "shell.exec" ? { extraction: extractionSummary(request) } : {}),
  };
}

/** Why a permit cannot be granted: what stopped the strict reading. */
function unprovenReason(request: Request): string {
  if (request.action !== "shell.exec") return "jig: could not read the request";
  const x = request.extraction;
  if (x.kind === "unresolved") return `jig: could not read the command (${x.reason.detail})`;
  if (x.kind === "carrier")
    return `jig: ${x.carrier} runs code the guard cannot read (${x.detail})`;
  return "jig: could not read the command";
}

function isActive(rule: Rule, principal: Principal): boolean {
  if (!rule.profiles.includes(principal.profile)) return false;
  return rule.principals === undefined || rule.principals.includes(principal.harness);
}

/** Judge one request under one policy for one principal. */
export function evaluatePolicy(policy: Policy, request: Request, principal: Principal): Judgment {
  const suspected = suspects(request);

  const floor: FloorRule | undefined = policy.floor.find(
    (rule) => rule.action === request.action && holds(rule, request, suspected),
  );
  if (floor !== undefined) {
    return judgment(request, { kind: "deny", reason: floor.why }, "floor", floor.id);
  }

  const active = policy.rules.filter(
    (rule) => rule.action === request.action && isActive(rule, principal),
  );

  const forbid = active.find((rule) => rule.effect === "forbid" && holds(rule, request, suspected));
  if (forbid !== undefined) {
    return judgment(request, { kind: "deny", reason: forbid.why ?? forbid.id }, "rule", forbid.id);
  }

  const ask = active.find((rule) => rule.effect === "ask" && holds(rule, request, suspected));
  if (ask !== undefined) {
    return judgment(request, { kind: "ask", reason: ask.why ?? ask.id }, "rule", ask.id);
  }

  if (policy.mode[request.action] === "allowlist") {
    const commands = proven(request);
    if (commands === undefined) {
      return judgment(request, { kind: "ask", reason: unprovenReason(request) }, "allowlist");
    }
    const permits = active.filter((rule) => rule.effect === "permit");
    const covered =
      request.action === "shell.exec"
        ? commands.every((cmd) => permits.some((rule) => holds(rule, request, [cmd])))
        : permits.some((rule) => holds(rule, request, []));
    if (!covered) {
      return judgment(
        request,
        { kind: "ask", reason: `jig: no permit rule covers ${describe(request).join("; ")}` },
        "allowlist",
      );
    }
  }

  return judgment(request, { kind: "allow" }, "none");
}
