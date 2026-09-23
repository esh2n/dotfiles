# LiteLLM — harness-agnostic measuring proxy

One local OpenAI-compatible gateway that every agent harness (pi / DeepSeek Harness /
codex) points its `base_url` at. It routes three tier aliases to their
providers and records **TTFT / decode tok/s / tokens / cost / prefix-cache-hit**
on a Prometheus `/metrics/` endpoint — harness-independent, so the measurement
survives swapping the harness. This is how you decide, with data, which model
belongs in each tier and whether pi or DSH is the better daily driver.

Decision record: writeup store `yoki/2026-09-16-observability-proxy-litellm`.
**This is not yoki-graph and not a workflow** — just the measurement layer.

## Tiers

| alias | provider | model | for |
|---|---|---|---|
| `main` | DeepSeek | `deepseek-flash` | everyday default, cheap/fast |
| `complex` | OpenAI | `gpt-6-astra` (Astra) | hard judgment / design |
| `deterministic` | LM Studio (local) | `qwen/qwen3.8-27b` | reproducible / offline / free |

A harness calls the proxy with `model` = one of these aliases; the proxy picks
the provider. Switch tiers by switching the alias — no per-harness provider
config.

## Keys — never on disk

`config.yaml` reads keys as `api_key: os.environ/<VAR>`. The values are
injected at launch by 1Password:

- `litellm.op-vars` holds **op:// references** (pointers, not secrets — safe to
  commit).
- `op run --env-file litellm.op-vars -- <cmd>` resolves them into the child
  process env only; plaintext never touches a file, the config, or shell
  history. Same op pattern the repo already uses in yoki-artifact
  (`op read` / secretCommand).

Confirm the vault/item coordinates in `litellm.op-vars` match your 1Password
(assumed `op://Private/{deepseek,openai,litellm}/credential`).

## Install (always-on, launchd)

The same path installs this stack and the LM Studio stack
(`domains/dev/config/lmstudio/`, the model server + sleep guard), so both are
set up identically:

1. `make link` (`core/config/manager.sh link`) symlinks this directory to
   `~/.config/litellm` and writes `com.esh2n.litellm-proxy.plist` as an
   **expanded copy** to `~/Library/LaunchAgents/` (`link_launch_agents` →
   `install_expanded` resolves the `{{HOME}}` placeholders; launchd expands
   nothing itself). Loading is never done by `make link`.
