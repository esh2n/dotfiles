export const meta = {
  name: 'go-optimize',
  description: 'Evidence-gated Go performance optimization: pprof hot-spot ID, parallel worktree proposals across distinct angles, statistical + mechanism gating via benchstat/pprof diff, adversarial verify, draft-by-default delivery',
  whenToUse: 'A Go package has a benchmark (or needs one) and you want measured, gated optimization proposals instead of a single unverified "this should be faster" edit',
  phases: [
    { title: 'Resolve', detail: 'go.mod floor + go env GOVERSION, list benchmarks; no bench -> propose one and stop' },
    { title: 'Profile', detail: 'baseline bench + cpu/mem pprof, hot spots with hypotheses' },
    { title: 'Propose', detail: 'parallel worktree candidates, one per angle, correctness-gated' },
    { title: 'Gate', detail: 'benchstat p<0.05 & improvement>=threshold, then pprof-diff mechanism check' },
    { title: 'Verify', detail: 'adversarial: worth the readability cost? really on the hot path?' },
    { title: 'Deliver', detail: 'draft report by default; commit/pr only when explicitly requested' },
  ],
}

// args: { pkg: string (required — import path or dir, e.g. "./internal/codec" or "./..."),
//         bench?: string (regex passed to `go test -bench`; narrows which existing
//                 benchmark(s) to target — it does NOT authorize writing a new one),
//         threshold?: number (percent improvement required, default 5),
//         budget?: { maxProposals?: number (default 4), maxRounds?: number (default 1) },
//         delivery?: 'draft' | 'commit' | 'pr' (default 'draft'), runId?: string }
//
// Contract: workflows may only commit/open a PR when the CALLER explicitly chose
// that delivery mode at launch (global rule) — this workflow never asks mid-run,
// and an unrecognized delivery value falls back to 'draft', never to 'commit'/'pr'.
//
// Model tiers: Resolve -> haiku + low (mechanical: go.mod/env/-list). Profile,
// Propose, Deliver -> MODEL (sonnet default; the finder/execution tier — Propose
// additionally runs isolated per-worktree so a bad edit can't collide with
// another proposal's). Gate -> haiku + low: it runs benchstat/pprof-diff and
// applies the threshold arithmetic in code-adjacent fashion (deterministic
// commands, mechanical parsing) — a single call across all candidates, not one
// per candidate, to keep the agent budget flat as maxProposals grows. Verify ->
// session model (no override) + high effort, one fresh call per Gate-accepted
// candidate: the judgment stage never rides the finder tier.
//
// No Date.now()/Math.random() in this script (Workflow runtime restriction):
// the run id is taken from args.runId, defaulting to the literal 'latest'
// (repeat runs without an explicit runId overwrite the same scratch dir —
// pass runId to keep multiple runs side by side).
let A = args
if (typeof A === 'string') {
  try {
    const parsed = JSON.parse(A)
    A = (parsed && typeof parsed === 'object') ? parsed : { pkg: A }
  } catch {
    A = { pkg: A } // bare string args -> treat as pkg, per this workflow's contract
  }
}
const PKG = (A && A.pkg) || ''
const BENCH = (A && A.bench) || ''
const THRESHOLD = (A && typeof A.threshold === 'number' && A.threshold > 0) ? A.threshold : 5
const BUDGET_RAW = (A && A.budget && typeof A.budget === 'object') ? A.budget : {}
const BUDGET = {
  maxProposals: (typeof BUDGET_RAW.maxProposals === 'number' && BUDGET_RAW.maxProposals > 0) ? Math.floor(BUDGET_RAW.maxProposals) : 4,
  maxRounds: (typeof BUDGET_RAW.maxRounds === 'number' && BUDGET_RAW.maxRounds > 0) ? Math.floor(BUDGET_RAW.maxRounds) : 1,
}
const DELIVERY_MODES = ['draft', 'commit', 'pr']
const DELIVERY_RAW = (A && A.delivery) || 'draft'
const DELIVERY = DELIVERY_MODES.includes(DELIVERY_RAW) ? DELIVERY_RAW : 'draft'
if (DELIVERY_RAW !== DELIVERY) log(`unknown delivery "${DELIVERY_RAW}" — falling back to "draft" (no commit)`)
const RUN_ID = (A && A.runId) || 'latest'
const MODEL = (A && A.model) || 'sonnet'

