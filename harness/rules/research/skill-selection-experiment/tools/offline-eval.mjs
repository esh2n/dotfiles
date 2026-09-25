/**
 * OFFLINE arm of the frozen skill-selection experiment (PROTOCOL.md, frozen at 18119e2).
 *
 * Drives the already-running jig judgment service (127.0.0.1:4100) through its own
 * `/decide` wire contract (src/domain/decision/remote.ts) with the four question variants
 * PROTOCOL.md §3 declares: {bool, choice} x {JA, EN}. It never holds the TypeSafe key; the
 * service does.
 *
 * Subcommands:
 *   run <variant>            one pass over all 200 prompts -> results/raw-<variant>.jsonl
 *   stability <variant>      5 reruns over the seeded 40-prompt subset -> results/stability-<variant>.jsonl
 *   order-swap <variant>     choice variants, catalog order reversed, on the 40-prompt subset
 *   subset                   print the seeded 40 ids
 *
 * Read-only on the experiment inputs. Writes only under results/.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const RESULTS = join(EXP, "results");
const SERVICE = process.env.JIG_DECISION_URL ?? "http://127.0.0.1:4100";
const TOKEN_FILE =
  process.env.JIG_DECISION_TOKEN_FILE ??
  join(homedir(), "Library/Application Support/jig/decision.token");
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);
const SEED = "skill-selection-experiment-2026-09-22";
const SUBSET_N = 40;

// ---------------------------------------------------------------- catalog
// jig's own reader, transcribed from src/infra/skills/catalog.ts so the descriptions sent
// are byte-for-byte the ones production sends (quotes unwrapped, block scalars joined).
function parseFrontmatterFields(front) {
  const fields = new Map();
  const lines = front.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (entry === null) continue;
    const key = entry[1] ?? "";
    let value = (entry[2] ?? "").trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? "")) {
        index += 1;
        block.push((lines[index] ?? "").trim());
      }
      value = block.join(" ").trim();
    } else if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    }
    fields.set(key, value);
  }
  return fields;
}

function parseSkillFile(text, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return undefined;
  const front = match[1] ?? "";
  if (/^disable-model-invocation:\s*true\s*$/m.test(front)) return undefined;
  const fields = parseFrontmatterFields(front);
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || description === undefined || description === "") return undefined;
  return { name, description, path };
}

function readCatalog() {
  const root = join(homedir(), ".claude", ".skills-merged");
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry, "SKILL.md");
    if (!existsSync(path)) continue;
    try {
      const c = parseSkillFile(readFileSync(path, "utf8"), path);
      if (c !== undefined) out.push({ dir: entry, ...c });
    } catch {
      /* unreadable entry is not a skill */
    }
  }
  // jig sorts by name; catalog-snapshot.json is in the same order.
  return out.sort((l, r) => l.name.localeCompare(r.name));
}

// ---------------------------------------------------------------- material
// src/app/decision/material.ts, verbatim.
const MATERIAL_HEAD_CHARS = 2_000;
const MATERIAL_TAIL_CHARS = 2_000;
function boundedMaterial(request) {
  if (request.length <= MATERIAL_HEAD_CHARS + MATERIAL_TAIL_CHARS) return request;
  const elided = request.length - MATERIAL_HEAD_CHARS - MATERIAL_TAIL_CHARS;
  return [
    request.slice(0, MATERIAL_HEAD_CHARS),
    `… [${elided} characters elided from the middle of a ${request.length}-character request] …`,
    request.slice(-MATERIAL_TAIL_CHARS),
  ].join("\n\n");
}

// ---------------------------------------------------------------- variants
// PROTOCOL.md §3, worded exactly as frozen.
const NONE_LABEL = "none";

