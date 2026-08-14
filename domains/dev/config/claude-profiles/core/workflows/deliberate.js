export const meta = {
  name: 'deliberate',
  description: 'Double-diamond deliberation: ground in existing code/docs, reframe the real question, diverge with forced-diversity operators, gate load-bearing claims through code/web evidence, converge on pre-registered criteria, adversarially challenge (one retry loop), synthesize',
  whenToUse: 'Design sparring, architecture choices, product direction — judgment calls where some sub-claims need evidence (from the repo or the web) and some need perspectives. Use research instead when the whole answer must come from current sources.',
  phases: [
    { title: 'Ground', detail: 'scout the named files/repo into a facts digest' },
    { title: 'Reframe', detail: 'diverge on what the real question is, converge to one' },
    { title: 'Diverge', detail: 'options via distinct lenses + diversity operators' },
    { title: 'Gate', detail: 'route load-bearing claims to code-reader or web-searcher' },
    { title: 'Converge', detail: 'score against criteria fixed before seeing options' },
    { title: 'Challenge', detail: 'skeptic pass; fatal objections trigger one re-diverge' },
    { title: 'Synthesize', detail: 'recommendation + trade-offs + evidence' },
  ],
}

// args: {
//   question: string,
//   context?: string,
//   grounding?: string[],   // files/dirs the scout must read (repo facts). omit = no Ground phase
//   evidence?: 'auto' | 'never',  // auto (default): Gate verifies load-bearing claims. never: skip Gate, claims stay unverified
//   model?: string,
//   language?: string,      // final synthesis language (default: Japanese)
// }
// Model tiers: scout/reframe/criteria/diverge/gate -> MODEL (gate volume
// scales with claim count and is evidence-based); converge/challenge/
// synthesize -> session model + high effort (the judgment stages).
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
const QUESTION = (A && A.question) || ''
const CONTEXT = (A && A.context) || ''
const GROUNDING = (A && Array.isArray(A.grounding)) ? A.grounding : []
const EVIDENCE = (A && A.evidence) === 'never' ? 'never' : 'auto'
const MODEL = (A && A.model) || 'sonnet'
const LANGUAGE = (A && A.language) || 'Japanese'
if (!QUESTION) { log('deliberate requires args.question'); return { error: 'no question' } }

// ---- Ground: repo facts digest (optional) ----
phase('Ground')
let ground = ''
if (GROUNDING.length) {
  ground = await agent(
    `Read these paths and produce a compact facts digest (English, <= 40 lines): what exists, key names/shapes, constraints visible in code or docs. Facts only — no opinions, no proposals.
Paths: ${GROUNDING.join(', ')}
The digest will be handed to every later agent as ground truth about the repo.`,
    { label: 'scout', phase: 'Ground', model: MODEL },
  ) || ''
} else {
  log('no grounding paths — skipping scout')
}
const BASE = `Question: ${QUESTION}
${CONTEXT ? `Context: ${CONTEXT}` : ''}
${ground ? `Repo facts (ground truth):\n${ground}` : ''}`

// ---- Reframe: first diamond — what is the real question? ----
phase('Reframe')
const REFRAME_SCHEMA = {
  type: 'object', required: ['real_question', 'why'],
  properties: {
    candidates: { type: 'array', items: { type: 'string' } },
    real_question: { type: 'string' },
    why: { type: 'string' },
  },
}
const reframe = await agent(
  `First diamond. Diverge: restate this question 4 different ways (each a genuinely different framing of what is really being asked — zoom out, zoom in, invert, name the underlying tension). Then converge: pick the one real question that, once answered, settles the original. Return candidates, real_question, why.
${BASE}`,
  { label: 'reframe', phase: 'Reframe', schema: REFRAME_SCHEMA, model: MODEL },
)
const REAL_Q = (reframe && reframe.real_question) || QUESTION
log(`real question: ${REAL_Q}`)

// ---- Criteria: fixed BEFORE seeing options (prevents post-hoc rationalization) ----
const CRITERIA_SCHEMA = {
  type: 'object', required: ['criteria'],
  properties: { criteria: { type: 'array', maxItems: 5, items: {
    type: 'object', required: ['name', 'meaning'],
    properties: { name: { type: 'string' }, meaning: { type: 'string' } },
  } } },
}
const criteriaPromise = agent(
  `Fix 3-5 scoring criteria for answers to this question BEFORE any options exist. Derive them from the question and context only (e.g. reversibility, user experience, maintenance cost). Each with a one-line meaning.
Real question: ${REAL_Q}
${BASE}`,
  { label: 'criteria', phase: 'Diverge', schema: CRITERIA_SCHEMA, model: MODEL },
)

// ---- Diverge: forced diversity ----
phase('Diverge')
const OPERATORS = [
  'the simplest thing that could possibly work',
  'an analogy from a different field, transplanted',
  'the inverse of a well-known past failure in this problem space',
  'remove one assumed constraint, then design freely',
  'the most radical version you can defend',
]
const OPTION_SCHEMA = {
  type: 'object', required: ['title', 'sketch', 'claims'],
  properties: {
    title: { type: 'string' },
    sketch: { type: 'string', description: 'the option in <= 8 lines' },
    claims: { type: 'array', items: { type: 'object', required: ['claim', 'kind'], properties: {
      claim: { type: 'string', description: 'a load-bearing factual claim this option depends on' },
      kind: { type: 'string', enum: ['repo', 'world'], description: 'repo = verifiable by reading this codebase; world = verifiable only externally' },
    } } },
  },
}
const options = (await parallel(OPERATORS.map((op, i) => () =>
  agent(
    `Produce ONE option for the real question, generated strictly through this diversity operator: "${op}". Commit to it. List the load-bearing factual claims it depends on, each tagged repo/world.
Real question: ${REAL_Q}
${BASE}`,
    { label: `option-${i + 1}`, phase: 'Diverge', schema: OPTION_SCHEMA, model: MODEL },
  ),
))).filter(Boolean)
if (!options.length) { log('diverge produced nothing'); return { error: 'no options' } }
const criteria = (await criteriaPromise) || { criteria: [] }

