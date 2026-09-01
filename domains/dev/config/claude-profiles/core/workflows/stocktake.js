export const meta = {
  name: 'stocktake',
  description: 'Periodic harness stocktake: scan skills / hooks / MCP / memory / freshness for stale, unused, or version-drifted items and produce a keep/drop report (report-only, no deletion)',
  whenToUse: 'Monthly config GC, or whenever ~/.claude feels bloated',
  phases: [
    { title: 'Scan', detail: '5 parallel scanners over ~/.claude' },
    { title: 'Synthesize', detail: 'merge into keep/drop/fix report' },
  ],
}

// backends: claude, codex, omp (via yoki-graph)
// args: { model?: string, language?: string }
// Model tiers: scanners -> MODEL (sonnet) at low effort (read-only inventory
// work); synthesize -> session model (judgment stays on the caller's tier).
const MODEL = (args && args.model) || 'sonnet'
const LANGUAGE = (args && args.language) || 'Japanese'

phase('Scan')

const SCAN_SCHEMA = {
  type: 'object',
  required: ['area', 'items'],
  properties: {
    area: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'verdict', 'evidence'],
        properties: {
          name: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'drop-candidate', 'fix', 'unknown'] },
          evidence: { type: 'string', description: 'the concrete observation this verdict is based on' },
        },
      },
    },
  },
}

const SCANNERS = [
  {
    key: 'skills',
    prompt: `Inventory ~/.claude/skills (each entry is a symlink into dotfiles). For each skill, judge staleness by evidence, not taste: broken symlinks, empty dirs, near-duplicate descriptions (read only frontmatter), vendored junk inside skill dirs (node_modules etc.) — except where the skill ships its own tool directory with a package.json next to it (e.g. grilling/render), which is intentional and is 'keep'. Do not read skill bodies. Verdict per skill: keep / drop-candidate / fix.`,
  },
  {
    key: 'hooks',
    prompt: `Read ~/.claude/settings.json hooks section. For each wired hook: does the script exist, is it executable, does bash -n / node --check pass? Also list scripts present in ~/.claude/hooks that are NOT wired anywhere (drop candidates). Check ~/.claude/.cache and hook log files for recent errors if present.`,
  },
  {
    key: 'mcp',
    prompt: `Compare configured MCP servers (mcpServers in ~/.claude/settings.json and ~/.claude.json if present) against actual usage in ~/.claude/mcp-audit.log (count per server prefix). A configured server with zero logged calls is a drop-candidate; note that the audit log may not capture plugin-provided tools, so mark those 'unknown' rather than 'drop-candidate'.`,
  },
  {
    key: 'memory',
    prompt: `Assess the memory systems for overlap and rot: (a) ~/.claude/projects/*/memory (curated file memory) — count entries, flag pointers whose target file no longer exists; (b) ~/.claude/homunculus — observations vs corrections.jsonl volume, whether any instincts were ever produced; (c) ~/.claude-mem — DB/log sizes; (d) ~/.claude/session-data — stale .tmp accumulation; (e) grilling round cache — run \`find . ~/.claude -maxdepth 4 -type d -path '*/.claude/.cache/grilling/*' -mindepth 1 2>/dev/null\` from the current repo and flag every slug directory whose mtime is older than 60 days as a drop-candidate (the grilling skill prunes these itself on start, so leftovers mean the skill has not run there recently); a slug dir that still holds round-<n>.md but no transcript.md is an abandoned grilling — report it as 'fix'. Report sizes and drop candidates. Report only — delete nothing.`,
  },
  {
    key: 'freshness',
    prompt: `Audit skill content for staleness against real-world drift. Steps: (1) run \`grep -rn "verified:" --include=SKILL.md ~/.claude/skills\` to collect frontmatter verified dates per skill. (2) For each skill, judge staleness risk: flag it if its verified date is older than 90 days, OR if it has no verified date at all but contains version-sensitive content — detect this by grepping the skill body for version numbers, patterns like "1.2x", "ES20xx", "React 1x", or specific CSS/framework feature names tied to a version. Skills that are purely judgment/pattern-based (no version-pinned facts) are out of scope for this check even if undated. (3) From the flagged set, pick the 3-5 riskiest candidates (most concrete version claims, oldest dates, most actively-evolving ecosystems) and WebSearch each ecosystem's current stable version or recent release notes to check for drift. Report each as a 'fix' verdict item with concrete evidence in the form "<skill> verified <date> but <ecosystem> is now at <version/change> as of <source>" — cite what you found via WebSearch, not assumption. Skills where the verified date is recent, or where content is version-stable/judgment-only, are 'keep'. This is a read-only audit — do not edit any skill file.`,
  },
]

const scans = await parallel(SCANNERS.map((s) => () =>
  agent(`${s.prompt}\nSet area="${s.key}". Return every item you judged via StructuredOutput. This is a read-only audit — change nothing.`,
    { label: `scan:${s.key}`, phase: 'Scan', schema: SCAN_SCHEMA, model: MODEL, effort: 'low' }),
))

phase('Synthesize')
const found = scans.filter(Boolean)
const drops = found.flatMap((s) => s.items.filter((i) => i.verdict === 'drop-candidate').map((i) => `[${s.area}] ${i.name} — ${i.evidence}`))
const fixes = found.flatMap((s) => s.items.filter((i) => i.verdict === 'fix').map((i) => `[${s.area}] ${i.name} — ${i.evidence}`))

const summary = await agent(
  `Merge this stocktake into a short prioritized report, written in ${LANGUAGE}. Group by area, lead with what to delete and why, then what to fix. Be specific; no padding.
DROP CANDIDATES:\n${drops.join('\n') || '(none)'}\nFIX:\n${fixes.join('\n') || '(none)'}`,
  // Judgment stage: pinned to sonnet.
  { label: 'synthesize', phase: 'Synthesize', model: 'sonnet' },
)

log(`stocktake: ${drops.length} drop candidate(s), ${fixes.length} fix item(s)`)
return { report: summary, drop_candidates: drops, fix_items: fixes }