if (!PKG) { log('go-optimize requires args.pkg (import path or dir)'); return { error: 'no pkg' } }
log(`resolved args: pkg=${PKG} bench=${BENCH || '(none — auto-pick)'} threshold=${THRESHOLD}% budget=${JSON.stringify(BUDGET)} delivery=${DELIVERY} runId=${RUN_ID}`)

phase('Resolve')

const RESOLVE_SCHEMA = {
  type: 'object',
  required: ['repoRoot', 'scratchDir', 'goVersionFloor', 'goEnvVersion', 'pkgTarget', 'benchmarks'],
  properties: {
    repoRoot: { type: 'string', description: 'absolute path from `git rev-parse --show-toplevel`' },
    scratchDir: { type: 'string', description: 'absolute path to <repoRoot>/.claude/.cache/go-optimize/<runId>, created if missing' },
    goVersionFloor: { type: 'string', description: 'the `go` (and `toolchain` if present) directive from go.mod' },
    goEnvVersion: { type: 'string', description: 'output of `go env GOVERSION`' },
    pkgTarget: { type: 'string', description: 'the resolved go test package pattern for args.pkg (e.g. "./internal/codec")' },
    benchmarks: { type: 'array', items: { type: 'string' }, description: 'ALL benchmark function names from `go test -list \'Benchmark.*\'` on pkgTarget, unfiltered by args.bench' },
  },
}

const resolved = await agent(
  `Resolve the target for a Go performance-optimization run. Do NOT change any files.
1. Find the repo root: git rev-parse --show-toplevel.
2. Create the scratch dir: mkdir -p "<repoRoot>/.claude/.cache/go-optimize/${RUN_ID}" and return its absolute path.
3. Read go.mod at the repo root (or the nearest one above args.pkg if this is a multi-module repo) and extract the \`go\` directive and \`toolchain\` directive if present.
4. Run: go env GOVERSION
5. Resolve args.pkg="${PKG}" to a valid go test package pattern (it may already be one, e.g. "./internal/codec" or "./...", or a bare import path — normalize to the form \`go test\` accepts from the repo root).
6. List ALL benchmarks in that package: go test -list 'Benchmark.*' <resolved pkg pattern>. Return the benchmark function names only (drop the trailing "ok  ..." summary line and any "no test files" noise). An empty result is valid and expected when the package has no benchmarks — return an empty array, do not error.
Return via StructuredOutput.`,
  { label: 'resolve', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'haiku', effort: 'low' },
)

if (!resolved || !resolved.scratchDir || !resolved.pkgTarget) {
  log('could not resolve pkg/scratch dir — aborting')
  return { error: 'resolve failed' }
}
log(`repo=${resolved.repoRoot} pkg=${resolved.pkgTarget} go.mod floor=${resolved.goVersionFloor} go env=${resolved.goEnvVersion} benchmarks found=${(resolved.benchmarks || []).length}`)

const allBenchmarks = resolved.benchmarks || []
let targetBenchPattern = ''
let benchSelectionNote = ''
if (!allBenchmarks.length) {
  benchSelectionNote = 'package has no benchmarks at all'
} else if (BENCH) {
  let re = null
  try { re = new RegExp(BENCH) } catch { log(`args.bench "${BENCH}" is not a valid regex — treating as no match`) }
  const matches = re ? allBenchmarks.filter((b) => re.test(b)) : []
  if (!matches.length) benchSelectionNote = `no existing benchmark matches args.bench "${BENCH}"`
  else targetBenchPattern = BENCH
} else {
  // No bench given: target the first listed benchmark exactly, so Profile/Gate/
  // Verify all reason about a single, tractable target instead of "whatever ran".
  targetBenchPattern = `^${allBenchmarks[0]}$`
  log(`args.bench not given — auto-picked ${allBenchmarks[0]} (pass bench to target a different one)`)
}

