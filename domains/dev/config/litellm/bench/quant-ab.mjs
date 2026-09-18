#!/usr/bin/env node
// quant-ab.mjs — A/B two (or more) local models on the same deterministic-tier
// prompt set. Streams temp-0 completions, measures TTFT + decode tok/s, auto-
// grades against per-prompt checks, and flags cross-model disagreement and
// run-to-run non-determinism. Dependency-free (Node >=20, global fetch).
//
// Point it straight at LM Studio (:1234) so each model is addressed by its own
// LM Studio id (LM Studio can keep several models loaded and route by id).
//
//   node quant-ab.mjs \
//     --base http://localhost:1234/v1 \
//     --models 'qwen3-coder-30b-a3b-4bit,qwen3-coder-30b-a3b-8bit' \
//     --prompts ./prompts.json --runs 2 --out ./report.md
//
// Notes:
//  - temperature 0 + seed 0 are sent for determinism; not all backends honor
//    seed, so run-to-run identity is measured, not assumed.
//  - decode tok/s = completion_tokens / (t_last_token - t_first_token); TTFT =
//    t_first_token - t_request_sent. Needs a streaming backend with usage.

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base || "http://localhost:1234/v1").replace(/\/$/, "");
const MODELS = (args.models || "").split(",").map((s) => s.trim()).filter(Boolean);
const RUNS = Math.max(1, parseInt(args.runs || "2", 10));
const MAXTOK = parseInt(args["max-tokens"] || "512", 10);
const PROMPTS_PATH = args.prompts || new URL("./prompts.json", import.meta.url).pathname;
const OUT = args.out || null;
const APIKEY = args["api-key"] || "lm-studio";

if (MODELS.length < 1) {
  console.error("need --models 'idA,idB' (LM Studio model ids). --help for usage.");
  process.exit(2);
}

const spec = JSON.parse(await readFile(PROMPTS_PATH));
const SYSTEM = args["system"] || spec.system || "";
const PROMPTS = spec.prompts || [];

// results[model][promptId] = [{text, ttftMs, decodeTps, completionTokens, totalMs, grade, error}]
const results = {};
for (const model of MODELS) {
  results[model] = {};
  for (const p of PROMPTS) {
    results[model][p.id] = [];
    for (let run = 0; run < RUNS; run++) {
      process.stderr.write(`  ${model} · ${p.id} · run ${run + 1}/${RUNS}\r`);
      let r;
      try {
        r = await streamChat(model, SYSTEM, p.user);
        r.grade = grade(r.text, p.check);
      } catch (e) {
        r = { text: "", ttftMs: null, decodeTps: null, completionTokens: 0, totalMs: null, grade: { pass: false, detail: "error" }, error: String(e).slice(0, 200) };
      }
      results[model][p.id].push(r);
    }
  }
}
process.stderr.write("\n");

const md = report();
if (OUT) { await writeFile(OUT, md); console.error(`report -> ${OUT}`); }
console.log(md);

// ---------------------------------------------------------------- streaming
async function streamChat(model, system, user) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  const t0 = performance.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${APIKEY}` },
    body: JSON.stringify({
      model, messages, temperature: 0, seed: 0, max_tokens: MAXTOK,
      stream: true, stream_options: { include_usage: true },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let text = "", tFirst = null, tLast = null, completionTokens = 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      // Time ANY generated token (reasoning + content) so decode tok/s spans the
      // whole generation; accumulate only content for grading. Qwen3 "thinking"
      // streams reasoning_content deltas before content — counting only content
      // would divide all completion_tokens by the short content window.
      const d = j.choices?.[0]?.delta || {};
      const gen = d.content ?? d.reasoning_content ?? d.reasoning;
      if (gen != null && gen !== "") {
        const now = performance.now();
        if (tFirst === null) tFirst = now;
        tLast = now;
        if (d.content) text += d.content;
      }
      if (j.usage?.completion_tokens != null) completionTokens = j.usage.completion_tokens;
    }
  }
  const tEnd = performance.now();
  const decodeSpanMs = tFirst != null && tLast != null ? tLast - tFirst : null;
  const decodeTps = completionTokens > 0 && decodeSpanMs > 0 ? (completionTokens / (decodeSpanMs / 1000)) : null;
  return {
    text: text.trim(),
    ttftMs: tFirst != null ? tFirst - t0 : null,
    decodeTps,
    completionTokens,
    totalMs: tEnd - t0,
    error: null,
  };
}

// ---------------------------------------------------------------- grading
function stripFences(s) {
  const m = s.match(/```(?:json|go|[a-z]*)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}