const VARIANTS = {
  "bool-ja": {
    op: "boolBatch",
    build: (request, catalog) => ({
      op: "boolBatch",
      query: {
        material: `依頼: ${boundedMaterial(request)}`,
        prompts: catalog.map(
          (c) => `この依頼は「${c.name}」スキルの手順を必要とするか。（${c.name}: ${c.description}）`,
        ),
      },
      context: {},
    }),
  },
  "bool-en": {
    op: "boolBatch",
    build: (request, catalog) => ({
      op: "boolBatch",
      query: {
        material: `Request: ${boundedMaterial(request)}`,
        prompts: catalog.map(
          (c) => `Does this request need the "${c.name}" skill's procedure? (${c.name}: ${c.description})`,
        ),
      },
      context: {},
    }),
  },
  "choice-ja": {
    op: "choice",
    build: (request, catalog) => ({
      op: "choice",
      query: {
        // The port's ChoiceQuery has no material field — JevProvider sends `query.prompt`
        // as the state — so the protocol's material and question are concatenated here.
        prompt: `依頼: ${boundedMaterial(request)}\n\nこの依頼を進めるのに手順を読むべきスキルはどれか。どれも当てはまらない場合は「none」を選ぶこと。`,
        options: [...catalog.map((c) => c.name), NONE_LABEL],
        criteria: Object.fromEntries([
          ...catalog.map((c) => [c.name, c.description]),
          [NONE_LABEL, "どのスキルの手順も必要としない依頼"],
        ]),
      },
      context: {},
    }),
  },
  "choice-en": {
    op: "choice",
    build: (request, catalog) => ({
      op: "choice",
      query: {
        prompt: `Request: ${boundedMaterial(request)}\n\nWhich skill's instructions should be read before doing this request? Choose "none" if none of them applies.`,
        options: [...catalog.map((c) => c.name), NONE_LABEL],
        criteria: Object.fromEntries([
          ...catalog.map((c) => [c.name, c.description]),
          [NONE_LABEL, "a request that needs none of these skills' procedures"],
        ]),
      },
      context: {},
    }),
  },
};

// ---------------------------------------------------------------- transport
function token() {
  try {
    const t = readFileSync(TOKEN_FILE, "utf8").trim();
    return t === "" ? undefined : t;
  } catch {
    return undefined;
  }
}

const BEARER = token();
if (BEARER === undefined) {
  console.error(`no bearer token at ${TOKEN_FILE}`);
  process.exit(2);
}

let judgmentCalls = 0;
let retries = 0;

