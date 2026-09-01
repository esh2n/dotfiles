'use strict';

/**
 * Converts a merged permission layer set (see parse.js) into omp's shape.
 *
 * omp (see scratchpad spikes S4/S5) has no declarative per-command or
 * per-path permission list: the only enforcement point is the `tool_call`
 * extension event (`{block:true, reason}` on `~/.omp/agent/extensions/
 * yoki-guard.ts`, already wired in on this machine — see MEMORY.md
 * "omp migration"). So this module produces the data that guard extension
 * should consume, not an omp config file:
 *
 *   - bash.patterns: [{pattern, action: "deny"|"allow", reason}] — the
 *     `Bash(...)` entries, for a `tool_call` handler to match against
 *     `input.command` the same way pre-permission-guard.js does for Claude.
 *   - tools.approval: a name → "allow"|"deny" map for tool-level patterns
 *     that have no arguments to match (`Read(**)`, `Task(**)`, ...).
 *   - unexpressible: everything else (path-glob Edit/Read denies,
 *     `WebFetch(domain:...)`) — omp has no filesystem-permission layer like
 *     Codex's, so these can only be enforced by a `tool_call` hook matching
 *     `input.path` / `input.url`.
 *   - guardDeny: the deny half of that, unioned with the `enforce: [hook]`
 *     entries — the list lib/targets/omp.js writes to
 *     `<out>/.yoki/permissions.json` for hooks/pre-permission-guard.js to
 *     enforce. Before this existed only the `enforce: [hook]` subset reached
 *     the guard, so on omp every `Read(...)`/`Edit(...)`/`WebFetch(...)` deny
 *     that permissions.yaml did not explicitly tag was unenforced.
 */

const { loadAndMerge } = require('./parse');
const { hookEnforcedDeny, mergeGuardDeny } = require('./guard-deny');

const BASH_PATTERN_RE = /^Bash\((.+)\)$/;
const TOOL_ONLY_RE = /^([A-Za-z]+)\(\*\*\)$/; // e.g. Read(**), Grep(**), Task(**)
const BARE_TOOL_RE = /^([A-Za-z]+)$/; // e.g. WebSearch

function toBashPatterns(entries, action) {
  const patterns = [];
  for (const entry of entries) {
    const m = BASH_PATTERN_RE.exec(entry.pattern);
    if (!m) continue;
    patterns.push({ pattern: m[1], action, reason: entry.reason || '' });
  }
  return patterns;
}

/**
 * Deny wins, always. `Read(**)` and a bare `Read` collapse to the same
 * `approval` key (and omp-tool-names.js collapses several more — LS and Read
 * are both `read`, TodoRead/TodoWrite are both `todo`), so allow and deny
 * really can collide here even though today's shipped permissions.yaml files
 * happen not to. Every sibling converter resolves that collision deny-first
 * (to-codex.js emits "forbidden > prompt > allow"; to-claude.js leans on
 * Claude Code's own deny-wins; yoki-bridge.ts combines with "first deny
 * wins") — writing an allow over an existing deny here would make omp the
 * one target where a deny reads as enforced but silently is not.
 */
function toToolApproval(entries, action, approval) {
  for (const entry of entries) {
    const toolOnly = TOOL_ONLY_RE.exec(entry.pattern) || BARE_TOOL_RE.exec(entry.pattern);
    if (!toolOnly) continue;
    const name = toolOnly[1];
    if (approval[name] === 'deny' && action !== 'deny') continue; // never downgrade a deny
    approval[name] = action;
  }
}

function toUnexpressible(entries, action) {
  const out = [];
  for (const entry of entries) {
    if (BASH_PATTERN_RE.test(entry.pattern)) continue;
    if (TOOL_ONLY_RE.test(entry.pattern) || BARE_TOOL_RE.test(entry.pattern)) continue;
    // Everything left is a path-glob Edit(...)/Read(...)/WebFetch(domain:...)
    // pattern — omp has no config key for any of these.
    out.push({
      pattern: entry.pattern,
      action,
      reason: entry.reason || '',
      note: action === 'deny'
        ? 'omp has no declarative path/domain permission list; enforced by pre-permission-guard on the tool_call event instead'
        : 'omp has no declarative path/domain permission list; omp falls back to its own approvalMode for these calls',
    });
  }
  return out;
}

/**
 * @param {{allow: Array, deny: Array}} merged
 */
function convertMerged(merged) {
  const bashPatterns = [...toBashPatterns(merged.deny, 'deny'), ...toBashPatterns(merged.allow, 'allow')];

  // allow first, deny last — combined with the "never downgrade a deny"
  // guard in toToolApproval, a tool named in both lists resolves to deny.
  const approval = {};
  toToolApproval(merged.allow, 'allow', approval);
  toToolApproval(merged.deny, 'deny', approval);

  const unexpressible = [...toUnexpressible(merged.deny, 'deny'), ...toUnexpressible(merged.allow, 'allow')];

  // Only the DENY half is enforceable by a guard hook: an unexpressible
  // allow (`Edit(./**)`, `WebFetch(domain:*)`) just means omp falls back to
  // its own approvalMode for those calls, which is a prompt, not a hole.
  const guardDeny = mergeGuardDeny(
    hookEnforcedDeny(merged),
    unexpressible.filter(e => e.action === 'deny').map(e => ({ pattern: e.pattern, reason: e.reason }))
  );

  return {
    bash: { patterns: bashPatterns },
    tools: { approval },
    unexpressible,
    guardDeny,
  };
}

function convert(filePaths) {
  return convertMerged(loadAndMerge(filePaths));
}

module.exports = { convertMerged, convert };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sourcesFlagIndex = args.indexOf('--sources');
  if (sourcesFlagIndex === -1) {
    process.stderr.write('Usage: node to-omp.js --sources <layer.yaml>...\n');
    process.exit(1);
  }
  const filePaths = args.slice(sourcesFlagIndex + 1);
  try {
    process.stdout.write(JSON.stringify(convert(filePaths)));
  } catch (err) {
    process.stderr.write(`to-omp.js: ${err.message}\n`);
    process.exit(1);
  }
}
