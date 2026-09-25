# tailscale — the tailnet policy for the home-LLM ports

`acl.hujson` is the tailnet policy file for the setup in
`harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`.
It lets the owner's own devices reach each other on every port (the owner
also runs SSH, screen sharing and more over the tailnet — ruling 2026-09-23)
and nobody else reach anything. The home-LLM traffic it must carry: LM Studio
on the Mac (`tcp:1234`) from the other machines' LiteLLM, each machine's
LiteLLM metrics listener (`tcp:4001`) from the Mac's Prometheus, and Open
WebUI on the Mac (`tcp:3001`, HTTPS via `tailscale serve --https` because a
PWA install needs a real certificate) from the phone. LiteLLM's chat API
(4000) is never served on the tailnet at all, and neither is LM Studio's own
container port 8080 (Open WebUI is the only thing that talks to it, over
loopback inside the same Mac) — those guarantees live in what `tailscale
serve` publishes, not in this file.

## Where it lives

Tailscale reads the policy from the **admin console**, not from this repo. This
file is the source: `make tailscale-acl` fills the placeholders from
`tailscale status`, copies the result to the clipboard and opens the page to
paste it into (`paste-acl.sh`); or run it through GitOps — `tailscale/gitops-acl-action` commits it as `policy.hujson`,
runs `test` on pull requests and `apply` on push to main
(<https://tailscale.com/kb/1204/gitops-acls>). Nothing here installs it; there
is no `link_*` step for it.

## Before pasting

- It **replaces the default allow-all** with own-devices-only, all ports.
  A port-enumerating variant is kept commented in the file for the day the
  ruling narrows.
- `tests` carry placeholders (`owner@example.com`, `mac.example.ts.net`);
  `make tailscale-acl` substitutes the owner's login and the Mac's Tailscale
  IP.
- The rules bind to `tailscale serve` traffic like any other service
  (<https://tailscale.com/kb/1312/serve>), which is why serving a port with
  `--tcp` is safe only together with this file.

## The three `serve` commands it governs

| Machine | Once | Opens |
|---|---|---|
| the Mac | `tailscale serve --bg --tcp 1234 tcp://127.0.0.1:1234` | LM Studio (`next/home/darwin/lmstudio/config/`) |
| the Mac | `tailscale serve --bg --https=3001 127.0.0.1:3001` | Open WebUI, the phone's chat page (`next/home/shared/litellm/config/observability/`) |
| every non-Mac machine | `tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001` | LiteLLM metrics only (`next/home/shared/litellm/config/litellm-up.sh`) |

Then uncomment that machine's target in
`next/home/shared/litellm/config/observability/prometheus/prometheus.yml`.

Syntax: <https://tailscale.com/kb/1018/acls>, <https://tailscale.com/kb/1324/grants>,
<https://tailscale.com/kb/1337/acl-syntax>.
