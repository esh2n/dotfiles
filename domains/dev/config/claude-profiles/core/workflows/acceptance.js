export const meta = {
  name: 'acceptance',
  description: 'Acceptance check for finished work: map each criterion to the evidence that actually pins it, adversarially verify the coverage claims, and report the gaps a human must close',
  whenToUse: 'Implementation is done and you need to know whether it can ship — which criteria are pinned by tests, which are manual-only, and which are silently unmet',
  phases: [
    { title: 'Ground', detail: 'read the criteria and how this project verifies things' },
    { title: 'Evidence', detail: 'one lane per criterion group; find the artifact that pins it' },
    { title: 'Verify', detail: 'adversarially check every "covered" claim' },
    { title: 'Gaps', detail: 'completeness critic: what was skipped or unverifiable' },
    { title: 'Report', detail: 'coverage table, gaps, and the calls a human must make' },
  ],
}

// args: {
//   criteria?: [{ id: string, text: string }],  // explicit list
//   criteriaFile?: string,                      // or a file to read them from
//   scope?: string,                             // what was built (paths, feature name)
//   out?: string,                               // file path to write the report to
//   language?: string,                          // report language (default: follow the project's docs)
//   model?: string,
// }
// Model tiers: ground/evidence/verify -> MODEL (verify volume scales with the
// criteria list and is evidence-based artifact re-reading, so it stays on the
// finder tier with high effort); gaps critic + report -> session model + high
// effort (the judgment the shipping decision rests on).
// Robustness: named-workflow invocation may deliver args as a JSON string.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
const CRITERIA = (A && A.criteria) || []
const CRITERIA_FILE = (A && A.criteriaFile) || ''
const SCOPE = (A && A.scope) || ''
const OUT = (A && A.out) || ''
const LANGUAGE = (A && A.language) || "the language the project's own docs are written in"
const MODEL = (A && A.model) || 'sonnet'
if (!CRITERIA.length && !CRITERIA_FILE) {
  log('acceptance requires args.criteria or args.criteriaFile')
  return { error: 'no criteria' }
}

phase('Ground')

const GROUND_SCHEMA = {
  type: 'object',
  required: ['criteria', 'verification'],
  properties: {
    criteria: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object', required: ['id', 'text'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: 'the criterion, quoted or closely paraphrased' },
        },
      },
    },
    verification: {
      type: 'object', required: ['commands', 'notes'],
      properties: {
        commands: {
          type: 'array', maxItems: 12,
          items: { type: 'string', description: 'how this project runs its checks, verbatim' },
        },
        notes: { type: 'string', description: 'conventions that decide what counts as evidence here' },
      },
    },
  },
}

const ground = await agent(
  `Ground an acceptance check in this repository. Two jobs, no judging yet.

1. Assemble the list of acceptance criteria.
${CRITERIA.length ? `They were given explicitly:\n${JSON.stringify(CRITERIA)}` : `Read them from: ${CRITERIA_FILE}\nQuote each one; do not summarise them away. Keep their original identifiers.`}

2. Find out how this project verifies things. Read its contributor docs, CI config, test scripts and lint config. Record the exact commands it runs, and the conventions that decide what counts as evidence (for example: whether a test near the code counts, whether manual checks are recorded somewhere, what the coverage gate is).

${SCOPE ? `What was built: ${SCOPE}` : ''}

Read files. Do not run builds or tests in this phase. Return via StructuredOutput.`,
  { label: 'ground', phase: 'Ground', schema: GROUND_SCHEMA, model: MODEL },
)
if (!ground || !ground.criteria || !ground.criteria.length) {
  log('grounding found no criteria')
  return { error: 'no criteria found' }
}
log(`criteria: ${ground.criteria.length} / verification commands: ${(ground.verification.commands || []).length}`)

// NOTE: one lane per small group keeps each agent's context on a few criteria
//       instead of the whole list, which is where loose "looks covered" claims
//       come from. Groups of 4 keep the lane count sane for long criteria lists.
const GROUP_SIZE = 4
const groups = []
for (let i = 0; i < ground.criteria.length; i += GROUP_SIZE) {
  groups.push(ground.criteria.slice(i, i + GROUP_SIZE))
}

const EVIDENCE_SCHEMA = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'evidence', 'reasoning'],
        properties: {
          id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['automated', 'manual', 'review-only', 'missing'],
            description: 'automated = a test fails if this breaks; manual = only a human can check it; review-only = nothing catches it but a reader; missing = nothing at all',
          },
          evidence: {
            type: 'string',
            description: 'file:line of the artifact that pins it, or the manual procedure. Empty when status is missing',
          },
          reasoning: {
            type: 'string',
            description: 'why that artifact actually pins this criterion (not merely touches the same area)',
          },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['holds', 'reason'],
  properties: {
    holds: { type: 'boolean' },
    reason: { type: 'string' },
    corrected_status: { type: 'string', enum: ['automated', 'manual', 'review-only', 'missing'] },
  },
}