// Per the decision record: no bench (or none matching) -> write ONE proposal for
// a benchmark, do not implement it, return early. This is the workflow's only
// early exit short of a hard resolve failure.
if (!targetBenchPattern) {
  log(`no target benchmark (${benchSelectionNote}) — proposing a benchmark instead of optimizing`)
  const PROPOSAL_SCHEMA = {
    type: 'object', required: ['proposalPath', 'proposal'],
    properties: {
      proposalPath: { type: 'string' },
      proposal: { type: 'string', description: 'markdown: what to benchmark, a sketch of the Benchmark func signature and setup, and why it is worth measuring — no implementation' },
    },
  }
  const proposal = await agent(
    `This Go package (${resolved.pkgTarget}) has no benchmark ${BENCH ? `matching "${BENCH}"` : ''} to optimize (${benchSelectionNote}). Read the package's exported/hot-path functions and write ONE concrete proposal for a benchmark worth adding — do NOT write or edit any code, this is a proposal only.
Cover: which function/path to benchmark and why it plausibly matters (called in a loop, on a request path, allocates, etc.), a sketch of the Benchmark* function (signature, b.N/b.Loop() usage, setup outside the timed loop), and what -benchmem would reveal.
Save the proposal as markdown to "${resolved.scratchDir}/no-benchmark-proposal.md" (create the dir if needed — it should already exist) and return its path plus the proposal text.`,
    { label: 'propose-benchmark', phase: 'Resolve', schema: PROPOSAL_SCHEMA, model: MODEL },
  )
  log(`wrote benchmark proposal: ${(proposal && proposal.proposalPath) || '(not written)'}`)
  return {
    status: 'no-benchmark',
    pkg: resolved.pkgTarget,
    reason: benchSelectionNote,
    proposalPath: (proposal && proposal.proposalPath) || '',
    proposal: (proposal && proposal.proposal) || '',
  }
}

phase('Profile')

const PROFILE_SCHEMA = {
  type: 'object',
  required: ['baselineFile', 'cpuProfile', 'memProfile', 'hotspots'],
  properties: {
    baselineFile: { type: 'string', description: 'absolute path to the saved `go test -bench` text output' },
    cpuProfile: { type: 'string', description: 'absolute path to cpu_base.out' },
    memProfile: { type: 'string', description: 'absolute path to mem_base.out' },
    hotspots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['function', 'kind', 'flatPercent', 'cumPercent', 'hypothesis'],
        properties: {
          function: { type: 'string' },
          file: { type: 'string', description: 'file:line from pprof -list or -top, when resolvable' },
          kind: { type: 'string', enum: ['cpu', 'alloc_space'] },
          flatPercent: { type: 'number' },
          cumPercent: { type: 'number' },
          hypothesis: { type: 'string', description: 'why this shows up here — the concrete mechanism, not just "it is slow"' },
        },
      },
    },
  },
}

const profile = await agent(
  `Run a baseline benchmark with CPU and memory profiling for a Go performance-optimization run. Do NOT change any files.
Package: ${resolved.pkgTarget}
Target bench pattern: ${targetBenchPattern}
Scratch dir (already exists): ${resolved.scratchDir}

1. From ${resolved.repoRoot}, run:
   go test -run ^$ -bench '${targetBenchPattern}' -benchmem -count=10 -cpuprofile "${resolved.scratchDir}/cpu_base.out" -memprofile "${resolved.scratchDir}/mem_base.out" ${resolved.pkgTarget} > "${resolved.scratchDir}/baseline.txt" 2>&1
   Read the resulting baseline.txt to confirm it actually contains benchmark result lines (not just a build error) before continuing.
2. go tool pprof -top "${resolved.scratchDir}/cpu_base.out" — identify the top CPU hot spots (flat%/cum%, function, file:line via -list <func> if needed).
3. go tool pprof -top -alloc_space "${resolved.scratchDir}/mem_base.out" — identify the top allocation hot spots.
4. For each hot spot worth pursuing (do not list everything — pick the handful that plausibly explain most of the cost), write a concrete hypothesis of the MECHANISM (e.g. "map lookup + allocation per iteration in encode()", not "encode is slow").
Return via StructuredOutput: baselineFile/cpuProfile/memProfile as the absolute paths above, plus hotspots.`,
  { label: 'profile', phase: 'Profile', schema: PROFILE_SCHEMA, model: MODEL },
)

