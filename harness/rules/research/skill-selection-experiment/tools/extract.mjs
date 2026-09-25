// Build the labeled prompt set for the skill-selection experiment.
// Read-only over transcripts; writes only to the out dir given on argv.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const HOME = homedir();
const OUT = process.argv[2];
const DAYS = 90;
const since = new Date(Date.now() - DAYS * 86400_000);

// ---------- catalog ----------
const MERGED = join(HOME, ".claude/.skills-merged");
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const body = text.slice(3, end);
  const out = {};
  let key = null;
  for (const raw of body.split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(raw);
    if (m) { key = m[1]; out[key] = m[2] ?? ""; continue; }
    if (key && /^\s+\S/.test(raw)) out[key] = (out[key] + " " + raw.trim()).trim();
  }
  return out;
}
const catalog = [];
const excluded = [];
for (const name of readdirSync(MERGED).sort()) {
  const p = join(MERGED, name, "SKILL.md");
  if (!existsSync(p)) { excluded.push({ name, reason: "no SKILL.md" }); continue; }
  const text = readFileSync(p, "utf8");
  const fm = parseFrontmatter(text);
  const dmi = String(fm["disable-model-invocation"] ?? "").trim().toLowerCase() === "true";
  const desc = (fm.description ?? "").trim();
  const when = (fm["when_to_use"] ?? fm["when-to-use"] ?? "").trim();
  const entry = {
    name: fm.name?.trim() || name,
    dir: name,
    description: desc,
    when_to_use: when || undefined,
    description_sha256: createHash("sha256").update(desc + "\n" + when).digest("hex"),
    description_chars: desc.length + when.length,
    source: (() => { try { return realpathSync(join(MERGED, name)).replace(HOME, "~"); } catch { return null; } })(),
  };
  if (dmi) { excluded.push({ name, reason: "disable-model-invocation: true" }); continue; }
  catalog.push(entry);
}
const known = new Set(catalog.map((c) => c.dir));

// ---------- prompt origin (mirrors jig src/domain/skills/prompt-origin.ts) ----------
const SIGNATURES = [
  ["hook-event", "[MESSAGE FROM NON-USER SOURCE"],
  ["compaction", "Below is a conversation log"],
  ["task-notification", "<task-notification>"],
  ["session-resume", "This session is being continued"],
  ["agent-message", "Another Claude session sent a message"],
  ["agent-message", "[Subagent hand-back]"],
  ["skill-body", "Base directory for this skill:"],
];
function classifyOrigin(prompt, agentType, agentId) {
  const present = (v) => typeof v === "string" && v.trim() !== "";
  if (present(agentType) || present(agentId)) return "subagent";
  const t = prompt.replace(/^\s+/, "");
  for (const [reason, prefix] of SIGNATURES) if (t.startsWith(prefix)) return reason;
  return null;
}

