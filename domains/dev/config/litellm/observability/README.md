# observability — making the gateway's numbers usable

Prometheus + Grafana in front of the local LiteLLM gateway (`../`).

The gateway already exposes 64 metric families on `127.0.0.1:4000/metrics/`. Those
numbers were unreadable for two separate reasons, and this stack exists to fix
both:

1. **They died on every restart.** LiteLLM keeps counters in process memory. A
   restart reset spend, tokens and request counts to zero, so nothing could ever
   be compared against anything. Prometheus stores them, which is the whole
   point: a model swap is only judgeable against the weeks before it.
2. **Nobody was told anything.** A metric you have to remember to go and look at
   is not a signal. The three alert rules in `prometheus/alerts.yml` carry their
   own "what to do next" text, and `status.sh` prints the same numbers in one
   screen.

## Where this sits

| Layer | What it is | Who measures |
|---|---|---|
| agent harness | pi / Claude Code / Codex / DSH / omp | no |
| **LLM gateway** | **LiteLLM on `127.0.0.1:4000`** | **this stack reads its `/metrics/`** |
| model providers | DeepSeek Flash / DeepSeek V4 Pro / local Qwen | no |

Measurement lives at the gateway rather than inside a harness on purpose: every
harness talks to this one boundary, so the numbers survive a harness swap. That
also means the harness that sent a request has to be recovered from a label —
which works, because it is there (`user_agent`).

### The other spender: the judgment service

The `jig` judgment service has two modes (`typesafe-client.ts`). In DIRECT mode
it calls jev at `api.typesafe.ai`, bypassing this gateway. In PROXY mode — the
live deployment, `JIG_JEV_BASE_URL` pointed at the gateway's `/typesafe` — the
calls transit this gateway (route `/typesafe/v1/systemone`,
`api_provider="typesafe"`), so they DO appear under the `litellm` job; they carry
`user_agent="jig-judgment"` so they stay separable from real harnesses rather
than pooling under `none`.

Either way, jig also exposes its own `/metrics` on `127.0.0.1:4100`, scraped by
the `jig` job in `prometheus/prometheus.yml`; the dashboard is
<http://127.0.0.1:3000/d/jig-judgments>.

| Metric | What it answers |
|---|---|
| `jig_judgment_tokens_total{kind,model,direction}` | What the judgment model costs, per endpoint and model. `kind` is what makes the two decisions separately justifiable: a per-prompt tier judgment and a per-compaction judgment are paid for by different things |
| `jig_judgment_requests_total{kind,outcome}` | How often a harness asks, and whether the answer came back (`provider_error` = the model did not answer) |
| `jig_judgment_seconds{kind}` | How long a judgment takes — this is the latency a harness waits for |
| `jig_tier_decisions_total{tier,source}` | Which tier came back, and whether the judgment decided it or fell back because it was unsure (`source="fallback"`). The fallback rate is the number to watch: a routing that never decides is money spent to keep the default |
| `jig_compaction_items_total{decision}` | How many items a compaction judgment kept or dropped. All-kept means the judgment ran and selected nothing |

Each judgment also writes one line to the service log (`~/Library/Logs/jig-decision.log`): `judgment.tier` carries tier, source, confidence and seconds; `judgment.compact` carries how many items were judged and dropped; `judgment.failed` carries the endpoint and status when a judgment could not be made. The log is per event, the metrics are per period — a report of "routing chose badly at 14:20" needs the former, "is this getting worse" needs the latter.

The numbers come from the same registry the service's usage hook fills, so a
scrape and a log line can never disagree. They are process-local and reset when
launchd restarts the service (a deploy, a crash); Prometheus storing them is what
makes a restart comparable to the weeks before it.

## Run it

```bash
cd ~/.config/litellm/observability     # the deployed copy; this is what runs
./start.sh            # Prometheus only — the half that stores data
./start.sh --ui       # also Grafana — the half that only displays
./status.sh           # one-screen summary; exit 1 if an alert is firing
./stop.sh             # stop both; stored history is kept
```

- Dashboard: <http://127.0.0.1:3000/d/litellm-gateway>
- Judgment service: <http://127.0.0.1:3000/d/jig-judgments>
- Raw numbers: <http://127.0.0.1:9090/graph>
- Scrape health: <http://127.0.0.1:9090/targets>

Prometheus is resident (`restart: unless-stopped`) because it is the component
that loses data if it is down: the gateway's counters are in memory, so an hour
without scraping is an hour that cannot be recovered. Grafana stores nothing, so
it is behind the `ui` profile and costs nothing to leave off.

Both ports bind `127.0.0.1`. Reaching the gateway's metrics from inside a
container goes through OrbStack's `host.docker.internal` proxy — measured, not
assumed: a container returns 200 from `http://host.docker.internal:4000/metrics/`
even though the gateway is published to loopback only.

## Source, deployed copy, and drift

The definitions are **copied** to `~/.config/litellm/observability`, the same way
the gateway next door is deployed. The reason is different, though: the gateway
is deployed because it injects a secret, while this stack is deployed because the
container mounts must outlive the checkout they were edited in (this stack was
written in a git worktree, and worktrees get deleted).

A copy can drift, so the deploy command checks:

```bash
./deploy.sh           # copy this checkout over the deployed copy
./deploy.sh --check   # exit 1 if they differ
```

**Edit in the repo, then `./deploy.sh`.** The long-term fix is a symlink instead
of a copy; that is part of what the jig rebuild is for.

## What is measured, and the axes to read it by

| Axis | Label | Answers |
|---|---|---|
| requested alias | `requested_model` | was `main` / `complex` / `deterministic` actually used? |
| served model | `model` | which real model answered |
| harness | `user_agent` | which agent harness sent it (`pi (darwin …)`, …) |
| time | — | did a change help or hurt |

