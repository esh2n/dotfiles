import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const DIR = process.argv[2];
const rows = readFileSync(DIR + "/prompts.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const SEED = "spot-check-2026-09-22";
const rank = (id) => createHash("sha256").update(SEED + "|" + id).digest("hex");
const ORDER = ["unscouted", "followed", "ignored", "none"];
const pick = (diff) => {
  const pool = rows.filter((r) => r.difficulty === diff).sort((a, b) => (rank(a.id) < rank(b.id) ? -1 : 1));
  const out = [];
  // round-robin over strata so every difficulty band spans the strata it can
  let guard = 0;
  while (out.length < 10 && guard++ < 20) {
    for (const s of ORDER) {
      if (out.length >= 10) break;
      const next = pool.find((r) => r.stratum === s && !out.includes(r));
      if (next) out.push(next);
    }
  }
  return out;
};
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
let md = `# Spot check — 30 prompts for the owner to verify by hand

Fill the **verdict** column with \`ok\` (the provisional label is right), a skill name
(the right one, if the label is wrong), or \`none\`. Add a short reason when you overrule.
Answer in chat or edit this file; either way, copy your verdicts into \`prompts.jsonl\`'s
\`verdict\` field before the protocol is frozen.

\`src\` — **N** = natural label (the model opened this skill by itself, no injection);
**M** = provisional label assigned by a model and not yet verified.

`;
for (const diff of ["易", "中", "難"]) {
  const sel = pick(diff);
  md += `## ${diff} (${sel.length})\n\n`;
  md += `| id | stratum | src | prompt (redacted excerpt) | provisional label | why | verdict |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const r of sel) {
    md += `| \`${r.id}\` | ${r.stratum} | ${r.label_source === "native-open" ? "N" : "M"} | ${cell(clip(r.prompt_excerpt, 110))} | \`${r.label}\` | ${cell(r.why)}${r.disagreement ? " **⚠ この自然ラベルに不同意**: " + cell(r.disagreement) : ""}${r.why_hard && r.why_hard !== r.why ? " _(難しさ: " + cell(r.why_hard) + ")_" : ""} |  |\n`;
  }
  md += `\n`;
}
writeFileSync(DIR + "/spot-check.md", md);
const sel = ["易","中","難"].flatMap(pick);
console.log("picked", sel.length, sel.reduce((a,r)=>((a[r.stratum]=(a[r.stratum]??0)+1),a),{}));
