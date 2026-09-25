// Stage 2: stratified sample + redaction. Deterministic (seeded).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const IN = "./stage1";
const OUT = process.argv[2] ?? "./stage2";
const HOME = homedir();
const SEED = "skill-selection-experiment-2026-09-22";
const TARGET_NONE = 126;

const load = (n) => readFileSync(`${IN}/_${n}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

function redact(text) {
  let t = text;
  t = t.replaceAll(HOME, "~");
  t = t.replace(/\/Users\/[A-Za-z0-9._-]+/g, "~");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
  t = t.replace(/\besh2n\b/gi, "<user>");
  t = t.replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9-]{10,}|ey[A-Za-z0-9_-]{20,})\b/g, "<token>");
  t = t.replace(/[ \t]+/g, " ");
  return t.trim();
}

/**
 * A SECOND exclusion layer, on top of jig's `prompt-origin.ts`.
 * Every entry here is machine-generated text that jig's current signature list lets
 * through as "human". Recorded so the gap can be fixed in jig and so the prompt set
 * does not silently carry non-requests.
 */
function extraExclusion(p) {
  const t = p.trimStart();
  if (t.startsWith("[Your previous response had no visible output")) return "harness-nudge";
  if (t.startsWith("[Request interrupted by user")) return "harness-notice";
  if (t.startsWith("Your claude.ai usage limit has reset")) return "harness-notice";
  if (t.startsWith("<local-command-caveat>")) return "harness-notice";
  if (t.startsWith("Continue from where you left off")) return "harness-notice";
  if (/^<command-name>\/(clear|compact|init)\b/.test(t)) return "slash-noop";
  if (/^\/(clear|compact)\b/.test(t)) return "slash-noop";
  if (/^<command-(name|message)>[^<]*<\/command-\1>\s*(<command-args><\/command-args>)?\s*$/.test(t)) return "slash-noop";
  if (t.startsWith("# /") || /^---\s*\n(name|description|argument-hint):/.test(t)) return "command-body";
  if (t.startsWith("Approach this as the design lead")) return "command-body";
  if (t.includes("workflowScript")) return "command-body";
  if (t.includes("## Acceptance Contract")) return "workflow-task";
  if (t.startsWith("Reply with exactly:")) return "probe";
  return null;
}
const IMAGE_ONLY = /^(\[Image:[^\]]*\]\s*)+$/;

// deterministic rank for sampling
function rank(key) {
  return createHash("sha256").update(SEED + "|" + key).digest("hex");
}

const strata = {
  unscouted: load("unscouted"),
  followed: load("followed"),
  ignored: load("ignored"),
  none: load("none"),
};

const rows = [];
function push(t, stratum) {
  const id = createHash("sha256").update(t.at + "|" + t.session + "|" + t.prompt).digest("hex").slice(0, 12);
  const opened = [...t.read, ...t.skilled.filter((s) => !t.read.includes(s))];
  const redacted = redact(t.prompt);
  rows.push({
    id,
    harness: t.harness,
    date: t.at.slice(0, 10),
    stratum,
    prompt_excerpt: redacted.slice(0, 400),
    prompt_chars: t.prompt.length,
    truncated: redacted.length > 400,
    repo: t.cwd ? t.cwd.replace(HOME, "~").replace(/\/Users\/[A-Za-z0-9._-]+/g, "~") : null,
    lang_signals: Object.keys(t.exts ?? {}).slice(0, 6),
    router_injected: t.injected,
    router_confidence: t.confidence ?? null,
    opened_skills: opened,
    natural_label: stratum === "unscouted" ? (opened[0] ?? null) : null,
    natural_label_all: stratum === "unscouted" ? opened : [],
  });
}

const dropped = {};
const drop = (t) => {
  const r = extraExclusion(t.prompt);
  if (r) { dropped[r] = (dropped[r] ?? 0) + 1; return true; }
  return false;
};

for (const t of strata.unscouted) if (!drop(t)) push(t, "unscouted");
for (const t of strata.followed) if (!drop(t)) push(t, "followed");
for (const t of strata.ignored) if (!drop(t)) push(t, "ignored");

// none: deterministic random sample over the cleaned pool.
// Image-only prompts are real human turns but carry no routable text; a handful are kept
// (they are a legitimate "must abstain" case) and the rest are held back so they do not
// inflate the easy end of the set.
const IMAGE_QUOTA = 5;
const cleaned = strata.none.filter((t) => redact(t.prompt).length >= 8 && !drop(t));
const ranked = cleaned
  .map((t) => ({ t, r: rank(t.at + "|" + t.session) }))
  .sort((a, b) => (a.r < b.r ? -1 : 1));
let images = 0;
const picked = [];
for (const { t } of ranked) {
  if (picked.length >= TARGET_NONE) break;
  if (IMAGE_ONLY.test(t.prompt.trim())) {
    if (images >= IMAGE_QUOTA) continue;
    images++;
  }
  picked.push(t);
}
picked.sort((a, b) => (a.at < b.at ? -1 : 1));
for (const t of picked) push(t, "none");

writeFileSync(`${OUT}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(`${OUT}.dropped.json`, JSON.stringify({ dropped, none_pool_cleaned: cleaned.length }, null, 2));
console.log("total", rows.length, "none pool after cleaning", cleaned.length);
console.log("dropped by extra layer:", dropped);
console.log(rows.reduce((a, r) => ((a[r.stratum] = (a[r.stratum] ?? 0) + 1), a), {}));
