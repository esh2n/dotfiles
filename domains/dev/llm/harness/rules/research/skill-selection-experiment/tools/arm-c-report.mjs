#!/usr/bin/env node
// Arm C's window, folded into the pre-declared numbers (PROTOCOL-C.md §2 and §4).
//
// Reads ONLY: the router log (~/.local/state/jig/skill-router.jsonl by default) and,
// when --report is given, the JSON that `jig report skills --days N --json` wrote.
// Writes nothing anywhere. Both inputs are per-turn records this machine already keeps;
// nothing here re-judges or re-asks anything.
//
//   node tools/arm-c-report.mjs --from 2026-09-24
//   node tools/arm-c-report.mjs --from 2026-09-24 --days 14 --report /tmp/arm-c-report.json
//
// The split between the two inputs is not cosmetic. The router log knows what the router
// DID (what it injected, how long it took, what it cost); only the transcripts know what
// the model then OPENED. follow rate and "distinct skills followed" therefore cannot come
// from the log, and are printed as "not supplied" rather than approximated from it.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const logPath = flag("log", join(homedir(), ".local", "state", "jig", "skill-router.jsonl"));
const reportPath = flag("report", undefined);
const days = Number.parseInt(flag("days", "14"), 10);
const fromRaw = flag("from", undefined);

if (fromRaw === undefined || !/^\d{4}-\d{2}-\d{2}/.test(fromRaw)) {
  console.error("usage: arm-c-report.mjs --from YYYY-MM-DD [--days 14] [--log PATH] [--report PATH]");
  console.error("  --from is the day the owner flipped JIG_SKILL_ROUTER_QUESTION=choice.");
  process.exit(2);
}
if (!Number.isFinite(days) || days <= 0) {
  console.error("--days needs a positive number");
  process.exit(2);
}

const from = new Date(`${fromRaw.slice(0, 10)}T00:00:00Z`);
const to = new Date(from.getTime() + days * 86_400_000);

/**
 * Wilson 95% score interval. Used rather than the normal approximation because the
 * denominators here are small (a 14-day window of one person's prompts) and the
 * approximation misbehaves exactly there — PROTOCOL.md §6 asks for Wilson throughout.
 */
function wilson(successes, total) {
  if (total === 0) return undefined;
  const z = 1.959963985;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: (centre - spread) / denominator, high: (centre + spread) / denominator };
}

function rate(successes, total, label) {
  if (total === 0) return `${label.padEnd(30)}  -        (n=0, nothing to divide)`;
  const ci = wilson(successes, total);
  const point = ((successes / total) * 100).toFixed(1);
  const band = `[${(ci.low * 100).toFixed(1)}–${(ci.high * 100).toFixed(1)}]`;
  return `${label.padEnd(30)}  ${point.padStart(5)}%  ${band.padEnd(16)} ${successes}/${total}`;
}

/** Nearest-rank percentile over an already-sorted array. Empty input has no percentile. */
function percentile(sorted, fraction) {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

// ---------- the router log ----------

let rows;
try {
  rows = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
} catch (error) {
  console.error(`cannot read the router log at ${logPath}: ${error.message}`);
  process.exit(1);
}

const window = rows.filter((row) => {
  const at = new Date(row.at ?? 0);
  return at >= from && at < to;
});

// Machine prompts are excluded BY CONSTRUCTION: the hook writes a `skipped` line and never
// spends a judgment on them, so they are not turns this arm decided anything about.
const skipped = window.filter((row) => typeof row.skipped === "string");
const judged = window.filter((row) => typeof row.skipped !== "string");

const failed = judged.filter((row) => typeof row.error === "string");
const injected = judged.filter((row) => Array.isArray(row.skills) && row.skills.length > 0);
const declined = judged.filter(
  (row) => Array.isArray(row.skills) && row.skills.length === 0 && typeof row.error !== "string",
);
const fellBack = judged.filter((row) => typeof row.fallback === "string");

const injectedSkills = new Set();
for (const row of injected) for (const skill of row.skills) injectedSkills.add(skill);

const latencies = judged
  .map((row) => row.latency_ms)
  .filter((value) => typeof value === "number")
  .sort((left, right) => left - right);

const metered = judged.filter((row) => row.usage !== undefined && row.usage !== null);
const tokens = metered.reduce(
  (total, row) => total + (row.usage.input_tokens ?? 0) + (row.usage.output_tokens ?? 0),
  0,
);

const harnesses = new Map();
for (const row of judged) {
  harnesses.set(row.harness ?? "unknown", (harnesses.get(row.harness ?? "unknown") ?? 0) + 1);
}

// ---------- jig report skills, when it was supplied ----------

let followRate;
let followedDistinct;
let followedOf;
if (reportPath !== undefined) {
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const totals = report.totals ?? {};
    const shown = (totals.followed ?? 0) + (totals.partial ?? 0) + (totals.ignored ?? 0);
    // `partial` (several injected, only some opened) counts against, not for: the metric
    // is "the model opened what it was told to", and half of that is not it.
    followRate = { successes: totals.followed ?? 0, total: shown };
    followedDistinct = (report.skills ?? []).filter((row) => (row.followed ?? 0) > 0).length;
    followedOf = report.openedVia ?? "any";
  } catch (error) {
    console.error(`cannot read the skills report at ${reportPath}: ${error.message}`);
    process.exit(1);
  }
}