Today's baseline, measured while writing this: 359 successful requests, 32.9M
input / 0.49M output tokens, $1.09 total spend, TTFT mean ≈ 0.71 s. `complex` has
served 1 request and `deterministic` has served 0 — the higher and local tiers are
wired but unused, so "is DeepSeek V4 Pro good enough" is still an open question
that only measurement can answer.

## The three alerts

| Alert | Fires when | Threshold rationale |
|---|---|---|
| `DailyCostHigh` | rolling 24h spend > **$5** | measured baseline is ≈ $0.5/day, so this is ~10x — a real change in usage or a pricier model, not noise |
| `FailureRateHigh` | failure rate > **5%** for 15m, with at least 3 requests in that window | the traffic floor stops 1 failure out of 1 quiet-night request reading as 100% |
| `TTFTDegraded` | mean TTFT > **3 s** *and* > **2x** the trailing 24h baseline | the floor stops a fast baseline from making a 0.4s → 0.9s wobble fire; the ratio stops a fixed threshold from going stale if latency drifts |

**These thresholds are provisional.** They come from the single baseline above and
should be re-derived after a week of real traffic. `./status.sh` prints the
current values, which is the cheapest way to see whether a threshold is still in
the right place.

Tuning one:

```bash
vim ~/.config/litellm/observability/prometheus/alerts.yml   # or the repo copy, then ./deploy.sh
curl -X POST http://127.0.0.1:9090/-/reload                 # no restart needed
```

A fourth rule (`GatewayDown`, `up{job="litellm"} == 0`) is written but commented
out at the bottom of `alerts.yml` — it is the most actionable signal this stack
has, and it was outside the three that were asked for.

### The rules are tested, not just loaded

```bash
./test.sh
```

`promtool test rules` feeds synthetic counter series into the real rule file and
asserts **both directions**: that each alert fires, and that its guard condition
holds it back. The guard cases are the ones worth having — a 50% failure rate on
0.02 requests/min must stay quiet, or every quiet night reads as an outage. Each
run also re-checks the syntax and prints what the *running* Prometheus actually
loaded. `prometheus/alerts.test.yml` is that test, and the pinned annotation
strings mean a change to what an alert says is a deliberate change there too.

### Reading it without a browser

`./status.sh` prints the same numbers in one screen: scrape health, 24h cost and
requests, failure rate, TTFT against its baseline, per-alias and per-model
breakdowns, and any firing alert with its "what to do next" line. Exit code 1
when something is firing, so it can be used as a check rather than a read-out.

## Known limitations (measured, not guessed)

- **Restarting the gateway resets its counters.** `increase()` detects the reset
  and adds the pre-reset portion, but up to one scrape interval (15 s) around the
  restart is lost. Long-run totals are only trustworthy from Prometheus, not from
  the gateway's own "cumulative spend" panel.
- **Failure counters carry empty labels.** `litellm_deployment_failure_responses_total`
  comes back with `requested_model=""` and `user_agent="None"`, so failure rate
  can only be computed globally. Which model failed has to come from
  `~/Library/Logs/litellm-proxy.log`. (3 failures are recorded at present, all
  with empty labels — likely startup-time noise, and the reason the rate alert
  needs a traffic floor.)
- **The cache-hit ratio panel contradicts itself.** Cumulative cached tokens
  (33,875,072) exceed cumulative input tokens (32,920,135) — over 100%. LiteLLM's
  `input_tokens` and the provider's cache-hit tokens are not counting the same
  population. Do not judge anything on that panel alone; it is there so the
  inconsistency stays visible.
- **`TTFTDegraded` cannot fire for the first 24h**, because the baseline window
  is empty. No data means no alert, which is the safe direction.
- **Daily-traffic numbers cannot compare models.** Traffic differs in difficulty
  from hour to hour, so "complex is slower" from this dashboard is a correlation.
  A same-task comparison needs the bench in `../bench/` (fixed prompts, several
  model ids, temperature 0), which measures TTFT, decode speed and reproducibility
  side by side. Use the dashboard for trends and the bench for causes.
- **A permanent slowdown eventually stops firing `TTFTDegraded`** once the 24h
  baseline catches up. Catching slow erosion is the dashboard's job, not the
  rule's.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Prometheus (resident) + Grafana (behind the `ui` profile) |
| `prometheus/prometheus.yml` | one scrape job against the gateway, 15s |
| `prometheus/alerts.yml` | the three rules, each with its rationale and its next action |
| `prometheus/alerts.test.yml` | synthetic-series tests: fires when it should, quiet when a guard applies |
| `grafana/provisioning/` | datasource + dashboard provider, both from files |
| `grafana/dashboards/litellm-gateway.json` | 13 panels: cost, speed, failures, tokens |
| `start.sh` / `stop.sh` / `status.sh` | run it, stop it, read it |
| `test.sh` | verify the rules: syntax, behaviour, and what is loaded live |
| `deploy.sh` | copy to `~/.config/litellm/observability`, `--check` for drift |

Grafana runs with anonymous read-only access and no login form (a single-user
loopback service), so there is no default password to leak. Dashboards come from
the JSON files, not from Grafana's database.

**To edit a dashboard in the UI instead**, temporarily allow it: set
`allowUiUpdates: true` in `grafana/provisioning/dashboards/dashboards.yml`, drop
`GF_AUTH_DISABLE_LOGIN_FORM`, restart Grafana, and log in as `admin`/`admin`.
Be aware of who wins: the file is the source of truth, and Grafana re-applies it
whenever the file content changes, so a UI edit survives only until the JSON in
the repo is next touched. Export UI changes back into the repo file and revert
the two settings.