// ---------- transcript parsing (mirrors jig src/infra/transcripts/transcript.ts) ----------
const REMINDER_LIST_NAMES = /^- "([^"]+)": /gm;
const REMINDER_LIST_CONFIDENCE = /judgment confidence ([0-9., ]+)\)/;
const REMINDER_SINGLE = /matches the "([^"]+)" skill \(judgment confidence ([0-9.]+)\)/;
const SKILL_DIRS = new Set(["skills", ".skills-merged"]);
function skillNameFromPath(path) {
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!SKILL_DIRS.has(parts[i])) continue;
    const name = parts[i + 1];
    if (!name || parts[i + 2] === undefined) continue;
    return name;
  }
  if (parts.at(-1) === "SKILL.md") return parts.at(-2);
  return undefined;
}
const asRec = (v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined);
function harnessOf(e) {
  if (e.type === "attachment" || "parentUuid" in e) return "claude";
  if ("parentId" in e || e.type === "message" || e.type === "custom_message") return "pi";
  return "unknown";
}
function promptTextOf(e, harness) {
  const m = asRec(e.message);
  if (!m || m.role !== "user") return undefined;
  if (harness !== "unknown") {
    const carrier = harness === "pi" ? "message" : "user";
    if (e.type !== carrier) return undefined;
  }
  const c = m.content;
  if (typeof c === "string") return c.trim() === "" ? undefined : c;
  if (!Array.isArray(c) || c.length === 0) return undefined;
  if (!c.every((p) => asRec(p)?.type === "text")) return undefined;
  const joined = c.map((p) => p.text ?? "").join("\n");
  return joined.trim() === "" ? undefined : joined;
}
function injectionOf(e, harness) {
  let text;
  if (harness === "claude" && e.type === "attachment") {
    const a = asRec(e.attachment);
    if (a?.type === "hook_additional_context" && Array.isArray(a.content)) {
      text = a.content.filter((x) => typeof x === "string").join("\n");
    }
  }
  if (harness === "pi" && e.type === "custom_message" && e.customType === "jig-skill-router") {
    text = typeof e.content === "string" ? e.content : undefined;
  }
  if (text === undefined) return undefined;
  const skills = [...text.matchAll(REMINDER_LIST_NAMES)].map((m) => m[1] ?? "");
  if (skills.length > 0) {
    const rep = REMINDER_LIST_CONFIDENCE.exec(text)?.[1] ?? "";
    const top = Number.parseFloat((rep.split(",")[0] ?? "").trim());
    return { skills, confidence: Number.isFinite(top) ? top : undefined };
  }
  const s = REMINDER_SINGLE.exec(text);
  if (!s?.[1]) return undefined;
  const conf = Number.parseFloat(s[2] ?? "");
  return { skills: [s[1]], confidence: Number.isFinite(conf) ? conf : undefined };
}
function readPathsOf(e, harness) {
  const m = asRec(e.message);
  const c = m?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const part of c) {
    const call = asRec(part);
    if (!call) continue;
    if (harness === "claude" && e.type === "assistant" && call.type === "tool_use") {
      if (call.name !== "Read") continue;
      const i = asRec(call.input);
      if (typeof i?.file_path === "string") out.push(i.file_path);
    }
    if (harness === "pi" && m?.role === "assistant" && call.type === "toolCall") {
      if (call.name !== "read") continue;
      const a = asRec(call.arguments);
      if (typeof a?.path === "string") out.push(a.path);
    }
  }
  return out;
}
function skillCallsOf(e, harness) {
  if (harness !== "claude" || e.type !== "assistant") return [];
  const c = asRec(e.message)?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const part of c) {
    const call = asRec(part);
    if (!call || call.type !== "tool_use" || call.name !== "Skill") continue;
    const i = asRec(call.input);
    if (typeof i?.skill === "string" && i.skill !== "") out.push(i.skill);
  }
  return out;
}
// any tool call touching a file path -> extension signal for the session
const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
function filePathsOf(e, harness) {
  const m = asRec(e.message);
  const c = m?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const part of c) {
    const call = asRec(part);
    if (!call) continue;
    const input = asRec(call.input) ?? asRec(call.arguments);
    if (!input) continue;
    for (const k of ["file_path", "path", "notebook_path"]) {
      if (typeof input[k] === "string") out.push(input[k]);
    }
  }
  return out;
}

function walk(dir, depth, acc) {
  if (depth > 8) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const en of entries) {
    const p = join(dir, en.name);
    if (en.isDirectory()) { walk(p, depth + 1, acc); continue; }
    if (!en.name.endsWith(".jsonl")) continue;
    try { if (statSync(p).mtime >= since) acc.push(p); } catch {}
  }
}
const files = [];
walk(join(HOME, ".claude/projects"), 0, files);
const piRoot = join(HOME, ".pi/agent/sessions");
if (existsSync(piRoot)) walk(piRoot, 0, files);