// ---- Gate: evidence toll before convergence (repo claims -> code reader, world claims -> web) ----
phase('Gate')
const VERDICT_SCHEMA = {
  type: 'object', required: ['claim', 'verdict'],
  properties: { claim: { type: 'string' }, verdict: { type: 'string', enum: ['holds', 'fails', 'unverified'] }, note: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } },
}
let gated = []
if (EVIDENCE === 'auto') {
  const claims = options.flatMap((o, oi) => (o.claims || []).map((c) => ({ ...c, option: oi })))
  log(`gating ${claims.length} claims (${claims.filter((c) => c.kind === 'repo').length} repo / ${claims.filter((c) => c.kind === 'world').length} world)`)
  gated = (await pipeline(
    claims,
    (c) => agent(
      c.kind === 'repo'
        ? `Verify this claim by READING THE CODE (Grep/Read; no web). Verdict holds/fails/unverified with the file evidence in note.
Claim: ${c.claim}
${ground ? `Start from these known paths:\n${GROUNDING.join(', ')}` : ''}`
        : `Verify this claim with WebSearch/WebFetch. Verdict holds/fails/unverified; cite only sources you opened.
Claim: ${c.claim}`,
      { label: `${c.kind}:${c.claim.slice(0, 30)}`, phase: 'Gate', schema: VERDICT_SCHEMA, model: MODEL },
    ).then((v) => v && { ...v, option: c.option, kind: c.kind }),
  )).filter(Boolean)
} else {
  log('evidence: never — claims stay unverified')
}

// ---- Converge (+ one Challenge-driven retry) ----
const CONVERGE_SCHEMA = {
  type: 'object', required: ['ranking', 'recommendation'],
  properties: {
    ranking: { type: 'array', items: { type: 'object', required: ['title', 'score_note'], properties: { title: { type: 'string' }, score_note: { type: 'string' } } } },
    recommendation: { type: 'string', description: 'the chosen option, possibly grafting the best parts of runners-up' },
  },
}
const CHALLENGE_SCHEMA = {
  type: 'object', required: ['objections'],
  properties: { objections: { type: 'array', maxItems: 5, items: {
    type: 'object', required: ['objection', 'severity'],
    properties: { objection: { type: 'string' }, severity: { type: 'string', enum: ['fatal', 'serious', 'minor'] } },
  } } },
}
let converged = null
let objections = []
for (let round = 1; round <= 2; round += 1) {
  phase('Converge')
  converged = await agent(
    `Score every option against the pre-registered criteria and converge. Options whose load-bearing claims FAILED the evidence gate must be demoted or repaired. Recommend one (grafting runner-up parts is allowed).
Real question: ${REAL_Q}
Criteria: ${JSON.stringify(criteria.criteria)}
Options: ${JSON.stringify(options)}
Gate verdicts: ${JSON.stringify(gated)}
${round > 1 ? `Previous fatal objections to address: ${JSON.stringify(objections.filter((o) => o.severity === 'fatal'))}` : ''}`,
    // Judgment stage: session model (no override), high effort.
    { label: `converge-r${round}`, phase: 'Converge', schema: CONVERGE_SCHEMA, effort: 'high' },
  )
  phase('Challenge')
  const ch = await agent(
    `You are the designated skeptic. Attack this convergence: hidden assumptions, an option space that was too narrow, criteria that got quietly reweighted after the fact, gate verdicts being ignored. No new scope.
Real question: ${REAL_Q}
Convergence: ${JSON.stringify(converged)}`,
    // Judgment stage: session model (no override), high effort.
    { label: `challenge-r${round}`, phase: 'Challenge', schema: CHALLENGE_SCHEMA, effort: 'high' },
  )
  objections = (ch && ch.objections) || []
  if (!objections.some((o) => o.severity === 'fatal')) break
  log(`round ${round}: fatal objection — one more convergence round`)
}

phase('Synthesize')
const synthesis = await agent(
  `Synthesize, written in ${LANGUAGE}:
1. The real question (from the reframe) and how it differs from the original
2. The recommendation (state it flatly) and its grounds — facts that passed the gate carry their source/file evidence, unverified ones are labeled unverified as-is
3. Trade-offs and the discarded alternatives (one line each)
4. Answers to the remaining objections (serious and above)
Real question: ${REAL_Q}
Reframe: ${JSON.stringify(reframe)}
Convergence: ${JSON.stringify(converged)}
Objections: ${JSON.stringify(objections)}
Return the final text only.`,
  // Judgment stage: session model (no override), high effort.
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' },
)

return { question: QUESTION, real_question: REAL_Q, options, criteria: criteria.criteria, gate: gated, convergence: converged, objections, answer: synthesis }
