# go-optimize

Evidence-gated Go performance optimization workflow. Merged into
`~/.claude/workflows/` by `yoki-switch` only while the `go` pack is enabled
(`MERGE_DIRS` includes `workflows`, `domains/dev/bin/yoki-switch:109`).

## Args
```js
{
  pkg: string,        // required — import path or dir
  bench?: string,     // regex for `go test -bench`; narrows an EXISTING
                       // benchmark, does not authorize writing a new one
  threshold?: number, // required percent improvement, default 5
  budget?: { maxProposals?: number, maxRounds?: number }, // default {4, 1}
  delivery?: 'draft' | 'commit' | 'pr', // default 'draft' — no commit unless
                                        // the caller explicitly chose it
  runId?: string,      // scratch dir suffix, default 'latest'
}
```
A bare string arg is treated as `pkg`.

## Phases and gates
1. **Resolve** — go.mod floor, `go env GOVERSION`, `go test -list`. No match
   → one agent proposes a benchmark (no implementation), run stops.
2. **Profile** — baseline `-count=10` bench + cpu/mem pprof; hot spots with a
   stated mechanism hypothesis.
3. **Propose** — up to `budget.maxProposals` parallel agents, each its own
   worktree (`isolation: 'worktree'`), one angle each (allocation, algorithmic,
   concurrency-contention, runtime-knob). Correctness gate first
   (`build`/`vet`/`test -race`) — red gate reverts and stops, no bench run.
4. **Gate** — one agent runs `benchstat` per candidate: accept needs p<0.05
   **and** improvement ≥ threshold%, **and** a `pprof -diff_base` check
   confirming the hypothesized function(s) actually dropped.
5. **Verify** — adversarial, fresh context, session model/high effort: real
   hot path? readability cost? knob portable? could `-race` miss contention?
6. **Deliver** — default `draft`: writes `report.md` + `rejected.md` under
   `.claude/.cache/go-optimize/<runId>/`, nothing committed. `commit`/`pr` run
   only when explicitly requested: one commit per accepted candidate on
   `perf/<pkg-slug>`, `perf(<scope>): <subject>` ≤50 chars, no AI trailers;
   `pr` also pushes and opens a draft PR via `gh`. Every rejection is logged.