if (!profile || !profile.baselineFile || !(profile.hotspots || []).length) {
  log('profiling produced no usable baseline/hotspots — aborting')
  return { error: 'profile failed', profile }
}
log(`baseline saved: ${profile.baselineFile} — ${profile.hotspots.length} hotspot(s) identified`)

phase('Propose')

const ANGLES = [
  { key: 'allocation', focus: 'Reduce heap allocations / GC pressure on the hot path (avoid unnecessary escapes to heap, reuse buffers, sync.Pool where it genuinely fits, cut interface boxing) without changing observable behavior.' },
  { key: 'algorithmic', focus: 'Replace the underlying algorithm or data structure on the hot path with one of better asymptotic or constant-factor cost, without changing observable behavior.' },
  { key: 'concurrency-contention', focus: 'Reduce lock/goroutine contention on the hot path (finer-grained locking, atomic instead of mutex where the correctness case for it holds, sharding, batching, fewer channel handoffs) without changing observable behavior or introducing races.' },
  { key: 'runtime-knob', focus: 'Tune a runtime knob relevant to this workload (GOGC, GOMEMLIMIT, or PGO via a committed default.pgo built from this benchmark\'s profile) without changing the code\'s logic.' },
]
const angles = ANGLES.slice(0, BUDGET.maxProposals)
if (BUDGET.maxProposals > ANGLES.length) log(`budget.maxProposals=${BUDGET.maxProposals} exceeds the ${ANGLES.length} canonical angles — capping at ${ANGLES.length}`)

const PROPOSE_SCHEMA = {
  type: 'object',
  required: ['angle', 'summary', 'files', 'correctnessOk'],
  properties: {
    angle: { type: 'string' },
    summary: { type: 'string' },
    diff: { type: 'string', description: 'unified diff of the change (git diff output); empty if correctnessOk=false' },
    files: { type: 'array', items: { type: 'string' } },
    correctnessOk: { type: 'boolean', description: 'true only if build+vet+`go test -race` passed; if false the change was reverted' },
    failureReason: { type: 'string', description: 'set when correctnessOk=false' },
    benchOutputFile: { type: 'string', description: 'absolute path to this candidate\'s bench text output; set only when correctnessOk=true' },
    cpuProfileFile: { type: 'string', description: 'absolute path to this candidate\'s cpu profile; set only when correctnessOk=true' },
    worktreePath: { type: 'string' },
  },
}

const proposePrompt = (a) => `You are one of several parallel, isolated proposals for optimizing a Go benchmark. You are the "${a.key}" angle — stay on it; do not also try the other angles.
Angle focus: ${a.focus}

Package: ${resolved.pkgTarget}
Target bench: ${targetBenchPattern}
Baseline: ${profile.baselineFile}
Hot spots + hypotheses (JSON): ${JSON.stringify(profile.hotspots)}

Steps:
1. You are in a fresh git worktree. Read the relevant code first; follow the package's existing style — no drive-by refactors outside what your angle requires.
2. Apply EXACTLY ONE change implementing your angle, targeting one or more of the listed hot spots. Keep the change minimal and reviewable.
3. Correctness gate (MANDATORY, in this order): go build ./... ; go vet ./... ; go test -race -count=1 ${resolved.pkgTarget}
   - If ANY of these fail: revert your change (git checkout -- . / git restore .) so the worktree is left clean, set correctnessOk=false with a concrete failureReason (the actual error), and STOP — do not run the benchmark.
4. Only if the correctness gate passed: re-run the SAME benchmark with the SAME parameters as baseline, writing output OUTSIDE this worktree so it survives worktree cleanup:
   go test -run ^$ -bench '${targetBenchPattern}' -benchmem -count=10 -cpuprofile "${resolved.scratchDir}/candidates/${a.key}/cpu_cand.out" ${resolved.pkgTarget} > "${resolved.scratchDir}/candidates/${a.key}/candidate.txt" 2>&1
   (mkdir -p "${resolved.scratchDir}/candidates/${a.key}" first)
5. Capture your change as a unified diff: git diff --no-color (do NOT commit).
Return via StructuredOutput: angle="${a.key}", summary, files, correctnessOk, and on success diff/benchOutputFile/cpuProfileFile/worktreePath.`

