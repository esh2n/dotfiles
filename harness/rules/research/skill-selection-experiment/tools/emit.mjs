import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const rows = readFileSync("./stage2.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const labels = JSON.parse(readFileSync("./labels.json", "utf8"));
const catalog = JSON.parse(readFileSync("./stage1/_catalog.json", "utf8"));
const summary = JSON.parse(readFileSync("./stage1/_summary.json", "utf8"));
const droppedInfo = JSON.parse(readFileSync("./stage2.dropped.json", "utf8"));
const known = new Set(catalog.map((c) => c.dir));

const missing = rows.filter((r) => !labels[r.id]).map((r) => r.id);
if (missing.length) { console.error("MISSING LABELS:", missing); process.exit(1); }
const extra = Object.keys(labels).filter((id) => !rows.some((r) => r.id === id));
if (extra.length) console.error("WARN unused labels:", extra);

const out = [];
for (const r of rows) {
  const L = labels[r.id];
  let label, source;
  if (r.stratum === "unscouted") {
    label = r.natural_label;
    source = "native-open";
  } else if (L.l !== undefined) {
    label = L.l;
    source = "model";
  } else {
    label = r.opened_skills[0] ?? r.router_injected[0] ?? "none";
    source = "model";
  }
  if (label !== "none" && !known.has(label)) { console.error("UNKNOWN SKILL", r.id, label); process.exit(1); }
  const rec = {
    id: r.id,
    harness: r.harness,
    date: r.date,
    stratum: r.stratum,
    prompt_excerpt: r.prompt_excerpt,
    prompt_chars: r.prompt_chars,
    excerpt_truncated: r.truncated,
    repo: r.repo,
    lang_signals: r.lang_signals,
    router_injected: r.router_injected,
    router_confidence: r.router_confidence,
    opened_skills: r.opened_skills,
    label,
    label_source: source,
    why: L.w,
    difficulty: L.d,
    verdict: "",
  };
  if (L.d === "難") rec.why_hard = L.wh ?? L.w;
  if (L.dis) rec.disagreement = L.dis;
  if (L.probe) rec.note = "synthetic-probe: prompt was typed by the owner to instrument the router, not to get work done";
  out.push(rec);
}

writeFileSync(join(OUT, "prompts.jsonl"), out.map((r) => JSON.stringify(r)).join("\n") + "\n");

// catalog snapshot
const snapshot = {
  taken_at: "2026-09-22",
  source: "~/.claude/.skills-merged/*/SKILL.md (frontmatter)",
  routable_count: catalog.length,
  excluded: summary.excluded,
  catalog_sha256: null,
  skills: catalog.map((c) => ({
    dir: c.dir,
    name: c.name,
    description_chars: c.description_chars,
    description_sha256: c.description_sha256,
    description_head: c.description.replace(/\s+/g, " ").slice(0, 120),
    source: c.source,
  })),
};
const { createHash } = await import("node:crypto");
snapshot.catalog_sha256 = createHash("sha256")
  .update(snapshot.skills.map((s) => `${s.dir}:${s.description_sha256}`).join("\n"))
  .digest("hex");
writeFileSync(join(OUT, "catalog-snapshot.json"), JSON.stringify(snapshot, null, 2));

// stats for the report
const by = (f) => out.reduce((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {});
const stats = {
  window_days: summary.days,
  transcript_files: summary.files,
  prompts_seen: summary.prompts_total,
  jig_origin_breakdown: summary.origin,
  second_layer_dropped: droppedInfo.dropped,
  second_layer_dropped_total: Object.values(droppedInfo.dropped).reduce((a, b) => a + b, 0),
  none_pool_after_cleaning: droppedInfo.none_pool_cleaned,
  set_size: out.length,
  by_stratum: by((r) => r.stratum),
  by_harness: by((r) => r.harness),
  by_difficulty: by((r) => r.difficulty),
  by_label_source: by((r) => r.label_source),
  label_none: out.filter((r) => r.label === "none").length,
  disagreements: out.filter((r) => r.disagreement).length,
  distinct_labels: [...new Set(out.map((r) => r.label))].length,
  label_distribution: Object.fromEntries(
    Object.entries(by((r) => r.label)).sort((a, b) => b[1] - a[1]),
  ),
};
writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
