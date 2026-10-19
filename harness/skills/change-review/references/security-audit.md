# Whole-codebase security audit

A baseline review of everything, not a diff. Run it only when the owner asks, for a first audit, before a major release, after a design change to a trust boundary, after an incident, or when a diff review found a serious concern whose root cause may repeat elsewhere (OWASP calls this moving from a diff-based review to a baseline review). The per-diff review stays with `security-reviewer`.

Static only unless the owner sets `JIG_REVIEW_EXEC=1` for the run and the code runs in an isolated environment. Without both, every finding is `[static]` or `[unverified]`, and the output says so.

## Steps

1. **Scope.** Name the assets (data, credentials, money, user accounts, build and release), what is in and out of scope, and answer the four threat-modeling questions: what are we building, what can go wrong, what are we doing about it, did we do a good enough job.
2. **Attack surface map.** List every entry point (routes, CLI arguments, webhooks, file and archive inputs, environment and config, CI triggers, LLM inputs: user text, fetched pages, files, tool output), every trust boundary, every outbound destination, where secrets live, and the dependency and CI supply chain.
3. **Context first, no verdicts.** Per module or function on the surface: its assumptions, the guarantees it relies on, and what was checked and found to hold. Spawn one read-only subagent per area; they return structured notes, never severities.
4. **Tools.** Run what is installed and record each status: `semgrep`, `osv-scanner scan source -r .`, `gitleaks git`, `zizmor .github/workflows`, and the language scanners (`gosec`, `bandit`, `brakeman`). Feed their output to step 5. A tool that did not run is listed as not run; it never supports "no issues".
5. **Search by area.** One lane per area, at most six at a time, each reading `security-reviewer`'s check table for its area: authorization and tenant isolation; authentication and sessions; injection and file handling; secrets and crypto; outbound requests (SSRF) and deserialization; supply chain and CI; LLM features; fail-open error handling.
6. **Variants.** For each confirmed defect, search the codebase for the same root cause.
7. **Refute.** One `review-verifier` per candidate, with only that candidate and its evidence. Do not skip this step. Agreement between several lanes is not proof; a candidate holds only with positive evidence.
8. **Output.** Findings in the `output-format.md` shape with CWE or ASVS ids; the areas not examined; residual risks and testing gaps; each tool and its status; counts of candidates, refuted, held and unverified, so a refutation step that silently stopped is visible.

## Sources

- OWASP Secure Code Review Cheat Sheet (baseline, diff-based and hybrid reviews): https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
- OWASP Threat Modeling Cheat Sheet (the four questions): https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- OWASP ASVS 5.0 (areas and requirement ids): https://github.com/OWASP/ASVS
- Trail of Bits skills (context building before search, a separate false-positive check): https://github.com/trailofbits/skills
- Static analysis output given to the reviewing model raised detection to 96.9%: https://arxiv.org/abs/2602.16741
- Unanimous reviewers supporting a vulnerability that did not exist; refutation removed 79–83% of candidates: https://arxiv.org/abs/2604.19049