const proposals = await parallel(angles.map((a) => () =>
  agent(proposePrompt(a), {
    label: `propose:${a.key}`, phase: 'Propose', schema: PROPOSE_SCHEMA, model: MODEL, isolation: 'worktree',
  }),
))

const validProposals = proposals.filter(Boolean)
for (const p of validProposals) {
  if (!p.correctnessOk) log(`propose:${p.angle} rejected at correctness gate — ${p.failureReason || '(no reason given)'}`)
}
const candidates = validProposals.filter((p) => p.correctnessOk)
log(`${candidates.length}/${validProposals.length} proposal(s) passed the correctness gate`)

phase('Gate')

let gateResults = []
if (candidates.length) {
  const GATE_SCHEMA = {
    type: 'object', required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['angle', 'statsOk', 'accepted', 'evidence'],
          properties: {
            angle: { type: 'string' },
            statsOk: { type: 'boolean', description: 'true if benchstat produced a parseable delta/p for the target bench' },
            deltaPercent: { type: 'number', description: 'benchstat percent delta for the target bench (negative = faster/less)' },
            pValue: { type: 'number' },
            mechanismConfirmed: { type: 'boolean', description: 'true if the candidate\'s hypothesized function(s) show a negative delta in the cpu pprof diff' },
            accepted: { type: 'boolean', description: 'true only if statsOk && pValue<0.05 && improvement>=threshold && mechanismConfirmed' },
            evidence: { type: 'string', description: 'the benchstat line(s) plus the relevant pprof -diff_base excerpt' },
            rejectReason: { type: 'string' },
          },
        },
      },
    },
  }
  const gate = await agent(
    `Statistically and mechanistically gate ${candidates.length} candidate optimization(s) against a baseline. Do NOT change any files.
Baseline: ${profile.baselineFile} (bench text), ${profile.cpuProfile} (cpu profile)
Threshold: candidate must improve the target bench by >= ${THRESHOLD}% with p < 0.05, AND the hypothesized function(s) must show a negative delta in a cpu pprof diff.
Target bench pattern: ${targetBenchPattern}

Candidates (JSON, each has angle/benchOutputFile/cpuProfileFile/hypothesis via the profile hotspots): ${JSON.stringify(candidates.map((c) => ({ angle: c.angle, benchOutputFile: c.benchOutputFile, cpuProfileFile: c.cpuProfileFile, summary: c.summary })))}
Hot spot hypotheses from baseline profiling (JSON): ${JSON.stringify(profile.hotspots)}

For EACH candidate:
1. Run: go run golang.org/x/perf/cmd/benchstat@latest ${profile.baselineFile} <candidate.benchOutputFile>
   Parse the delta% and p-value for the line matching the target bench (benchstat prints e.g. "p=0.000 n=10" for a significant result and "~" when there is no statistically significant difference — treat "~" as NOT passing the p<0.05 bar). If the output can't be parsed for this bench, set statsOk=false and rejectReason accordingly.
2. If statsOk and the improvement meets the threshold with p<0.05: run go tool pprof -top -diff_base=${profile.cpuProfile} <candidate.cpuProfileFile> and check whether the function(s) named in that candidate's relevant hypothesis (match by angle/summary against the hot spot hypotheses above) appear with a negative delta (i.e. cost went down in the candidate). Set mechanismConfirmed accordingly.
3. accepted = statsOk && pValue<0.05 && |deltaPercent| >= ${THRESHOLD} (in the improving direction) && mechanismConfirmed. When accepted=false, set a concrete rejectReason (e.g. "p=0.34 not significant", "delta -3.1% below 5% threshold", "mechanism not confirmed: hypothesized function still at same flat% in diff").
Return via StructuredOutput: one result per candidate, same angle keys as given.`,
    { label: 'gate', phase: 'Gate', schema: GATE_SCHEMA, model: 'haiku', effort: 'low' },
  )
  gateResults = (gate && gate.results) || []
}
for (const r of gateResults) {
  if (!r.accepted) log(`gate:${r.angle} rejected — ${r.rejectReason || 'did not meet statistical/mechanism bar'}`)
}
const gateAccepted = candidates
  .map((c) => ({ ...c, gate: gateResults.find((r) => r.angle === c.angle) }))
  .filter((c) => c.gate && c.gate.accepted)