function norm(s) { return stripFences(s).trim().replace(/^["'`]|["'`]$/g, "").trim(); }
function tryJson(s) { try { return JSON.parse(stripFences(s)); } catch { return undefined; } }

function grade(out, check) {
  if (!check || check.type === "human") return { pass: null, detail: "manual" };
  const n = norm(out);
  switch (check.type) {
    case "equals": {
      if (n === check.value) return { pass: true, detail: "exact" };
      if (n.toLowerCase() === String(check.value).toLowerCase()) return { pass: true, detail: "case-insensitive" };
      return { pass: false, detail: `got ${JSON.stringify(n.slice(0, 40))}` };
    }
    case "contains":
      return { pass: out.includes(check.value), detail: out.includes(check.value) ? "found" : "missing" };
    case "regex":
      return { pass: new RegExp(check.pattern).test(out), detail: check.pattern };
    case "valid_json":
      return { pass: tryJson(out) !== undefined, detail: tryJson(out) !== undefined ? "valid" : "invalid" };
    case "json_array_len": {
      const j = tryJson(out);
      const ok = Array.isArray(j) && j.length === check.len;
      return { pass: ok, detail: ok ? `len=${check.len}` : `got ${Array.isArray(j) ? j.length : "non-array"}` };
    }
    case "json_fields": {
      const j = tryJson(out);
      if (j === undefined || typeof j !== "object") return { pass: false, detail: "not json" };
      const miss = [];
      for (const [k, v] of Object.entries(check.fields)) {
        if (String(j[k]) !== String(v)) miss.push(`${k}=${JSON.stringify(j[k])}≠${JSON.stringify(v)}`);
      }
      return { pass: miss.length === 0, detail: miss.length ? miss.join(", ") : "all fields" };
    }
    default:
      return { pass: null, detail: `unknown check ${check.type}` };
  }
}

// ---------------------------------------------------------------- report
function avg(xs) { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function fx(n, d = 0) { return n == null ? "—" : n.toFixed(d); }

function report() {
  const L = [];
  L.push(`# Local quant A/B — deterministic tier\n`);
  L.push(`- base: \`${BASE}\` · runs/prompt: ${RUNS} · max_tokens: ${MAXTOK} · temp 0, seed 0`);
  L.push(`- models: ${MODELS.map((m) => `\`${m}\``).join(" vs ")}`);
  L.push(`- prompts: ${PROMPTS.length} (${PROMPTS_PATH})\n`);

  // Speed
  L.push(`## Speed\n`);
  L.push(`| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |`);
  L.push(`|---|--:|--:|--:|`);
  for (const m of MODELS) {
    const all = PROMPTS.flatMap((p) => results[m][p.id]);
    L.push(`| \`${m}\` | ${fx(avg(all.map((r) => r.ttftMs)), 0)} | ${fx(avg(all.map((r) => r.decodeTps)), 1)} | ${fx(avg(all.map((r) => r.totalMs)), 0)} |`);
  }
  L.push("");

  // Quality
  L.push(`## Quality (auto-graded, run 1)\n`);
  const passCount = Object.fromEntries(MODELS.map((m) => [m, 0]));
  let gradable = 0;
  L.push(`| prompt | check | ${MODELS.map((m) => `\`${m.slice(0, 22)}\``).join(" | ")} | agree? |`);
  L.push(`|---|---|${MODELS.map(() => "---").join("|")}|---|`);
  for (const p of PROMPTS) {
    const cells = [];
    const firstOuts = [];
    for (const m of MODELS) {
      const r = results[m][p.id][0];
      const g = r.grade;
      if (g.pass === true) passCount[m]++;
      cells.push(g.pass === null ? `· ${trunc(r.text, 18)}` : (g.pass ? `✅` : `❌ ${g.detail}`));
      firstOuts.push(norm(r.text));
    }
    if (PROMPTS.some(() => true) && results[MODELS[0]][p.id][0].grade.pass !== null) gradable++;
    const agree = firstOuts.every((o) => o === firstOuts[0]) ? "=" : "≠";
    L.push(`| ${p.id} | ${p.check?.type || "human"} | ${cells.join(" | ")} | ${agree} |`);
  }
  L.push("");
  L.push(`**auto-pass:** ${MODELS.map((m) => `\`${m}\` ${passCount[m]}/${gradable}`).join(" · ")}\n`);

  // Determinism (run-to-run identity)
  if (RUNS > 1) {
    L.push(`## Determinism (identical output across ${RUNS} runs)\n`);
    for (const m of MODELS) {
      const nondet = PROMPTS.filter((p) => {
        const outs = results[m][p.id].map((r) => r.text);
        return new Set(outs).size > 1;
      }).map((p) => p.id);
      L.push(`- \`${m}\`: ${nondet.length === 0 ? "all deterministic ✅" : `varied on ${nondet.join(", ")} ⚠️`}`);
    }
    L.push("");
  }

  // Disagreements detail
  const diffs = PROMPTS.filter((p) => {
    const outs = MODELS.map((m) => norm(results[m][p.id][0].text));
    return new Set(outs).size > 1;
  });
  if (diffs.length) {
    L.push(`## Where models disagree (run 1)\n`);
    for (const p of diffs) {
      L.push(`**${p.id}** (${p.category})`);
      for (const m of MODELS) L.push(`- \`${m}\`: ${trunc(results[m][p.id][0].text, 160)}`);
      L.push("");
    }
  }
  return L.join("\n");
}
function trunc(s, n) { s = (s || "").replace(/\n/g, "⏎"); return s.length > n ? s.slice(0, n) + "…" : s; }

// ---------------------------------------------------------------- util
function parseArgs(a) { const o = {}; for (let i = 0; i < a.length; i++) { if (a[i].startsWith("--")) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true"; o[k] = v; } } return o; }
async function readFile(p) { return (await import("node:fs/promises")).readFile(p, "utf8"); }
async function writeFile(p, c) { return (await import("node:fs/promises")).writeFile(p, c); }
