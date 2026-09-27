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
// One model at a time (--sequential):
//
//   node quant-ab.mjs --sequential --context-length 32768 --parallel 1 \
//     --models 'qwen/qwen3.8-27b@4bit,qwen/qwen3.8-27b@8bit' --runs 2
//
// --sequential unloads whatever is resident, loads each model on its own, waits
// for it to come up, reads the identifier LM Studio actually assigned, and
// drives the prompts through that identifier — so a 4bit and an 8bit build of
// the same model are never confused for one another. It also records the
// measured footprint per model (weights, context, parallel slots), because on a
// unified-memory machine the model that wins on speed and quality can still
// lose on fitting.
//
// Context length and parallel slots follow the model. Each model gets the
// context it was built and configured for, which is the comparison that matches
// how it would actually be run — forcing one value on all of them would compare
// models at a size none of them would use, and LM Studio overrides the request
// anyway. Pass --context-length / --parallel to force a value instead; either
// way the report shows what was actually loaded.
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
const MAXTOK = parseInt(args["max-tokens"] || "4096", 10);
const PROMPTS_PATH = args.prompts || new URL("./prompts.json", import.meta.url).pathname;
const OUT = args.out || null;
// BENCH_API_KEY keeps a real key off the command line (ps shows argv).
const APIKEY = process.env.BENCH_API_KEY || args["api-key"] || "lm-studio";
const SEQUENTIAL = args.sequential === "true";
const CTX = args["context-length"] ? parseInt(args["context-length"], 10) : null;
const PARALLEL = args.parallel ? parseInt(args.parallel, 10) : null;

if (MODELS.length < 1) {
  console.error("need --models 'idA,idB' (LM Studio model ids). --help for usage.");
  process.exit(2);
}

const spec = JSON.parse(await readFile(PROMPTS_PATH));
const SYSTEM = args["system"] || spec.system || "";
const PROMPTS = spec.prompts || [];

// results[model][promptId] = [{text, ttftMs, decodeTps, completionTokens, totalMs, grade, error}]
const results = {};
// mem[model] = {identifier, selectedVariant, sizeBytes, contextLength, parallel} | null
const mem = {};

// Pre-seed every model so a partial report (written after each model, so a
// later failure cannot lose earlier work) has defined rows to render.
for (const m of MODELS) {
  results[m] = {};
  for (const p of PROMPTS) results[m][p.id] = [];
}
const ranModels = [];

if (SEQUENTIAL) await preflightVariants();

for (const model of MODELS) {
  // The id to send in the request body. Without --sequential this is the model
  // key the operator passed (they manage what is resident); with it, we read
  // back the identifier LM Studio gave the load, so a variant that shares a
  // path with a sibling (qwen/x@4bit vs qwen/x@8bit) cannot be mislabelled.
  let servedAs = model;

  if (SEQUENTIAL) {
    // Unload before *every* load, not only the first. On a unified-memory
    // machine the previous model is still resident, and LM Studio's own
    // guardrails then refuse the next one ("Model loading was stopped due to
    // insufficient system resources") — which is exactly what happened the
    // first time this ran, after model 1 at 16.08 GB blocked a 37.75 GB MoE.
    await unloadAll();
    process.stderr.write(`\n  loading ${model} …\n`);
    await loadModel(model);
    const loaded = await waitLoaded(model);
    mem[model] = loaded;
    servedAs = loaded.identifier;
    process.stderr.write(
      `  loaded as \`${servedAs}\` — ${fmtBytes(loaded.sizeBytes)}, ctx ${loaded.contextLength}, parallel ${loaded.parallel}, variant ${loaded.selectedVariant}\n`,
    );
    if (CTX != null && loaded.contextLength != null && loaded.contextLength !== CTX) {
      process.stderr.write(
        `  note: asked for context ${CTX}, LM Studio loaded ${loaded.contextLength}\n`,
      );
    }
  }

  results[model] = {};
  for (const p of PROMPTS) {
    results[model][p.id] = [];
    for (let run = 0; run < RUNS; run++) {
      process.stderr.write(`  ${model} · ${p.id} · run ${run + 1}/${RUNS}\r`);
      let r;
      try {
        r = await streamChat(servedAs, SYSTEM, p.user);
        // A reasoning model can spend the whole budget in reasoning_content and
        // never emit content. Grading that as a wrong answer measures the token
        // floor, not the model: measured here, `enum-route` at max_tokens 512
        // returned finish_reason=length with content_chars=0, and the same
        // prompt at 2048 returned "billing". So a truncated run is recorded as
        // *ungraded*, never as a failure.
        r.grade = r.finish === "length" ? { pass: null, detail: "truncated" } : grade(r.text, p.check);
      } catch (e) {
        r = { text: "", ttftMs: null, decodeTps: null, completionTokens: 0, totalMs: null, grade: { pass: false, detail: "error" }, error: String(e).slice(0, 200) };
      }
      results[model][p.id].push(r);
    }
  }

  ranModels.push(model);
  // Persist after every model. The first version of this only wrote at the end,
  // and a load failure on model 2 threw away model 1's twenty measurements.
  if (OUT) {
    await writeFile(OUT, report(ranModels));
    console.error(`\n  partial report -> ${OUT}`);
  }
}
process.stderr.write("\n");