log(`${gateAccepted.length}/${candidates.length} candidate(s) passed the statistical + mechanism gate`)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object', required: ['accept', 'reason'],
  properties: { accept: { type: 'boolean' }, reason: { type: 'string' } },
}
const verified = await parallel(gateAccepted.map((c) => () =>
  agent(
    `Adversarially verify this Go performance change in MEASURE mode. It already passed correctness (-race, tests) and a statistical + mechanism gate (benchstat p<0.05, improvement >= ${THRESHOLD}%, hypothesized function confirmed in a pprof diff). Your job is to try hard to REFUTE that it is worth shipping — default to accept=false when uncertain.
Angle: ${c.angle}
Summary: ${c.summary}
Diff:
${String(c.diff || '').slice(0, 12000)}
Gate evidence: ${c.gate.evidence}

Argue against acceptance on any of: is this genuinely on a hot path for real workloads, or just an artifact of the microbenchmark's shape? Is the readability/complexity cost proportionate to the measured gain? Does it rely on a runtime knob or behavior that will not hold across environments (GOGC/GOMEMLIMIT tuned to this machine, PGO profile staleness)? Could -race have missed a concurrency issue this change introduces? Accept only if none of these hold.`,
    // Judgment stage: session model (no override), high effort, fresh go-perf-reviewer
    // context in measure mode — matching go-perf-reviewer's evidence-chain contract.
    { label: `verify:${c.angle}`, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'go-perf-reviewer', effort: 'high' },
  ).then((v) => ({ ...c, verify: v })),
))

for (const v of verified) {
  if (!v.verify || !v.verify.accept) log(`verify:${v.angle} rejected — ${(v.verify && v.verify.reason) || 'no verdict returned'}`)
}
const accepted = verified.filter((v) => v.verify && v.verify.accept)
log(`${accepted.length}/${gateAccepted.length} candidate(s) accepted after adversarial verify`)

phase('Deliver')

const rejected = [
  ...validProposals.filter((p) => !p.correctnessOk).map((p) => ({ angle: p.angle, phase: 'Propose', reason: p.failureReason || '(no reason given)' })),
  ...gateResults.filter((r) => !r.accepted).map((r) => ({ angle: r.angle, phase: 'Gate', reason: r.rejectReason || 'did not meet statistical/mechanism bar' })),
  ...verified.filter((v) => !(v.verify && v.verify.accept)).map((v) => ({ angle: v.angle, phase: 'Verify', reason: (v.verify && v.verify.reason) || 'no verdict returned' })),
]

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const pkgSlug = slugify(resolved.pkgTarget).slice(0, 40) || 'pkg'
const branch = `perf/${pkgSlug}`

const DELIVER_SCHEMA = {
  type: 'object', required: ['reportPath', 'rejectedPath'],
  properties: {
    reportPath: { type: 'string' },
    rejectedPath: { type: 'string' },
    branch: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    pr_url: { type: 'string' },
  },
}

const acceptedSummary = accepted.map((c) => (
  `### ${c.angle}\n${c.summary}\n\nGate evidence: ${c.gate.evidence}\n\nVerify: accepted — ${c.verify.reason}\n\nFiles: ${(c.files || []).join(', ')}\n\n\`\`\`diff\n${String(c.diff || '').slice(0, 8000)}\n\`\`\`\n`
)).join('\n')
const rejectedSummary = rejected.map((r) => `- [${r.phase}] ${r.angle}: ${r.reason}`).join('\n') || '(none rejected)'

