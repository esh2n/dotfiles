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
const RULES = `
規律:
- 一次情報のみ。実際に開いたファイルだけを根拠にする。読んでいないものを書かない
- 主張には file:line を添える。行が特定できないものは「場所を特定できていない」と書く
- 見つからなかったものは「見つからなかった」と書く。ありそうな設計で埋めない
- 読んだ範囲を超えた結論を書かない。採るべきか採らざるべきかは読み手が決める
- 事実と推測を混ぜない。推測を書くときは推測と明示する`

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

対象: ${TARGET}
${CONTEXT ? `読む理由: ${CONTEXT}` : ''}

問い:
${QUESTIONS.map((q, i) => `${i}. ${q}`).join('\n')}

やること: リポジトリの構成を掴み、問いごとに「これを読めば答えが出る」ファイルとディレクトリを挙げる。
ローカルの path なら直接読む。URL ならホスティング側の API か raw ファイルで中身を取る。
辿り着けなかったもの (private・消えている・別の場所へ移った) は unavailable に書く。
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
    const paths = entry && entry.paths && entry.paths.length ? entry.paths.join('\n') : '(mapping で特定できていない。自分で探す)'
    return agent(
      `Answer one question by reading this codebase.

対象: ${TARGET}
構成: ${map.layout}
${CONTEXT ? `読む理由: ${CONTEXT}` : ''}

問い: ${q}

読む場所 (足りなければ広げてよい):
${paths}

やること: 実際にファイルを開いて読み、コードが何をしているかを答える。設計の意図を推し量る前に、
まず動作を書く。答えが立たない部分は not_found に積む。
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

対象: ${TARGET}

照合する主張と場所 (JSON):
${JSON.stringify(sample).slice(0, 20000)}

やること: 引用元を開いて実際に読む。書かれている内容が主張と違う場合、そこに何があるかを reason に書く。
場所が存在しない場合も holds=false にして、その旨を reason に書く。迷ったら holds=false に倒す。
${RULES}`,
      { label: 'check', phase: 'Check', schema: CHECK_SCHEMA, model: MODEL },
    )
  : null

const refuted = ((check && check.results) || []).filter((r) => !r.holds)
log(`citations checked: ${sample.length} / refuted: ${refuted.length}`)

phase('Report')

const report = await agent(
  `Write a code study report in ${LANGUAGE}.

対象: ${TARGET}
${CONTEXT ? `読む理由: ${CONTEXT}` : ''}
構成: ${map.layout}

問いと答え (JSON): ${JSON.stringify(clean.map((a) => ({
    question: a.question,
    answer: a.answer,
    evidence: a.evidence,
    not_found: a.not_found,
  }))).slice(0, 30000)}

照合の結果 (JSON): ${JSON.stringify((check && check.results) || []).slice(0, 8000)}
${map.unavailable ? `辿り着けなかったもの: ${map.unavailable}` : ''}

構成:
1. 読んだ対象と場所
2. 問いごとの答え。主張には file:line を添える
3. 見つからなかったもの。探したが無かったことも、そこにある事実として書く
4. 読み手が判断するための材料。採否は書かない — 何が分かったかだけを書く

規則: 照合で否定された主張は、その主張を落とすか、照合で分かった内容に直す。
読んでいないものを書かない。装飾しない。褒めない。
${OUT ? `報告は ${OUT} にも書く。` : ''}`,
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
