export const meta = {
  name: 'code-study',
  description: 'Read a specific codebase against fixed questions: locate the relevant parts, read them, spot-check the citations, and report with file:line evidence',
  whenToUse: 'You need to understand how an existing implementation actually works — a library you might borrow from, a codebase you inherited, a product whose approach you are weighing. Reading, not web research',
  phases: [
    { title: 'Map', detail: 'locate the parts that answer the questions' },
    { title: 'Read', detail: 'one lane per question, reading the actual files' },
    { title: 'Check', detail: 'one pass over a sample of citations' },
    { title: 'Report', detail: 'answers with file:line evidence' },
  ],
}

// args: {
//   target: string,            // repo URL, or a path on this machine
//   questions: string[],       // what the study must answer (1-6)
//   context?: string,          // why we are reading this; what the reader will decide
//   out?: string,              // file path to write the report to
//   language?: string,         // report language
//   model?: string,
// }
// Robustness: named-workflow invocation may deliver args as a JSON string.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
const TARGET = (A && A.target) || ''
const QUESTIONS = ((A && A.questions) || []).slice(0, 6)
const CONTEXT = (A && A.context) || ''
const OUT = (A && A.out) || ''
const LANGUAGE = (A && A.language) || "the language the reader's own project uses"
const MODEL = (A && A.model) || 'sonnet'
if (!TARGET) { log('code-study requires args.target'); return { error: 'no target' } }
if (!QUESTIONS.length) { log('code-study requires args.questions'); return { error: 'no questions' } }

// NOTE: the discipline is identical in every phase, so it lives in one place.
//       "Say you could not find it" is load-bearing: a study that quietly fills
//       gaps with plausible architecture is worse than a study with holes in it.
// Model tiers: map/read/report -> MODEL; the citation check -> session model +
// high effort (it is the only verification pass this workflow has).
const RULES = `
Discipline:
- Primary sources only. Ground every statement in files you actually opened; never write about what you did not read.
- Attach file:line to every claim. When a line cannot be pinned down, say "location not pinned" explicitly.
- What was not found is reported as "not found". Never fill gaps with plausible-sounding architecture.
- No conclusions beyond what was read. Whether to adopt or reject is the reader's call, not yours.
- Never blend fact and inference. When you do infer, label it as inference.`

phase('Map')

const MAP_SCHEMA = {
  type: 'object',
  required: ['layout', 'entry_points'],
  properties: {
    layout: { type: 'string', description: 'how the codebase is organised, in a few sentences' },
    entry_points: {
      type: 'array', maxItems: 24,
      items: {
        type: 'object', required: ['question_index', 'paths'],
        properties: {
          question_index: { type: 'integer', description: '0-based index into the question list' },
          paths: { type: 'array', items: { type: 'string' }, description: 'files or directories to read for this question' },
        },
      },
    },
    unavailable: { type: 'string', description: 'anything that could not be reached, and why' },
  },
}

const map = await agent(
  `Locate the parts of this codebase that answer a fixed set of questions. Do not answer them yet.

Target: ${TARGET}
${CONTEXT ? `Why we are reading it: ${CONTEXT}` : ''}

Questions:
${QUESTIONS.map((q, i) => `${i}. ${q}`).join('\n')}

Job: grasp how the repository is organised, then for each question list the files and directories that, once read, would answer it.
A local path: read it directly. A URL: fetch contents via the hosting API or raw files.
Whatever could not be reached (private, deleted, moved elsewhere) goes in unavailable.
${RULES}`,
  { label: 'map', phase: 'Map', schema: MAP_SCHEMA, model: MODEL },
)
if (!map || !map.entry_points) { log('mapping failed'); return { error: 'no map' } }
log(`layout: ${(map.layout || '').slice(0, 120)}`)
if (map.unavailable) log(`unavailable: ${map.unavailable}`)