const deliverSteps = []
deliverSteps.push(`Write "${resolved.scratchDir}/report.md": a report titled for package ${resolved.pkgTarget}, target bench ${targetBenchPattern}, threshold ${THRESHOLD}%. Include, per accepted candidate, its summary, benchstat/pprof-diff evidence, verifier reason, files touched, and the unified diff in a fenced code block. Then a "Rejected" section listing every rejected candidate with its phase and reason. Content to use verbatim for the accepted section:\n${acceptedSummary || '(no candidates were accepted)'}\nRejected section content:\n${rejectedSummary}`)
deliverSteps.push(`Write "${resolved.scratchDir}/rejected.md": just the rejected list with reasons, one per line, grouped by phase (Propose/Gate/Verify). Content:\n${rejectedSummary}`)

if (DELIVERY !== 'draft' && accepted.length > 0) {
  deliverSteps.push(`Create a new branch "${branch}" from the current HEAD at ${resolved.repoRoot} and switch to it.`)
  deliverSteps.push(`For each accepted candidate below, apply its unified diff (git apply) on top of the branch and create ONE commit per candidate. Conventional commit message: perf(${pkgSlug.split('-').pop()}): <short subject>, English, ONE line, <=50 chars total, no AI/assistant/Claude trailers, no company-internal words. If a diff fails to apply cleanly, skip that candidate, report why, and continue with the others — do not abort the whole delivery.\nAccepted candidates (angle | summary | diff is embedded above in the report, re-derive the diff text from this JSON): ${JSON.stringify(accepted.map((c) => ({ angle: c.angle, summary: c.summary, diff: c.diff })))}`)
  if (DELIVERY === 'pr') {
    deliverSteps.push(`Push the branch: git push -u origin ${branch}`)
    deliverSteps.push('Open a draft PR: gh pr create --draft. Title: short conventional-style summary of the accepted perf changes. Body: per-candidate summary + benchstat evidence + verifier reason, and the full rejected list for context. No AI/assistant/Claude trailers or mentions.')
  } else {
    deliverSteps.push('Do NOT push and do NOT open a PR — commit locally only (delivery=commit).')
  }
} else if (DELIVERY !== 'draft' && accepted.length === 0) {
  deliverSteps.push('No candidate was accepted — do NOT create a branch, commit, or open a PR. Delivery is report-only this run.')
} else {
  deliverSteps.push('delivery=draft: do NOT create a branch, commit, push, or open a PR. Everything is report-only.')
}

const delivery = await agent(
  `Deliver the results of a go-optimize run.
${deliverSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Constraints: this repo's git-guard permits commit/push on a feature branch only. Do NOT push to main or master, and NEVER force-push, regardless of what goes wrong. On any git/gh command failure, stop that step and report exactly what already succeeded — do not retry failed git/gh commands.
Return via StructuredOutput: {reportPath, rejectedPath, branch (only if one was created), commits: [one short description per commit actually made], pr_url (only if a PR was actually created)}.`,
  { label: 'deliver', phase: 'Deliver', schema: DELIVER_SCHEMA, model: MODEL },
)

log(`delivered: report=${(delivery && delivery.reportPath) || '(not written)'} accepted=${accepted.length} rejected=${rejected.length}${delivery && delivery.branch ? ` branch=${delivery.branch}` : ''}${delivery && delivery.pr_url ? ` pr=${delivery.pr_url}` : ''}`)

return {
  pkg: resolved.pkgTarget,
  targetBench: targetBenchPattern,
  threshold: THRESHOLD,
  accepted: accepted.map((c) => ({ angle: c.angle, summary: c.summary, evidence: c.gate.evidence, verifyReason: c.verify.reason, files: c.files })),
  rejected,
  reportPath: (delivery && delivery.reportPath) || '',
  rejectedPath: (delivery && delivery.rejectedPath) || '',
  delivery: DELIVERY === 'draft' ? null : delivery,
  note: DELIVERY === 'draft'
    ? 'Nothing was committed — this was a draft run. Review the report and diffs yourself; merge/commit judgment is yours, not the workflow\'s.'
    : (accepted.length ? `Delivered on branch ${(delivery && delivery.branch) || branch}.` : 'Delivery was requested but no candidate was accepted, so nothing was committed.'),
}
