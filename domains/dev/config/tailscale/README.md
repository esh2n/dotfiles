# tailscale — the tailnet policy for the home-LLM ports

`acl.hujson` is the tailnet policy file for the setup in
`domains/dev/llm/harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`:
LM Studio on the Mac (`tcp:1234`) reachable from the owner's other machines, and
each machine's LiteLLM dedicated metrics listener (`tcp:4001`) reachable from the
Mac's Prometheus. Nothing else is opened; LiteLLM's chat API (4000) is never
served on the tailnet at all.

## Where it lives

Tailscale reads the policy from the **admin console**, not from this repo. This
file is the source: paste it into Access controls after editing, or run it
through GitOps — `tailscale/gitops-acl-action` commits it as `policy.hujson`,
runs `test` on pull requests and `apply` on push to main
(<https://tailscale.com/kb/1204/gitops-acls>). Nothing here installs it; there
is no `link_*` step for it.

## Before pasting

- It **replaces the default allow-all**. Add whatever else the devices need
  (SSH, etc.) to the same file — a second commented grant keeps full
  own-device reachability if that is wanted.
- `tests` carry placeholders (`owner@example.com`, `mac.example.ts.net`);
  substitute the owner's login and the Mac's MagicDNS name or Tailscale IP, or
  drop the block. The `deny` on `:4000` is the assertion worth keeping.
- The rules bind to `tailscale serve` traffic like any other service
  (<https://tailscale.com/kb/1312/serve>), which is why serving a port with
  `--tcp` is safe only together with this file.

## The two `serve` commands it governs

| Machine | Once | Opens |
|---|---|---|
| the Mac | `tailscale serve --bg --tcp 1234 tcp://127.0.0.1:1234` | LM Studio (`domains/dev/config/lmstudio/`) |
| every non-Mac machine | `tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001` | LiteLLM metrics only (`domains/dev/config/litellm/litellm-up.sh`) |

Then uncomment that machine's target in
`domains/dev/config/litellm/observability/prometheus/prometheus.yml`.

Syntax: <https://tailscale.com/kb/1018/acls>, <https://tailscale.com/kb/1324/grants>,
<https://tailscale.com/kb/1337/acl-syntax>.