const turns = [];
let totalTurns = 0;
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  let cur;
  const sessionExts = new Map();
  let sessionCwd;
  const flush = () => { if (cur) { turns.push(cur); cur = undefined; } };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    const harness = harnessOf(e);
    const sidechain = e.isSidechain === true;
    if (typeof e.cwd === "string" && e.cwd) sessionCwd = e.cwd;
    for (const fp of filePathsOf(e, harness)) {
      const m = EXT_RE.exec(fp);
      if (m) sessionExts.set(m[1].toLowerCase(), (sessionExts.get(m[1].toLowerCase()) ?? 0) + 1);
    }
    const inj = injectionOf(e, harness);
    const paths = readPathsOf(e, harness);
    const invoked = skillCallsOf(e, harness);
    const ptext = sidechain ? undefined : promptTextOf(e, harness);
    if (ptext !== undefined) {
      totalTurns++;
      flush();
      cur = {
        file, session: basename(file), harness, at: typeof e.timestamp === "string" ? e.timestamp : "",
        prompt: ptext, agentType: e.agent_type ?? e.agentType, agentId: e.agent_id ?? e.agentId,
        injected: [], confidence: undefined, read: [], skilled: [],
        cwd: sessionCwd, exts: sessionExts,
      };
    }
    if (!cur) continue;
    if (inj) { cur.injected = inj.skills; cur.confidence = inj.confidence; }
    for (const p of paths) {
      const n = skillNameFromPath(p);
      if (!n || !known.has(n) || cur.read.includes(n)) continue;
      cur.read.push(n);
    }
    for (const n of invoked) {
      if (!known.has(n) || cur.skilled.includes(n)) continue;
      cur.skilled.push(n);
    }
  }
  flush();
}

// ---------- filter to human prompts ----------
const originCounts = {};
const human = [];
for (const t of turns) {
  const reason = classifyOrigin(t.prompt, t.agentType, t.agentId);
  originCounts[reason ?? "human"] = (originCounts[reason ?? "human"] ?? 0) + 1;
  if (reason === null) human.push(t);
}

// ---------- stratify ----------
function opened(t) { return [...t.read, ...t.skilled.filter((s) => !t.read.includes(s))]; }
const strata = { unscouted: [], followed: [], ignored: [], none: [], other: [] };
for (const t of human) {
  const op = opened(t);
  if (t.injected.length === 0 && op.length > 0) strata.unscouted.push(t);
  else if (t.injected.length > 0 && t.injected.every((s) => op.includes(s))) strata.followed.push(t);
  else if (t.injected.length > 0) strata.ignored.push(t);
  else strata.none.push(t);
}

// diagnostic: unscouted over ALL turns (any origin), and within the last 30 days
const d30 = new Date(Date.now() - 30 * 86400_000).toISOString();
const diag = { all_unscouted: 0, all_unscouted_30d: 0, human_unscouted_30d: 0, all_injected: 0, all_injected_30d: 0 };
for (const t of turns) {
  const op = opened(t);
  const recent = t.at >= d30;
  if (t.injected.length === 0 && op.length > 0) {
    diag.all_unscouted++;
    if (recent) diag.all_unscouted_30d++;
    if (recent && classifyOrigin(t.prompt, t.agentType, t.agentId) === null) diag.human_unscouted_30d++;
  }
  if (t.injected.length > 0) { diag.all_injected++; if (recent) diag.all_injected_30d++; }
}

const summary = {
  days: DAYS, files: files.length, prompts_total: totalTurns, diag,
  origin: originCounts,
  human: human.length,
  strata: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, v.length])),
  by_harness: human.reduce((a, t) => ((a[t.harness] = (a[t.harness] ?? 0) + 1), a), {}),
  catalog: catalog.length, excluded,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "_summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, "_catalog.json"), JSON.stringify(catalog, null, 2));

// dump strata raw for the next stage
function dump(name, arr) {
  writeFileSync(join(OUT, `_${name}.jsonl`), arr.map((t) => JSON.stringify({
    at: t.at, harness: t.harness, session: t.session, cwd: t.cwd,
    injected: t.injected, confidence: t.confidence, read: t.read, skilled: t.skilled,
    exts: Object.fromEntries([...t.exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    prompt: t.prompt,
  })).join("\n") + "\n");
}
for (const [k, v] of Object.entries(strata)) dump(k, v);
console.log(JSON.stringify(summary, null, 2));