async function decide(request, timeoutMs = 120_000) {
  judgmentCalls += 1;
  const startedAt = performance.now();
  const response = await fetch(`${SERVICE}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { op: "error", error: { kind: "provider-error", message: `non-JSON ${response.status}` } };
  }
  return { status: response.status, body, latencyMs };
}

async function decideWithRetry(request, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await decide(request);
    if (result.status === 200) return result;
    last = result;
    // 400 is our bug, not a flaky model: no point retrying it.
    if (result.status === 400 || result.status === 401) return result;
    retries += 1;
    await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
  }
  return last;
}

async function metricsSnapshot() {
  const text = await fetch(`${SERVICE}/metrics`).then((r) => r.text());
  const out = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const m = /^(\S+?)(\{.*\})?\s+([0-9.eE+-]+)$/.exec(line);
    if (m === null) continue;
    out[`${m[1]}${m[2] ?? ""}`] = Number(m[3]);
  }
  return out;
}

// ---------------------------------------------------------------- data
function readPrompts() {
  return readFileSync(join(EXP, "prompts.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

/** The frozen key: the owner's verdict where one exists, else the provisional label. */
export function effectiveLabel(row) {
  const verdict = (row.verdict ?? "").trim();
  if (verdict === "" || verdict === "ok") return row.label;
  return verdict;
}

function seededSubset(rows, n = SUBSET_N) {
  return rows
    .map((row) => ({ row, rank: createHash("sha256").update(`${SEED}|${row.id}`).digest("hex") }))
    .sort((l, r) => (l.rank < r.rank ? -1 : l.rank > r.rank ? 1 : 0))
    .slice(0, n)
    .map((e) => e.row);
}

// ---------------------------------------------------------------- run
async function pool(items, worker, size = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * One judgment -> a raw row. For boolBatch, jev's noul is recovered from the adapter's
 * own mapping (`value = noul >= 0.5`, `confidence = max(noul, 1-noul)`, see
 * infra/decision/jev-provider.ts::noulToBool), so `p` below is the model's probability
 * that the skill applies, per candidate, not the flipped confidence.
 */
function rawRow(variant, row, catalog, result) {
  const base = {
    id: row.id,
    variant,
    latency_ms: result.latencyMs,
    status: result.status,
    usage: null, // /decide carries no usage on the wire; see RESULTS-OFFLINE.md §method
  };
  if (result.status !== 200) {
    return { ...base, error: result.body?.error ?? { kind: "unknown", message: String(result.status) } };
  }
  if (result.body.op === "boolBatch") {
    const values = result.body.values;
    const skills = catalog.map((c, i) => {
      const d = values[i];
      const p = d === undefined ? null : d.value === true ? d.confidence : 1 - d.confidence;
      return { name: c.name, value: d?.value ?? null, confidence: d?.confidence ?? null, p };
    });
    return { ...base, op: "boolBatch", skills };
  }
  if (result.body.op === "choice") {
    return { ...base, op: "choice", choice: result.body.value, confidence: result.body.confidence };
  }
  return { ...base, error: { kind: "protocol", message: `unexpected op ${result.body.op}` } };
}

async function runPass(variant, rows, catalog, outPath, runIndex) {
  const spec = VARIANTS[variant];
  if (spec === undefined) throw new Error(`unknown variant ${variant}`);
  mkdirSync(RESULTS, { recursive: true });
  let done = 0;
  await pool(rows, async (row) => {
    const request = spec.build(row.prompt_excerpt, catalog);
    const result = await decideWithRetry(request);
    const raw = rawRow(variant, row, catalog, result);
    if (runIndex !== undefined) raw.run = runIndex;
    appendFileSync(outPath, `${JSON.stringify(raw)}\n`);
    done += 1;
    if (done % 20 === 0) process.stderr.write(`  ${variant}${runIndex ?? ""}: ${done}/${rows.length}\n`);
    return raw;
  });
}

// ---------------------------------------------------------------- main
const [, , command, arg] = process.argv;
const allRows = readPrompts();
// EVAL_LIMIT exists only for the wire smoke test; every recorded run uses all 200.
const rows = process.env.EVAL_LIMIT ? allRows.slice(0, Number(process.env.EVAL_LIMIT)) : allRows;
const catalog = readCatalog();

if (command === "subset") {
  const subset = seededSubset(rows);
  console.log(JSON.stringify({ seed: SEED, n: subset.length, ids: subset.map((r) => r.id) }, null, 2));
  process.exit(0);
}

if (command === "run") {
  const variant = arg;
  const outPath = join(RESULTS, `raw-${variant}.jsonl`);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(outPath, "");
  const before = await metricsSnapshot();
  const startedAt = Date.now();
  await runPass(variant, rows, catalog, outPath);
  const after = await metricsSnapshot();
  const delta = {};
  for (const key of Object.keys(after)) {
    if (/^jig_judgment_(tokens|requests)_total/.test(key) && key.includes('kind="decide"')) {
      const d = after[key] - (before[key] ?? 0);
      if (d !== 0) delta[key] = d;
    }
  }
  writeFileSync(
    join(RESULTS, `meta-${variant}.json`),
    JSON.stringify(
      { variant, n: rows.length, catalog: catalog.length, judgmentCalls, retries, wall_s: (Date.now() - startedAt) / 1000, metrics_delta: delta },
      null,
      2,
    ),
  );
  console.error(`${variant}: ${judgmentCalls} /decide calls (${retries} retries)`);
  process.exit(0);
}

if (command === "stability" || command === "order-swap") {
  const variant = arg;
  const subset = seededSubset(rows);
  const useCatalog = command === "order-swap" ? [...catalog].reverse() : catalog;
  const runsCount = command === "stability" ? 5 : 1;
  const outPath = join(RESULTS, `${command}-${variant}.jsonl`);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(outPath, "");
  const before = await metricsSnapshot();
  for (let run = 1; run <= runsCount; run += 1) {
    await runPass(variant, subset, useCatalog, outPath, run);
    console.error(`  run ${run}/${runsCount} done`);
  }
  const after = await metricsSnapshot();
  const delta = {};
  for (const key of Object.keys(after)) {
    if (/^jig_judgment_(tokens|requests)_total/.test(key) && key.includes('kind="decide"')) {
      const d = after[key] - (before[key] ?? 0);
      if (d !== 0) delta[key] = d;
    }
  }
  writeFileSync(
    join(RESULTS, `meta-${command}-${variant}.json`),
    JSON.stringify({ command, variant, subset: subset.map((r) => r.id), runs: runsCount, judgmentCalls, retries, metrics_delta: delta }, null, 2),
  );
  console.error(`${command} ${variant}: ${judgmentCalls} /decide calls (${retries} retries)`);
  process.exit(0);
}

// ---------------------------------------------------------------- scoring
const THRESHOLDS = [0.6, 0.7, 0.8];
const CAP = 3; // select-skills.ts's cap

/** Wilson score interval, 95%. */
function wilson(k, n) {
  if (n === 0) return { p: null, lo: null, hi: null, n: 0, k: 0 };
  const z = 1.959963985;
  const phat = k / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const spread = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return { p: phat, lo: (centre - spread) / denom, hi: (centre + spread) / denom, n, k };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** The selector's answer for one raw row at one threshold. */
function answerAt(raw, threshold) {
  if (raw.op === "boolBatch") {
    const yes = raw.skills
      .filter((s) => s.value === true)
      .map((s, i) => ({ ...s, order: i }))
      .sort((l, r) => r.p - l.p);
    const passed = yes.filter((s) => s.p >= threshold);
    const picks = passed.slice(0, CAP);
    return { picks: picks.map((s) => s.name), passed: passed.length, top3Available: true };
  }
  // choice: gate() in domain/decision/provider.ts -> below the threshold is a fallback,
  // which in B'/C means nothing was injected.
  if (raw.confidence < threshold || raw.choice === NONE_LABEL) return { picks: [], passed: 0, top3Available: false };
  return { picks: [raw.choice], passed: 1, top3Available: false };
}

/** Threshold-free top-1 answer + its confidence, for Brier/ECE (PROTOCOL.md §5). */
function calibrationAnswer(raw) {
  if (raw.op === "boolBatch") {
    const best = raw.skills.reduce((a, b) => (b.p > a.p ? b : a));
    if (best.value === true) return { answer: best.name, confidence: best.p };
    return { answer: NONE_LABEL, confidence: 1 - best.p };
  }
  return { answer: raw.choice, confidence: raw.confidence };
}

function calibration(pairs, bins) {
  const width = 1 / bins;
  const table = Array.from({ length: bins }, (_, i) => ({
    lo: Number((i * width).toFixed(3)),
    hi: Number(((i + 1) * width).toFixed(3)),
    n: 0,
    sumConf: 0,
    sumCorrect: 0,
  }));
  let brier = 0;
  for (const { confidence, correct } of pairs) {
    brier += (confidence - (correct ? 1 : 0)) ** 2;
    const index = Math.min(bins - 1, Math.floor(confidence / width));
    const bin = table[index];
    bin.n += 1;
    bin.sumConf += confidence;
    bin.sumCorrect += correct ? 1 : 0;
  }
  const n = pairs.length;
  let ece = 0;
  for (const bin of table) {
    if (bin.n === 0) continue;
    bin.meanConf = Number((bin.sumConf / bin.n).toFixed(4));
    bin.accuracy = Number((bin.sumCorrect / bin.n).toFixed(4));
    ece += (bin.n / n) * Math.abs(bin.accuracy - bin.meanConf);
  }
  return { brier: n === 0 ? null : brier / n, ece: n === 0 ? null : ece, bins: table };
}

function scoreVariant(variant) {
  const path = join(RESULTS, `raw-${variant}.jsonl`);
  const raws = new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
      .map((r) => [r.id, r]),
  );
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const out = { variant, n: raws.size, thresholds: {}, strata: {} };

  const latencies = [...raws.values()].map((r) => r.latency_ms).sort((a, b) => a - b);
  out.latency = { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), min: latencies[0], max: latencies.at(-1) };

  const strataOf = (row) => ({
    label_source: row.label_source,
    difficulty: row.difficulty,
    harness: row.harness,
    stratum: row.stratum,
    label_is_none: effectiveLabel(row) === NONE_LABEL ? "none" : "skill",
  });

  for (const threshold of THRESHOLDS) {
    const cells = { top1: [0, 0], top3: [0, 0], fallback: [0, 0], noneCorrect: [0, 0] };
    const strata = {};
    let passedSum = 0;
    for (const [id, raw] of raws) {
      const row = byId.get(id);
      const label = effectiveLabel(row);
      const { picks, passed, top3Available } = answerAt(raw, threshold);
      passedSum += passed;
      const injected = picks.length > 0;
      const top1 = injected ? picks[0] === label : label === NONE_LABEL;
      const top3 = top3Available ? (injected ? picks.includes(label) : label === NONE_LABEL) : null;
      cells.top1[0] += top1 ? 1 : 0;
      cells.top1[1] += 1;
      if (top3 !== null) {
        cells.top3[0] += top3 ? 1 : 0;
        cells.top3[1] += 1;
      }
      cells.fallback[0] += injected ? 0 : 1;
      cells.fallback[1] += 1;
      if (label === NONE_LABEL) {
        cells.noneCorrect[0] += injected ? 0 : 1;
        cells.noneCorrect[1] += 1;
      }
      for (const [dim, value] of Object.entries(strataOf(row))) {
        const key = `${dim}=${value}`;
        strata[key] ??= { top1: [0, 0], top3: [0, 0] };
        strata[key].top1[0] += top1 ? 1 : 0;
        strata[key].top1[1] += 1;
        if (top3 !== null) {
          strata[key].top3[0] += top3 ? 1 : 0;
          strata[key].top3[1] += 1;
        }
      }
    }
    out.thresholds[threshold] = {
      top1: wilson(cells.top1[0], cells.top1[1]),
      top3: cells.top3[1] === 0 ? "UNDETERMINED (choice returns no distribution over the wire)" : wilson(cells.top3[0], cells.top3[1]),
      fallback_rate: wilson(cells.fallback[0], cells.fallback[1]),
      none_abstained: wilson(cells.noneCorrect[0], cells.noneCorrect[1]),
      mean_passed: passedSum / raws.size,
      strata: Object.fromEntries(
        Object.entries(strata).map(([key, v]) => [
          key,
          { top1: wilson(v.top1[0], v.top1[1]), top3: v.top3[1] === 0 ? "UNDETERMINED" : wilson(v.top3[0], v.top3[1]) },
        ]),
      ),
    };
  }

  // Calibration, threshold-free.
  const pairs = [];
  for (const [id, raw] of raws) {
    const row = byId.get(id);
    const { answer, confidence } = calibrationAnswer(raw);
    pairs.push({ confidence, correct: answer === effectiveLabel(row) });
  }
  out.calibration_10bin = calibration(pairs, 10);
  out.calibration_5bin = calibration(pairs, 5);

  // Agreement with the natural (native-open) labels, which are not model-assigned.
  const natural = allRows.filter((r) => r.label_source === "native-open");
  const naturalCells = {};
  for (const threshold of THRESHOLDS) {
    let hit1 = 0;
    let hit3 = 0;
    let have3 = 0;
    for (const row of natural) {
      const raw = raws.get(row.id);
      const { picks, top3Available } = answerAt(raw, threshold);
      // The natural label is the skill the model opened by itself: compared against `label`,
      // not the owner's verdict, because this metric is "the model's own choice".
      if (picks[0] === row.label) hit1 += 1;
      if (top3Available) {
        have3 += 1;
        if (picks.includes(row.label)) hit3 += 1;
      }
    }
    naturalCells[threshold] = {
      top1: wilson(hit1, natural.length),
      top3: have3 === 0 ? "UNDETERMINED" : wilson(hit3, have3),
    };
  }
  out.native_open_agreement = { n: natural.length, by_threshold: naturalCells };
  return out;
}

if (command === "score") {
  const variants = arg ? [arg] : Object.keys(VARIANTS);
  const all = {};
  for (const variant of variants) all[variant] = scoreVariant(variant);
  writeFileSync(join(RESULTS, "metrics.json"), JSON.stringify(all, null, 2));
  console.error(`scored ${variants.join(", ")} -> results/metrics.json`);
  process.exit(0);
}

if (command === "score-stability") {
  const variant = arg;
  const raws = readFileSync(join(RESULTS, `stability-${variant}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  const byId = new Map();
  for (const raw of raws) {
    byId.set(raw.id, [...(byId.get(raw.id) ?? []), raw]);
  }
  const perThreshold = {};
  for (const threshold of THRESHOLDS) {
    let flipped = 0;
    for (const [, runs] of byId) {
      const answers = runs.map((r) => answerAt(r, threshold).picks.join("|") || NONE_LABEL);
      if (new Set(answers).size > 1) flipped += 1;
    }
    perThreshold[threshold] = { flipped, cases: byId.size, flip_rate: flipped / byId.size };
  }
  // top-1 flips, threshold-free, plus max spread of the top-1 probability.
  let top1Flipped = 0;
  let maxSpread = 0;
  const spreads = [];
  for (const [, runs] of byId) {
    const answers = runs.map((r) => calibrationAnswer(r).answer);
    if (new Set(answers).size > 1) top1Flipped += 1;
    const confs = runs.map((r) => calibrationAnswer(r).confidence);
    const spread = Math.max(...confs) - Math.min(...confs);
    spreads.push(spread);
    maxSpread = Math.max(maxSpread, spread);
  }
  const sortedSpreads = [...spreads].sort((a, b) => a - b);
  const result = {
    variant,
    cases: byId.size,
    runs: Math.max(...[...byId.values()].map((r) => r.length)),
    top1_flip_rate: top1Flipped / byId.size,
    top1_flipped: top1Flipped,
    injected_set_flip_by_threshold: perThreshold,
    max_probability_spread: Number(maxSpread.toFixed(4)),
    median_probability_spread: Number(quantile(sortedSpreads, 0.5).toFixed(4)),
  };
  writeFileSync(join(RESULTS, `metrics-stability-${variant}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (command === "score-order-swap") {
  const variant = arg;
  const swapped = readFileSync(join(RESULTS, `order-swap-${variant}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  const base = new Map(
    readFileSync(join(RESULTS, `raw-${variant}.jsonl`), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
      .map((r) => [r.id, r]),
  );
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const out = { variant, n: swapped.length, by_threshold: {} };
  for (const threshold of THRESHOLDS) {
    let fwd = 0;
    let rev = 0;
    let disagree = 0;
    for (const raw of swapped) {
      const row = byId.get(raw.id);
      const label = effectiveLabel(row);
      const a = answerAt(base.get(raw.id), threshold);
      const b = answerAt(raw, threshold);
      const okA = a.picks.length > 0 ? a.picks[0] === label : label === NONE_LABEL;
      const okB = b.picks.length > 0 ? b.picks[0] === label : label === NONE_LABEL;
      fwd += okA ? 1 : 0;
      rev += okB ? 1 : 0;
      if (a.picks.join("|") !== b.picks.join("|")) disagree += 1;
    }
    out.by_threshold[threshold] = {
      forward_top1: wilson(fwd, swapped.length),
      reversed_top1: wilson(rev, swapped.length),
      gap_points: Number((((fwd - rev) / swapped.length) * 100).toFixed(2)),
      answer_disagreements: disagree,
    };
  }
  writeFileSync(join(RESULTS, `metrics-order-swap-${variant}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

console.error("usage: offline-eval.mjs <run|stability|order-swap|subset|score|score-stability|score-order-swap> [variant]");
process.exit(2);