const md = report(ranModels);
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

  let text = "", tFirst = null, tLast = null, completionTokens = 0, finish = null;
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
      const fr = j.choices?.[0]?.finish_reason;
      if (fr != null) finish = fr;
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
    finish,
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

function report(ran = MODELS) {
  // Only models that actually ran: a partial report mid-run must not render a
  // row for a model whose turn has not come yet.
  const M = ran && ran.length ? ran : MODELS;
  const L = [];
  L.push(`# Local quant A/B — deterministic tier\n`);
  L.push(`- base: \`${BASE}\` · runs/prompt: ${RUNS} · max_tokens: ${MAXTOK} · temp 0, seed 0`);
  L.push(`- models: ${M.map((m) => `\`${m}\``).join(" vs ")}`);
  L.push(`- prompts: ${PROMPTS.length} (${PROMPTS_PATH})\n`);

  // Speed
  L.push(`## Speed\n`);
  L.push(`| model | avg TTFT (ms) | avg decode (tok/s) | avg total (ms) |`);
  L.push(`|---|--:|--:|--:|`);
  for (const m of M) {
    const all = PROMPTS.flatMap((p) => results[m][p.id]);
    L.push(`| \`${m}\` | ${fx(avg(all.map((r) => r.ttftMs)), 0)} | ${fx(avg(all.map((r) => r.decodeTps)), 1)} | ${fx(avg(all.map((r) => r.totalMs)), 0)} |`);
  }
  L.push("");

  // Memory (only meaningful when we controlled the load)
  if (SEQUENTIAL) {
    L.push(`## Memory (measured after load)\n`);
    const pinned = [];
    if (CTX != null) pinned.push(`context ${CTX}`);
    if (PARALLEL != null) pinned.push(`parallel ${PARALLEL}`);
    L.push(
      pinned.length
        ? `- requested for every model: ${pinned.join(", ")} (LM Studio may override; the columns below are what it actually loaded)\n`
        : `- context and parallel left to LM Studio, per model — each model runs at its own size\n`,
    );
    L.push(`| model | variant loaded | weights (GB) | ctx | parallel |`);
    L.push(`|---|---|--:|--:|--:|`);
    for (const m of M) {
      const x = mem[m];
      L.push(
        `| \`${m}\` | \`${x?.selectedVariant ?? "—"}\` | ${x?.sizeBytes != null ? (x.sizeBytes / 1e9).toFixed(2) : "—"} | ${x?.contextLength ?? "—"} | ${x?.parallel ?? "—"} |`,
      );
    }
    L.push("");
  }

  // Quality
  L.push(`## Quality (auto-graded, run 1)\n`);
  const passCount = Object.fromEntries(M.map((m) => [m, 0]));
  let gradable = 0;
  L.push(`| prompt | check | ${M.map((m) => `\`${m.slice(0, 22)}\``).join(" | ")} | agree? |`);
  L.push(`|---|---|${M.map(() => "---").join("|")}|---|`);
  for (const p of PROMPTS) {
    const cells = [];
    const firstOuts = [];
    for (const m of M) {
      const r = results[m][p.id][0];
      const g = r.grade;
      if (g.pass === true) passCount[m]++;
      cells.push(
        g.pass === null
          ? (g.detail === "truncated" ? "✂ token limit" : `· ${trunc(r.text, 18)}`)
          : (g.pass ? `✅` : `❌ ${g.detail}`),
      );
      firstOuts.push(norm(r.text));
    }
    if (PROMPTS.some(() => true) && results[M[0]][p.id][0].grade.pass !== null) gradable++;
    const agree = firstOuts.every((o) => o === firstOuts[0]) ? "=" : "≠";
    L.push(`| ${p.id} | ${p.check?.type || "human"} | ${cells.join(" | ")} | ${agree} |`);
  }
  L.push("");
  L.push(`**auto-pass:** ${M.map((m) => `\`${m}\` ${passCount[m]}/${gradable}`).join(" · ")}\n`);

  // Truncation is not a quality signal, so it gets its own line rather than
  // hiding inside the failure column.
  const truncs = Object.fromEntries(
    M.map((m) => [m, PROMPTS.reduce((n, p) => n + results[m][p.id].filter((r) => r.grade.detail === "truncated").length, 0)]),
  );
  if (Object.values(truncs).some((n) => n > 0)) {
    L.push(
      `**hit the ${MAXTOK}-token limit (ungraded, not failures):** ` +
        M.map((m) => `\`${m}\` ${truncs[m]}/${PROMPTS.length * RUNS}`).join(" · ") +
        `\n- raise \`--max-tokens\` — a reasoning model spends its budget in reasoning_content before writing content\n`,
    );
  }

  // Errors: what the backend said, so a failed run can be diagnosed
  const errored = M.filter((m) => PROMPTS.some((p) => results[m][p.id].some((r) => r.error)));
  if (errored.length) {
    L.push(`## Errors\n`);
    for (const m of errored) {
      const counts = new Map();
      for (const p of PROMPTS) for (const r of results[m][p.id]) if (r.error) counts.set(r.error, (counts.get(r.error) || 0) + 1);
      for (const [msg, n] of counts) L.push(`- \`${m}\` ×${n}: \`${msg.replace(/`/g, "'")}\``);
    }
    L.push("");
  }

  // Determinism (run-to-run identity); an errored run is not an output
  if (RUNS > 1) {
    L.push(`## Determinism (identical output across ${RUNS} runs)\n`);
    for (const m of M) {
      const ok = PROMPTS.filter((p) => results[m][p.id].every((r) => !r.error));
      const nondet = ok.filter((p) => new Set(results[m][p.id].map((r) => r.text)).size > 1).map((p) => p.id);
      const skipped = PROMPTS.length - ok.length;
      const verdict = ok.length === 0 ? "not measured (every prompt errored)"
        : nondet.length === 0 ? "all deterministic ✅" : `varied on ${nondet.join(", ")} ⚠️`;
      L.push(`- \`${m}\`: ${verdict}${skipped && ok.length ? ` (${skipped} errored prompts not compared)` : ""}`);
    }
    L.push("");
  }

  // Disagreements detail
  const diffs = PROMPTS.filter((p) => {
    const outs = M.map((m) => norm(results[m][p.id][0].text));
    return new Set(outs).size > 1;
  });
  if (diffs.length) {
    L.push(`## Where models disagree (run 1)\n`);
    for (const p of diffs) {
      L.push(`**${p.id}** (${p.category})`);
      for (const m of M) L.push(`- \`${m}\`: ${trunc(results[m][p.id][0].text, 160)}`);
      L.push("");
    }
  }
  return L.join("\n");
}
function trunc(s, n) { s = (s || "").replace(/\n/g, "⏎"); return s.length > n ? s.slice(0, n) + "…" : s; }