// ---------- output ----------

const lines = [];
lines.push(`arm C — ${fromRaw.slice(0, 10)} + ${days} days  (to ${to.toISOString().slice(0, 10)})`);
lines.push(`router log: ${logPath}`);
lines.push("");
lines.push(`turns in window              ${window.length}`);
lines.push(`  judged (human prompts)     ${judged.length}`);
lines.push(`  skipped (machine prompts)  ${skipped.length}   excluded by construction, not filtered`);
lines.push(`  judgments that failed      ${failed.length}`);
lines.push(
  `  by harness                 ${[...harnesses].map(([name, count]) => `${name}=${count}`).join("  ") || "-"}`,
);
lines.push("");
lines.push("pre-declared metrics (PROTOCOL-C.md §2)");
lines.push("");

if (followRate === undefined) {
  lines.push(
    "follow rate                     not supplied — run `jig report skills --days " +
      `${days} --json > FILE` +
      "` and pass --report FILE",
  );
  lines.push("distinct skills followed        not supplied — same source");
} else {
  lines.push(rate(followRate.successes, followRate.total, "follow rate"));
  lines.push(
    `${"distinct skills followed".padEnd(30)}  ${String(followedDistinct).padStart(5)}    (opened via: ${followedOf})`,
  );
}

lines.push(rate(fellBack.length, judged.length, "fallback rate  (C: expect 0)"));
lines.push(
  `${"latency P50 / P95 (ms)".padEnd(30)}  ${percentile(latencies, 0.5) ?? "-"} / ${percentile(latencies, 0.95) ?? "-"}   (n=${latencies.length})`,
);
lines.push(
  `${"usage per decision (tokens)".padEnd(30)}  ${metered.length === 0 ? "-" : Math.round(tokens / metered.length)}    (n=${metered.length}; hook-side lines carry none)`,
);
lines.push("");
lines.push("what the router did (the log's own half)");
lines.push(rate(injected.length, judged.length, "turns given an injection"));
lines.push(rate(declined.length, judged.length, "turns the judgment declined"));
lines.push(`${"distinct skills injected".padEnd(30)}  ${injectedSkills.size}`);
// Lines written before 2026-09-20 carry `skill: string | null` instead of `skills[]`, so
// they fall into neither bucket. Inside arm C's window there should be none; printed
// anyway, because a silently shrinking denominator is the failure this guards against.
const unclassified = judged.length - injected.length - declined.length - failed.length;
if (unclassified !== 0) {
  lines.push(
    `${"unclassified line shape".padEnd(30)}  ${unclassified}   pre-2026-09-20 \`skill\` lines; expect 0 in this window`,
  );
}
lines.push("");

if (fellBack.length > 0) {
  lines.push(
    "WARNING: this window is NOT arm C. Arm C is defined with JIG_ROUTER_FALLBACK=0, and",
  );
  lines.push(
    `         ${fellBack.length} turn(s) carry a fallback. Fix the configuration and measure again.`,
  );
  lines.push("");
}

if (followRate !== undefined) {
  const followOk = followRate.total > 0 && followRate.successes / followRate.total >= 0.3;
  const distinctOk = followedDistinct >= 3;
  lines.push("promotion rule (PROTOCOL-C.md §3) — conjunctive");
  lines.push(`  follow rate >= 30%           ${followOk ? "PASS" : "FAIL"}`);
  lines.push(`  distinct skills followed >= 3  ${distinctOk ? "PASS" : "FAIL"}`);
  lines.push(
    followOk && distinctOk
      ? "  => keep the router in shape C. B' may then be attempted."
      : "  => remove the router; return to arm A with `paths:` gating (and per-language",
  );
  if (!(followOk && distinctOk)) {
    lines.push("     delivery on the harnesses with no `paths:` support). B' is not attempted.");
  }
  lines.push("");
}

lines.push("reminders carried from PROTOCOL-C.md §5:");
lines.push("  - C does not achieve the context-saving motive; the listing stays visible.");
lines.push("  - `followed` only ever meant `opened the file`, and shell reads are invisible.");
lines.push("  - jev reproduced the model's own unprompted choice on 5 of 27 turns at tau=0.8.");

console.log(lines.join("\n"));
