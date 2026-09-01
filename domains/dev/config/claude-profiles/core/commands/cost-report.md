---
description: Generate a local Claude Code cost report from the yoki cost-tracker metrics log.
argument-hint: [csv]
---

# Cost Report

Summarize local Claude Code spend by day, model, and session from the metrics
log that yoki's `stop:cost-tracker` hook writes.

## When to Use

- The user asks how much Claude Code cost today, yesterday, or in total
- You need spend broken down by model or across the last seven days
- Recent cost rows are needed as CSV for external analysis (`/cost-report csv`)

## Where the data lives

The tracker appends one JSON object per session-stop to
`~/.claude/metrics/costs.jsonl`. Each row is a **cumulative snapshot for that
session**, so the report takes the **latest row per `session_id`** and sums
across sessions (summing every row would multiply-count).

Row schema:
`{ timestamp, session_id, transcript_path, harness, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, estimated_cost_usd }`

`harness` is `claude`, `codex`, or `omp` (whichever ran the session — see
`YOKI_HARNESS` in the yoki hook runner); rows written before this field
existed have none and are treated as `claude`. `estimated_cost_usd` is `null`
(not `0`) for a codex/omp row whose model has no known per-token price yet in
`lib/cost-estimate.js` — those rows still count toward token totals but are
excluded from every dollar figure below, and the report says how many were
excluded rather than silently rendering them as free.

## What this command does

1. Check that `~/.claude/metrics/costs.jsonl` exists. If it does not, tell the
   user the tracker is not set up yet (it populates after the first session ends
   with the `stop:cost-tracker` hook enabled).
2. Reduce rows to the latest snapshot per session and aggregate.
3. Present a compact report, or export recent rows as CSV when the argument is `csv`.

`node` is used instead of `sqlite3`/`jq` so this works identically on macOS,
Linux, and Windows.

## Report

```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const f=path.join(os.homedir(),".claude","metrics","costs.jsonl");
if(!fs.existsSync(f)){console.log("Cost tracker not set up: "+f+" not found. Enable the stop:cost-tracker hook and finish a session first.");process.exit(0);}
const rows=fs.readFileSync(f,"utf8").split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const bySession=new Map();
for(const r of rows){const k=r.session_id||r.transcript_path||r.timestamp;const p=bySession.get(k);if(!p||String(r.timestamp)>String(p.timestamp))bySession.set(k,r);}
const latest=[...bySession.values()];
// null (not 0) means "unpriced model" (lib/cost-estimate.js has no entry for
// it yet) — excluded from every dollar figure below, counted separately.
const priced=r=>r.estimated_cost_usd!==null&&r.estimated_cost_usd!==undefined&&Number.isFinite(Number(r.estimated_cost_usd));
const cost=r=>priced(r)?Number(r.estimated_cost_usd):0;
const harness=r=>r.harness||"claude";
const day=r=>String(r.timestamp||"").slice(0,10);
const today=new Date().toISOString().slice(0,10);
const d=new Date(Date.now()-864e5).toISOString().slice(0,10);
const sum=a=>a.filter(priced).reduce((s,r)=>s+cost(r),0);
const f4=n=>"$"+n.toFixed(4);
const unpriced=latest.filter(r=>!priced(r));
console.log("=== Cost summary ===");
console.log("today:     "+f4(sum(latest.filter(r=>day(r)===today))));
console.log("yesterday: "+f4(sum(latest.filter(r=>day(r)===d))));
console.log("total:     "+f4(sum(latest))+"  ("+latest.length+" sessions)");
if(unpriced.length>0)console.log(unpriced.length+" session(s) excluded from dollar figures (unpriced model — see harness/model list below)");
const by=(key)=>{const m=new Map();for(const r of latest.filter(priced)){const k=key(r)||"(unknown)";m.set(k,(m.get(k)||0)+cost(r));}return [...m.entries()].sort((a,b)=>b[1]-a[1]);};
console.log("\n=== By harness ===");for(const [k,v] of by(harness))console.log(f4(v).padStart(12)+"  "+k);
console.log("\n=== By model ===");for(const [k,v] of by(r=>harness(r)+"/"+r.model))console.log(f4(v).padStart(12)+"  "+k);
if(unpriced.length>0){console.log("\n=== Unpriced (excluded above) ===");const um=new Map();for(const r of unpriced){const k=harness(r)+"/"+(r.model||"(unknown)");um.set(k,(um.get(k)||0)+1);}for(const [k,n] of um)console.log(n+"x  "+k);}
console.log("\n=== Last 7 days ===");
const days=new Map();for(const r of latest.filter(priced)){const k=day(r);days.set(k,(days.get(k)||0)+cost(r));}
[...days.entries()].sort((a,b)=>b[0]<a[0]?-1:1).slice(0,7).forEach(([k,v])=>console.log(k+"  "+f4(v)));
'
```

## CSV export (`/cost-report csv`)

```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const f=path.join(os.homedir(),".claude","metrics","costs.jsonl");
if(!fs.existsSync(f)){console.error("no data");process.exit(0);}
const rows=fs.readFileSync(f,"utf8").split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean).slice(-100);
console.log("timestamp,session_id,harness,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,estimated_cost_usd");
for(const r of rows)console.log([r.timestamp,r.session_id,r.harness||"claude",r.model,r.input_tokens,r.output_tokens,r.cache_write_tokens,r.cache_read_tokens,r.estimated_cost_usd].join(","));
'
```

## Report format

1. Summary: today, yesterday, total, session count, plus a count of sessions
   excluded from the dollar figures for having an unpriced model.
2. By harness: `claude`/`codex`/`omp` ranked by total cost.
3. By model: `harness/model` ranked by total cost.
4. Unpriced (only shown when non-empty): `harness/model` combos excluded
   above, with a count, so a codex/omp price gap in `lib/cost-estimate.js` is
   visible rather than silently reported as $0.
5. Last seven days: date and cost.

Rely on the precomputed `estimated_cost_usd` values written by the tracker; do
not re-estimate pricing from raw tokens here.