2. Once per machine, put the 1Password service-account token in the login
   Keychain under the name `litellm-op-token` (see "Interactive vs headless
   op" below; `litellm-up.sh` reads it with `security find-generic-password
   -s litellm-op-token -w`).
3. Load the job once:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.esh2n.litellm-proxy.plist`.
   Logs: `~/Library/Logs/litellm-proxy.log`.
4. On a machine without its own LM Studio, set `LM_STUDIO_REMOTE_HOST` (the
   Mac's Tailscale MagicDNS name) for the job; `litellm-up.sh` picks the local
   LM Studio when `127.0.0.1:1234` answers and that name otherwise.

After editing the plist or `litellm-up.sh`: `make link`, then
`launchctl bootout gui/$(id -u)/com.esh2n.litellm-proxy` and `bootstrap`
again. The model server itself, its login autostart and the
`caffeinate` sleep guard live in `domains/dev/config/lmstudio/README.md`.

## Run

Docker (self-contained; keys injected by op):

```sh
./start.sh
```

Proxy comes up on `http://localhost:4000`; scrape `http://localhost:4000/metrics`.
Native (pip/uv) alternative is at the bottom of `start.sh` — it avoids the
Docker `host.docker.internal` hop for the local tier.

### Interactive vs headless op

`op run` needs to unlock 1Password. Two ways:

- **Interactive (at the machine):** enable 1Password app → Settings →
  Developer → "Integrate with 1Password CLI", then `op run` gets a Touch ID
  popup. Works only when you're physically at the Mac to approve biometrics.
- **Headless (away, no biometric) — the durable path:** a **1Password service
  account token**. `op run` automatically uses `OP_SERVICE_ACCOUNT_TOKEN` when
  it's in the env, with no prompt — so `./start.sh` runs unattended and
  "being away from the machine" stops blocking it. One-time setup (do it once,
  at the machine):
  1. Create a service account at `1password.com` → Developer → Service
     Accounts, granting **read-only** access to just the vault holding these
     keys (e.g. a dedicated `LLM-Keys` vault, per the api-key-management
     design — scope it narrow, per-machine tokens).
  2. Store the token itself where the shell can read it at launch WITHOUT
     op (it's the bootstrap secret): the macOS Keychain, or your shell's
     secret store. Do **not** commit it and do **not** put it in
     `litellm.op-vars`.
  3. Export it before running: `export OP_SERVICE_ACCOUNT_TOKEN="$(<keychain
     read>)"` then `./start.sh`. `op` resolves the op:// refs headlessly.

  Note: the service-account token is the one secret that can't itself come
  from op (chicken-and-egg), so it lives in the OS keychain. Everything else
  (the provider keys) stays as op:// references.

Pin the image tag first: check the latest stable at
`github.com/BerriAI/litellm/pkgs/container/litellm` and set `LITELLM_IMAGE` in
`start.sh` (the `v1.90.2` there is a placeholder).

## Point a harness at it

Each harness just sets its OpenAI base_url to the proxy and uses a tier alias as
the model:

- **pi** — in `models.json`, add a provider with `baseUrl:
  http://localhost:4000` and models `main` / `complex` / `deterministic`
  (api key = the LITELLM_MASTER_KEY value, or any string if metrics-only).
- **DSH / codex** — set their OpenAI-compatible base_url to
  `http://localhost:4000` likewise.
- **yoki-graph** — its deepseek/local backends already honor
  `YOKI_DEEPSEEK_BASE_URL` / `YOKI_LOCAL_BASE_URL`; point those at the proxy to
  route graph lanes through the same measurement.

## Metrics

Prometheus exporter at `/metrics/` (the trailing slash matters: `/metrics`
answers 307). Key series, all measured against this proxy rather than taken from
docs: `litellm_llm_api_time_to_first_token_metric_{sum,count}` (TTFT),
`litellm_{input,output}_tokens_metric_total`, `litellm_spend_metric_total`
(cost, carries `model` and `user_agent`), `litellm_deployment_{success,failure}_responses_total`.
There is **no** `litellm_cache_hits_metric_total` — only misses — so cache-hit
behaviour has to be read from `litellm_input_cached_tokens_metric_total`.

**The numbers are unreadable straight off `/metrics/` for two reasons**: the
counters live in process memory and die on restart, and nothing tells you when a
value has moved. Both are handled by [`observability/`](observability/) —
Prometheus stores the series and Grafana plus three alert rules make them
readable:

```bash
cd ~/.config/litellm/observability && ./start.sh --ui   # then ./status.sh
```

### Metrics across machines

Every machine runs its own loopback LiteLLM; the Mac's Prometheus **pulls** each
one over the tailnet (no pusher, no app-level token — identity is tailnet
membership, narrowed by [`../tailscale/acl.hujson`](../tailscale/README.md)).
What crosses the tailnet is only LiteLLM's dedicated metrics listener
(`--prometheus_metrics_port 4001`, set in `litellm-up.sh`, loopback by default):
on a non-Mac machine run once `tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001`,
then uncomment that machine's target block in
`observability/prometheus/prometheus.yml`. The chat API on 4000 is never served.
Other people using this dotfiles are separated by the same two things: `op://`
references resolve to their own keys, and their tailnet is not yours.

For a one-off look, `curl -s localhost:4000/metrics/ | grep …` still works.
LiteLLM can also export OTel (GenAI semconv, `gen_ai.*`) to a collector; that is
an option for traces later, not something this stack uses today.

## Notes / caveats

- `deepseek-flash` isn't in LiteLLM's built-in model table, but `deepseek/`
  passes the id straight through to api.deepseek.com, which is the current id.
  If a call 404s, add `api_base: https://api.deepseek.com` to the `main` entry.
- Under Docker on a Mac, the local tier must reach the host via
  `host.docker.internal` (set in `litellm.op-vars`); native run uses
  `localhost`.
- `/metrics` is bearer-auth'd by default since v1.85.0;
  `require_auth_for_metrics_endpoint: false` in `config.yaml` opens it for
  local single-user scraping. It applies to port 4000 only; the dedicated
  4001 listener has no key auth regardless (vendor: "Permit access only from
  trusted Prometheus or collector networks"), so its reach is the tailnet ACL.
  Flip it back if port 4000 is ever exposed.
- Pure observability costs **zero extra tokens** (the proxy relays; it does not
  call a model to log). Only opt-in semantic-cache / LLM-guardrail features
  would — leave them off.
