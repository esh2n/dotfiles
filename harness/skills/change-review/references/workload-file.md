# The workload file

`workload-reviewer` sizes a change against real numbers only when the project states them. Without them it reports structural problems and lists what is missing, never estimates. The workload file is where a project states them once, so every review can read them.

## Where

`docs/workload.md` at the project root. If the project keeps its operations docs elsewhere, link to them from `docs/workload.md` instead of moving them. A monorepo keeps one per deployable unit beside it (`services/<name>/docs/workload.md`) and the root file lists them.

Search order for a review (step 2 of the `change-review` skill): `docs/workload.md`, then the nearest `docs/workload.md` above the changed files, then `workload`, `SLO` or `capacity` under `docs/`, then the PR's line on where the code runs. Whatever is not found goes under Missing context with the question it would answer.

## What it holds

Numbers with their source and date. A number nobody measured is labelled as an estimate with who made it. Leave a section out rather than guess; the reviewer then reports it as missing.

```markdown
# Workload: <service or app>

Updated: <date>. Source: <dashboard, query, load test or person, per section>.

## Traffic
- Requests per second: typical <n>, peak <n> (when: <daily peak, campaign, batch window>).
- Per endpoint or job, the top few: <name> <rps or runs per hour>.
- Growth expected in the next 12 months: <x times, or none known>.

## Data
- Main tables or stores and their size: <name> <rows or GB>, growth <per month>.
- Largest single request or message: <size>; largest page or batch: <items>.

## Latency and availability targets
- SLOs: <endpoint or journey> p99 <ms>, availability <percent> over <window>.
- Timeouts imposed by callers or the platform: <load balancer, gateway, client>.

## Topology and limits
- Where it runs: <platform, regions, instance count or autoscaling range>.
- Shared limits: database connections <n>, external API rate limits <n per s>, queue concurrency <n>, memory per instance <n>.
- Dependencies and their SLAs: <name> <latency, availability>.

## Users and clients (frontends and APIs used by apps)
- Devices and networks: <share of mobile, slow networks if known>.
- Oldest client versions still in use and for how long they stay supported.
- Concurrent use: <same user in several tabs or devices, shared records edited by several people>.

## Cost envelope (optional)
- Monthly budget or unit cost target: <amount per request or user>.
```

## Keeping it current

Update the file in the same pull request that changes one of its numbers on purpose (a new endpoint, a new limit, a new SLO). A reviewer that finds a number contradicted by the diff reports it as a missing-context item, not a finding.