const ANSWER_SCHEMA = {
  type: 'object',
  required: ['answer', 'evidence', 'not_found'],
  properties: {
    answer: { type: 'string', description: 'what the code actually does' },
    evidence: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object', required: ['claim', 'location'],
        properties: {
          claim: { type: 'string' },
          location: { type: 'string', description: 'file:line' },
          load_bearing: { type: 'boolean', description: 'true if the answer collapses without this' },
        },
      },
    },
    not_found: { type: 'array', items: { type: 'string' }, description: 'what was looked for and not found' },
  },
}

// NOTE: one lane per question, and the fan-out stops here. Verification is a
//       single bounded pass in the next phase rather than one agent per claim —
//       per-claim fan-out on a codebase study grows without a ceiling, because
//       reading code produces claims faster than reading sources does.
const answers = await parallel(
  QUESTIONS.map((q, index) => () => {
    const entry = (map.entry_points || []).find((e) => e.question_index === index)
    const paths = entry && entry.paths && entry.paths.length ? entry.paths.join('\n') : '(not pinned by mapping — search for it yourself)'
    return agent(
      `Answer one question by reading this codebase.

Target: ${TARGET}
Layout: ${map.layout}
${CONTEXT ? `Why we are reading it: ${CONTEXT}` : ''}

Question: ${q}

Where to read (widen if insufficient):
${paths}

Job: open and read the actual files, and answer with what the code does. Write the behaviour first, before guessing at design intent. Whatever the answer cannot stand on goes in not_found.
${RULES}`,
      { label: `read:q${index}`, phase: 'Read', schema: ANSWER_SCHEMA, model: MODEL },
    ).then((r) => ({ index, question: q, ...(r || {}) }))
  }),
)

phase('Check')

const clean = answers.filter(Boolean)
const sample = clean.flatMap((a) => (a.evidence || []).filter((e) => e.load_bearing)).slice(0, 24)

const CHECK_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', required: ['location', 'holds'],
        properties: {
          location: { type: 'string' },
          holds: { type: 'boolean' },
          reason: { type: 'string', description: 'what is actually there, when it does not hold' },
        },
      },
    },
  },
}

// NOTE: one agent, one pass, a bounded sample. It re-opens the cited lines and
//       says whether they say what the claim says — the cheapest check that
//       still catches a study built on citations nobody re-read.
const check = sample.length
  ? await agent(
      `Re-open each cited location in this codebase and say whether it supports the claim made about it.

Target: ${TARGET}

Claims and locations to check (JSON):
${JSON.stringify(sample).slice(0, 20000)}

Job: open the cited source and actually read it. When the content differs from the claim, write what is actually there in reason. When the location does not exist, set holds=false and say so in reason. When in doubt, lean holds=false.
${RULES}`,
      // Judgment stage: session model (no override), high effort.
      { label: 'check', phase: 'Check', schema: CHECK_SCHEMA, effort: 'high' },
    )
  : null

const refuted = ((check && check.results) || []).filter((r) => !r.holds)
log(`citations checked: ${sample.length} / refuted: ${refuted.length}`)

phase('Report')

const report = await agent(
  `Write a code study report in ${LANGUAGE}.

Target: ${TARGET}
${CONTEXT ? `Why we are reading it: ${CONTEXT}` : ''}
Layout: ${map.layout}

Questions and answers (JSON): ${JSON.stringify(clean.map((a) => ({
    question: a.question,
    answer: a.answer,
    evidence: a.evidence,
    not_found: a.not_found,
  }))).slice(0, 30000)}

Citation-check results (JSON): ${JSON.stringify((check && check.results) || []).slice(0, 8000)}
${map.unavailable ? `Could not be reached: ${map.unavailable}` : ''}

Structure:
1. What was read and where
2. The answer per question, every claim carrying file:line
3. What was not found — report "searched and absent" as a fact in its own right
4. Material for the reader's decision. No adopt/reject verdict — only what was learned

Rules: a claim refuted by the citation check is either dropped or rewritten to what the check actually found.
Never write about what was not read. No decoration. No praise.
${OUT ? `Also write the report to ${OUT}.` : ''}`,
  { label: 'report', phase: 'Report', model: MODEL },
)

return {
  target: TARGET,
  answers: clean,
  checked: sample.length,
  refuted: refuted.length,
  not_found: clean.flatMap((a) => a.not_found || []),
  report,
}