// pipeline: a group's claims are challenged as soon as that group is mapped,
// so slow groups never hold up verification of the fast ones.
const mapped = await pipeline(
  groups,
  (group, _item, index) => agent(
    `Find the evidence for these acceptance criteria in this repository.

Criteria:
${group.map((c) => `- [${c.id}] ${c.text}`).join('\n')}

${SCOPE ? `What was built: ${SCOPE}` : ''}
How this project verifies things: ${ground.verification.notes}

For each criterion, find the artifact that would actually fail if the behaviour broke, and cite it as file:line. Classify honestly:
- automated: a test or gate fails when this breaks
- manual: only a person can check it (say where the procedure is written, or that it is unwritten)
- review-only: nothing catches a regression except a reader
- missing: nothing at all

Rules: read the cited artifact before citing it. A test that runs the same module is not evidence unless it asserts this specific behaviour. Prefer "missing" over a weak citation — an inflated coverage claim is worse than an admitted gap.`,
    { label: `evidence:${index + 1}`, phase: 'Evidence', schema: EVIDENCE_SCHEMA, model: MODEL },
  ).then((r) => ({ group: index + 1, rows: (r && r.rows) || [] })),
  (r) => parallel(
    r.rows.filter((row) => row.status === 'automated' || row.status === 'manual').map((row) => () =>
      agent(
        `Try to refute this coverage claim.

Criterion [${row.id}]: ${(ground.criteria.find((c) => c.id === row.id) || {}).text || ''}
Claimed status: ${row.status}
Claimed evidence: ${row.evidence}
Claimed reasoning: ${row.reasoning}

Open the cited artifact and read it. The claim fails if any of these is true: the citation does not exist; it asserts something adjacent but not this criterion; it would still pass with the behaviour broken; the criterion has parts the evidence does not reach. Default to holds=false when you are unsure — a gap that turns out to be covered costs a re-check, an inflated claim ships a hole. If the status is wrong but some weaker status is right, give corrected_status.`,
        { label: `verify:${row.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: 'opus', effort: 'high' },
      ).then((v) => ({ ...row, verdict: v })),
    ),
  ).then((checked) => {
    const byId = new Map(checked.filter(Boolean).map((c) => [c.id, c]))
    return {
      ...r,
      rows: r.rows.map((row) => {
        const c = byId.get(row.id)
        if (!c || !c.verdict) return row
        if (c.verdict.holds) return { ...row, verified: true }
        return {
          ...row,
          verified: false,
          status: c.verdict.corrected_status || 'missing',
          refutation: c.verdict.reason,
        }
      }),
    }
  }),
)

const rows = mapped.filter(Boolean).flatMap((m) => m.rows)
const covered = rows.filter((r) => r.status === 'automated').length
log(`automated: ${covered}/${rows.length}`)

phase('Gaps')

const GAPS_SCHEMA = {
  type: 'object',
  required: ['gaps', 'decisions'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object', required: ['what', 'why_it_matters'],
        properties: {
          what: { type: 'string' },
          why_it_matters: { type: 'string' },
          suggested_next_step: { type: 'string' },
        },
      },
    },
    decisions: {
      type: 'array',
      description: 'calls only a human can make: scope cuts, accepted risks, criteria that no longer fit',
      items: {
        type: 'object', required: ['question', 'options', 'recommendation'],
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          tradeoff: { type: 'string' },
        },
      },
    },
  },
}

const gaps = await agent(
  `Act as the completeness critic for an acceptance check.

Criteria and the evidence found for each (JSON):
${JSON.stringify(rows).slice(0, 30000)}

${SCOPE ? `What was built: ${SCOPE}` : ''}
Checks this project runs: ${JSON.stringify(ground.verification.commands)}

Name what is missing. Look for: criteria with no evidence; whole classes of check this project runs that were never applied to this work; parts of the built scope that no criterion covers at all; claims that survived verification but rest on a single fragile artifact; anything that can only be settled on real hardware or by a person.

Then separate out the calls a human must make — scope cuts, accepted risks, criteria that no longer match what the product became. For each, give the options, your recommendation, and the trade-off in one line. Do not invent decisions to fill the list; an empty list is a valid answer.`,
  // Judgment stage: pinned to opus, high effort.
  { label: 'gaps', phase: 'Gaps', schema: GAPS_SCHEMA, model: 'opus', effort: 'high' },
)

phase('Report')

const report = await agent(
  `Write an acceptance report in ${LANGUAGE}.

${SCOPE ? `Scope: ${SCOPE}` : ''}
Criteria and evidence (JSON): ${JSON.stringify(rows).slice(0, 30000)}
Gaps and decisions (JSON): ${JSON.stringify(gaps || {}).slice(0, 12000)}
Checks this project runs: ${JSON.stringify(ground.verification.commands)}

Structure:
1. A one-line verdict: can this ship, and if not, what blocks it.
2. A table, one row per criterion: id, what it requires, status, the evidence with file:line.
3. Everything not covered, listed openly — including anything that can only be checked by a person or on real hardware. Do not soften or omit.
4. The calls a human must make, each with options, your recommendation, and the trade-off.

Rules: state only what the evidence supports. Where a coverage claim was refuted, say so and give the refutation. Never present an unrun check as passing. No padding, no praise.
${OUT ? `Write the report to ${OUT} as well as returning it.` : ''}`,
  // Judgment stage: pinned to opus, high effort.
  { label: 'report', phase: 'Report', model: 'opus', effort: 'high' },
)

return {
  verdict: { total: rows.length, automated: covered },
  rows,
  gaps: (gaps && gaps.gaps) || [],
  decisions: (gaps && gaps.decisions) || [],
  report,
}