// ------------------------------------------------------------- load control
// Uses the `lms` CLI (LM Studio's own). Everything here is read-back or
// load/unload — no inference goes through it, so timing stays in streamChat.

async function lmsPs() {
  try {
    const { stdout } = await run("lms", ["ps", "--json"], { maxBuffer: 8 << 20, timeout: 60000 });
    const j = JSON.parse(stdout);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function unloadAll() {
  for (const m of await lmsPs()) {
    const id = m.identifier || m.modelKey;
    if (!id) continue;
    process.stderr.write(`  unloading ${id}\n`);
    try {
      await run("lms", ["unload", id], { maxBuffer: 8 << 20, timeout: 120000 });
    } catch (e) {
      process.stderr.write(`  (unload ${id} failed: ${String(e).slice(0, 120)})\n`);
    }
  }
}

async function loadModel(key) {
  const a = ["load", baseKey(key), "--yes"];
  if (CTX != null) a.push("--context-length", String(CTX));
  if (PARALLEL != null) a.push("--parallel", String(PARALLEL));
  try {
    await run("lms", a, { maxBuffer: 8 << 20, timeout: 900000 });
  } catch (e) {
    throw new Error(`lms load ${baseKey(key)} failed: ${String(e.stderr || e).slice(0, 300)}`);
  }
}

async function waitLoaded(key, timeoutMs = 900000) {
  const t0 = Date.now();
  const base = baseKey(key);
  for (;;) {
    const hit = (await lmsPs()).find((m) => m.modelKey === base);
    if (hit) {
      return {
        identifier: hit.identifier || hit.modelKey,
        selectedVariant: hit.selectedVariant || null,
        sizeBytes: hit.sizeBytes ?? null,
        contextLength: hit.contextLength ?? null,
        parallel: hit.parallel ?? null,
      };
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${base} to load`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function baseKey(key) {
  return key.split("@")[0];
}

// LM Studio cannot load a *chosen* variant: `lms load` and the REST load
// endpoint both ignore the `@quant` suffix and load whichever variant is
// selected in the app (lmstudio-ai/lmstudio-bug-tracker#1462, still open as of
// 2026-09). A run that asks for `path@4bit` while `path@8bit` is selected would
// silently measure the wrong build and label it with the one you asked for.
// So: read the selection, refuse to start on a mismatch. Each variant has to be
// its own pass, with the app's selection flipped in between.
async function selectedVariantOf(base) {
  try {
    const res = await fetch(`${new URL(BASE).origin}/api/v1/models`);
    if (!res.ok) return null;
    const j = await res.json();
    const hit = (j.data || j.models || []).find((m) => (m.key ?? m.id) === base);
    return hit?.selected_variant ?? hit?.selectedVariant ?? null;
  } catch {
    return null;
  }
}

async function preflightVariants() {
  const wanted = MODELS.filter((k) => k.includes("@"));
  if (!wanted.length) return;

  const selected = new Map();
  for (const b of [...new Set(wanted.map(baseKey))]) selected.set(b, await selectedVariantOf(b));

  const bad = wanted.filter((k) => {
    const sel = selected.get(baseKey(k));
    return sel && sel !== k;
  });
  if (!bad.length) return;

  console.error("refusing to run: LM Studio will not load the variant that was asked for.\n");
  for (const k of bad) console.error(`  asked for  ${k}\n  would load ${selected.get(baseKey(k))}`);
  console.error(
    "\n  The CLI and the REST load endpoint ignore variant keys and load the\n" +
      "  variant selected in the LM Studio app (lmstudio-bug-tracker#1462).\n" +
      "  Select it there, then run that variant as its own pass.",
  );
  process.exit(2);
}

async function run(cmd, argv, opts) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile)(cmd, argv, opts);
}

function fmtBytes(n) {
  return n == null ? "?" : `${(n / 1e9).toFixed(2)} GB`;
}

// ---------------------------------------------------------------- util
function parseArgs(a) { const o = {}; for (let i = 0; i < a.length; i++) { if (a[i].startsWith("--")) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true"; o[k] = v; } } return o; }
async function readFile(p) { return (await import("node:fs/promises")).readFile(p, "utf8"); }
async function writeFile(p, c) { return (await import("node:fs/promises")).writeFile(p, c); }
