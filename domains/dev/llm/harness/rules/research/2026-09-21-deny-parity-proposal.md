---
question: "Which of yoki's 76 deny-list patterns should be ported into jig's guard-rules, given jig's floor/forbid/ask design already covers much of the same ground?"
date: 2026-09-21
verdict: "Most yoki deny patterns are already covered by jig's existing rules or belong to the sandbox layer (file reads); the real gaps worth porting are terraform/terragrunt destroy via shell, az/gcloud/kubectl/helm destructive CLI ops (currently uncovered by jig at all), npm/cargo/deno/nuget publish, and a missing floor rule for partition tools (fdisk et al.) — plus a structural issue where sudo-prefixed dd/mkfs bypass jig's floor rules entirely because jig deliberately does not strip sudo."
unverified:
  - "secret-read-via-cli (az keyvault secret show, gcloud secrets versions access, kubectl get secrets) — exfil-via-context risk with no D-20 precedent either way, flagged not recommended"
  - "the sudo-opacity-defeats-floor structural issue — whether floor rules should also match sudo-prefixed variants of their own program list, left for adjudication"
  - "system-path Edit(/etc/**) etc. — leaning drop/sandbox, but pi has no sandbox yet, so a real timing gap exists until srt/sbx wraps pi by default"
  - "whether ~/.gcp/ is even the right path to port — gcloud's real default credential store is ~/.config/gcloud/, so yoki's own pattern may be stale or wrong"
  - "docker system prune as gate-ask is the weakest case in its bucket — local-only rather than outward-facing/infra-destroying, a borderline judgment call"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# yoki deny → jig guard-rules parity proposal

Computed against: `personal/permissions.yaml` deny list (76 patterns, lines
25-100) + `core/permissions.yaml` (allow-only, no deny — not relevant to this
gap), vs. jig's `guard-rules.json` (19 floor rules + 19 rules, read in full).
Per design-v2.md D-20, yoki is *not* the source of truth — every gate-in-jig
recommendation below is justified independently against D-18/D-19/D-20 and the
cross-tool convergence in `research-fs-net-rules.md`, not by yoki's presence
alone.

Legend for disposition: **gate-ask** / **gate-forbid** (add to guard-rules) ·
**sandbox** (D-19/D-20: belongs to the sandbox/OS layer, not the interactive
guard) · **drop** (cruft, false-positive-prone, or already covered — name the
covering rule).

## Table

| yoki pattern | risk type | disposition | proposed jig subject | reason |
|---|---|---|---|---|
| `Read(**.env)` / `Read(**.env.*)` / `Read(**/.env)` / `Read(**/.env.*)` | secret-path read | sandbox | — | D-20: "fs.read はガードで作らず sandbox 任せ" — Anthropic's own position (research doc §1/§7) is read-gating is advisory, not a boundary; jig deliberately has zero fs.read rules |
| `Read(~/.aws/credentials)` / `Read(~/.aws/config)` | secret-path read | sandbox | — | same D-20 read exemption; the *write* side of this exact path is already `forbid-cred-write/edit` |
| `Read(~/.ssh/id_*)` / `Read(~/.ssh/*_rsa)` / `Read(~/.ssh/*_ecdsa)` / `Read(~/.ssh/*_ed25519)` | secret-path read | sandbox | — | same; write side already covered by `forbid-cred-write/edit` |
| `Read(**/*.pem)` / `Read(**/*.key)` | secret-path read | sandbox | — | same D-20 exemption |
| `Read(~/.azure/**)` | secret-path read | sandbox | — | same D-20 exemption (see also Edit side below — that one IS a gap) |
| `Read(~/.gcp/**)` | secret-path read | sandbox | — | same D-20 exemption. Note: verify this is even the right path — gcloud's real default is `~/.config/gcloud/`, not `~/.gcp/`; `~/.gcp/` looks like yoki cruft/wrong-path (judgment call, see below) |
| `Bash(rm -rf /)` / `Bash(rm -rf ~)` | destructive-fs | drop | — | already covered by `floor-rm-root-home-system` (broader: also covers `$HOME`, `/etc`, `/System`, etc.) |
| `Bash(rm -rf .git)` | destructive-fs | drop (minor demotion, judgment call) | — | generic `rm-recursive-force` (ask, any `rm -rf`) already catches it; yoki had it as hard deny, jig only asks — low-priority asymmetry, not worth a named rule given `.git/hooks` (the actually-irreversible part) is already floor |
| `Bash(sudo rm *)` / `Bash(sudo passwd *)` / `Bash(sudo -i *)` / `Bash(sudo su *)` / `Bash(sudo mount *)` / `Bash(sudo umount *)` | privilege escalation | drop | — | generic `sudo` rule (ask, any `sudo|doas`) already covers every sudo invocation regardless of sub-command |
| `Bash(sudo dd *)` | destructive-disk | **see asymmetry below** | — | `floor-dd-block-device`/`floor-mkfs` only match when `dd`/`mkfs` is the *program*; since jig deliberately does not strip `sudo` (design-v2 §3.2: "権限を変える操作はそれ自体が判断対象"), `sudo dd ...` never reaches the `dd`-specific floor — only the generic `sudo` ask fires. Flagged, not resolved, below |
| `Bash(sudo mkfs *)` | destructive-disk | **see asymmetry below** | — | same mechanism as above — `floor-mkfs`'s program regex never sees past `sudo` |
| `Bash(dd *)` (bare) | destructive-disk | drop (jig is more precise, by design) | — | jig's `floor-dd-block-device` only fires on `of=/dev/...` (real block-device writes); yoki's blanket ban on all `dd` (including file-to-file copies) is the kind of false-positive-prone rule D-18 moved away from. Not a gap — jig's narrower rule is the intended improvement |
| `Bash(mkfs *)` (bare) | destructive-disk | drop | — | covered by `floor-mkfs` |
| `Bash(sudo fdisk *)` / `Bash(fdisk *)` (bare) | destructive-disk | **gate-forbid** | new floor rule, e.g. `floor-partition-tool`: `action: shell.exec`, `subject.program: "fdisk\|sfdisk\|cfdisk\|parted\|gpart"` | real gap, not just an asymmetry: jig has **no rule at all** for partition-table tools (floor-mkfs's program list is `mkfs\|mke2fs\|mkswap\|newfs\|wipefs` — fdisk/parted are absent even for the bare, non-sudo case). Partition editing is the same risk class as `mkfs` (irreversible data-loss, no legitimate everyday use in a coding-agent session) and belongs in `floor`, not just `ask` |
| `Bash(git push --force *)` / `Bash(git push -f *)` | git-destructive | drop | — | covered by `git-force-push` (forbid; regex matches both `--force` and `-f`) |
| `Bash(git reset --hard *)` | git-destructive | drop | — | covered by `git-reset-hard` (forbid) |
| `Bash(git checkout -- .)` | git-destructive | drop | — | covered by `git-checkout-dot` (forbid) |
| `Bash(git clean -fd *)` / `Bash(git clean -f *)` | git-destructive | drop | — | covered by `git-clean-force` (forbid) |
| `Bash(terraform destroy *)` | destructive-cloud | **gate-ask** | `{id: "ask-terraform-destroy-shell", action: "shell.exec", subject: {program: "terraform\|terragrunt", argv: "(?:^\|\\s)destroy\\b"}}` | **sharpest asymmetry found**: jig already gates Terraform destruction via `ask-mcp-terraform-mutation` (MCP path) but the shell CLI `terraform destroy` — the far more common way an agent actually runs Terraform — has zero coverage. Textbook destructive-but-sometimes-legitimate → ask, per your own bar |
| `Bash(terragrunt destroy *)` | destructive-cloud | **gate-ask** | (same rule as above, `terragrunt` folded into the program alternation) | terragrunt is a thin terraform wrapper; same blast radius |
| `Bash(az account clear *)` / `Bash(az logout *)` | cloud-session | drop | — | recoverable by re-login; no destructive/irreversible effect on infrastructure — doesn't meet the "real blast radius" bar |
| `Bash(az group delete *)` / `Bash(az vm delete *)` / `Bash(az storage account delete *)` | destructive-cloud | **gate-ask** | `{id: "ask-az-delete", action: "shell.exec", subject: {program: "az", argv: "\\b(?:group\\s+delete\|vm\\s+delete\|storage\\s+account\\s+delete)\\b"}}` | destroys live Azure infrastructure (resource group delete is transitively everything in it); no jig coverage of `az` at all today |
| `Bash(gcloud auth revoke *)` | cloud-session | drop | — | recoverable by re-auth, same reasoning as `az logout` |
| `Bash(gcloud projects delete *)` / `Bash(gcloud compute instances delete *)` / `Bash(gcloud sql instances delete *)` | destructive-cloud | **gate-ask** | `{id: "ask-gcloud-delete", action: "shell.exec", subject: {program: "gcloud", argv: "\\b(?:projects\\s+delete\|compute\\s+instances\\s+delete\|sql\\s+instances\\s+delete)\\b"}}` | destroys live GCP infrastructure/data; no jig coverage of `gcloud` at all today |
| `Bash(kubectl delete namespace *)` / `Bash(kubectl delete all *)` | destructive-cloud | **gate-ask** | `{id: "ask-kubectl-delete", action: "shell.exec", subject: {program: "kubectl", argv: "\\bdelete\\s+(?:namespace\|all)\\b"}}` | wipes an entire namespace or all matched resources in a live cluster; no jig coverage of `kubectl` at all today |
| `Bash(helm uninstall *)` | destructive-cloud | **gate-ask** | `{id: "ask-helm-uninstall", action: "shell.exec", subject: {program: "helm", argv: "^uninstall\\b"}}` | removes a live deployment's entire release; same class as kubectl delete |
| `Bash(az keyvault secret show *)` / `Bash(gcloud secrets versions access *)` / `Bash(kubectl get secrets *)` | secret-read-via-cli | **judgment call — flagged, no recommendation forced** | if gated: `ask`, program-specific argv matching `keyvault secret show` / `secrets versions access` / `get secrets` | these are NOT filesystem reads, so D-20's fs.read exemption doesn't cleanly apply — they're authenticated API calls whose *output* (the secret value) lands directly in the agent's transcript/context, a distinct exfiltration shape sandbox doesn't address (allowed-host network call, not a blocked path). Could argue for gate-ask on "secret enters context" grounds, or leave to sandbox's network allowlist reasoning in D-20 (net.fetch: "対話既定にはルールを作らない"). Your call — I lean gate-ask given it's a low-frequency, easy-to-name operation with real exfil consequence, but D-20 didn't consider this category (CLI secret-read, not file-read/net-fetch) so there's no precedent to cite either way |
| `Bash(npm publish *)` / `Bash(cargo publish *)` / `Bash(deno publish *)` | publish/supply-chain | **gate-ask** | `{id: "ask-package-publish", action: "shell.exec", subject: {program: "npm\|cargo\|deno", argv: "^publish\\b"}}` | textbook destructive-but-sometimes-legitimate outward-facing op — publishing to a public registry is (near-)irreversible and affects downstream consumers; exactly the shape your gate-ask bar names explicitly |
| `Bash(dotnet nuget push *)` | publish/supply-chain | **gate-ask** | `{id: "ask-nuget-push", action: "shell.exec", subject: {program: "dotnet", argv: "\\bnuget\\s+push\\b"}}` | same as above; separate rule since `dotnet` is a multi-purpose CLI (don't want to gate all of `dotnet`, only the `nuget push` subcommand) |
| `Bash(docker system prune *)` | local-destructive | **gate-ask (judgment call)** | `{id: "ask-docker-system-prune", action: "shell.exec", subject: {program: "docker", argv: "^system\\s+prune\\b"}}` | destructive and can silently delete local dev-database volumes (`-a --volumes`), but it's local-only, not outward-facing/infra-destroying like the cloud-delete group — borderline against your "real blast radius" bar; recommend gate-ask but flagging it's the weakest case in the publish/destructive-local bucket |
| `Bash(kill -9 *)` | process-kill | drop | — | already covered by `kill-force` (ask; matches `kill\|killall` with `-9`/`-KILL`/`-SIGKILL`) — this yoki pattern is a strict subset of jig's existing rule |
| (no yoki pattern — noting for completeness) `pkill` | process-kill | drop | — | already covered by jig's own `pkill` ask rule; yoki has no equivalent entry at all, so no gap either direction |
| `Edit(/etc/**)` / `Edit(/usr/**)` / `Edit(/var/**)` / `Edit(/opt/**)` / `Edit(/bin/**)` / `Edit(/sbin/**)` / `Edit(/lib/**)` / `Edit(/boot/**)` / `Edit(/proc/**)` / `Edit(/sys/**)` / `Edit(/dev/**)` | system-path edit | **sandbox (judgment call, see caveat)** | — | no source in `research-fs-net-rules.md` treats broad system-path Edit as floor or even a named deny rule — Claude Code's own floor is dotfiles/tool-config paths, not FHS system dirs; Codex/srt protect `.git`/`.codex`/`.agents`, not `/etc` etc. These paths are also hardcoded Linux/macOS FHS assumptions (non-portable) and normally require root anyway, which the sandbox's write-scoping (`allowWrite`) already confines regardless. **Caveat**: F13 says pi has *no* sandbox today and isn't wrapped by srt/sbx by default yet — until that ships, this is a real residual hole for pi specifically. I'd still lean drop/sandbox rather than porting 11 patterns of OS-specific paths into jig, but flagging the pi timing dependency explicitly for your call |
| `Edit(~/.ssh/id_*)` / `Edit(~/.ssh/*_rsa)` / `Edit(~/.ssh/*_ecdsa)` / `Edit(~/.ssh/*_ed25519)` | credential edit | drop | — | already covered by `forbid-cred-edit` (its path regex includes `\.ssh/(?:authorized_keys\|id_[^/]+\|[^/]*_(?:rsa\|ecdsa\|ed25519))`) |
| `Edit(~/.aws/credentials)` | credential edit | drop | — | already covered by `forbid-cred-edit` (`\.aws/(?:credentials\|config)`) |
| `Edit(~/.azure/**)` | credential edit | **gate-forbid** | extend `forbid-cred-write`/`forbid-cred-edit`/`forbid-cred-redirect`/`forbid-cred-shell-write` path regex to add `\|\.azure/` | genuine gap: jig's credential-file forbid list covers aws/ssh/docker/kube/gnupg/netrc/npmrc/pypirc but omits Azure CLI's credential store, which is the same risk class (writing here plants a poisoned Azure credential) |
| `Edit(~/.gcp/**)` | credential edit | **gate-forbid (verify path first — judgment call)** | extend the same forbid-cred-* rules to add gcloud's credential path | same reasoning as Azure, but check the actual path before porting: gcloud's real default credential store is `~/.config/gcloud/` (e.g. `~/.config/gcloud/credentials.db`, `~/.config/gcloud/legacy_credentials/`), not `~/.gcp/`. yoki's pattern may itself be stale/wrong — don't port it verbatim; verify against a real gcloud install before writing the rule |

## Sharpest asymmetries (flagging explicitly, per your instruction #4)

1. **Terraform destroy: MCP gated, shell CLI not.** `ask-mcp-terraform-mutation` already exists for the Terraform Cloud MCP path, but plain `terraform destroy` / `terragrunt destroy` in a shell has zero coverage — the more common invocation is the ungated one. Strongest single gate-ask candidate in this whole gap.
2. **`sudo` opacity silently defeats `floor-mkfs` / `floor-dd-block-device`.** By design (design-v2 §3.2) `sudo` is never transparently stripped — the rule sees `sudo` as the program, not `mkfs`/`dd`. That's correct for *ask*-tier rules (generic `sudo` ask still fires), but it means the two *floor* (non-bypassable) rules for formatting/wiping never actually apply once `sudo` is prepended, even though running `mkfs`/`dd`-to-block-device as root is strictly *more* dangerous than running it unprivileged. This isn't a simple "port a yoki pattern" fix — it's a structural question of whether floor rules should also match sudo-prefixed variants of their own program list. Flagging for your adjudication rather than proposing a patch.
3. **No `kubectl`/`gcloud`/`az`/`helm` coverage of any kind exists in jig today** — the whole destructive-cloud-CLI class is absent, not just under-covered. Every gate-ask recommendation in that group is a first rule for that program, not an extension of an existing one.
4. **Partition tools (`fdisk` et al.) were never in floor's `mkfs`-alias list**, even in the non-sudo case — this is a gap independent of the sudo issue above, and a straightforward floor addition.

## Short list: recommended jig guard-rules additions (what I'd turn into candidate entries)

**destructive-cloud (gate-ask)** — 4 new rules, covering 8 yoki patterns:
- `ask-terraform-destroy-shell` — `terraform|terragrunt`, argv `destroy`
- `ask-az-delete` — `az`, argv `group delete|vm delete|storage account delete`
- `ask-gcloud-delete` — `gcloud`, argv `projects delete|compute instances delete|sql instances delete`
- `ask-kubectl-delete` — `kubectl`, argv `delete (namespace|all)`
- `ask-helm-uninstall` — `helm`, argv `^uninstall`
  *(5 rules if helm counted separately — see table)*

**publish/supply-chain (gate-ask)** — 2 new rules, covering 4 yoki patterns:
- `ask-package-publish` — `npm|cargo|deno`, argv `^publish`
- `ask-nuget-push` — `dotnet`, argv `nuget push`

**local-destructive (gate-ask, judgment call)** — 1 new rule:
- `ask-docker-system-prune` — `docker`, argv `^system prune`

**disk/partition (gate-forbid, extends floor)** — 1 new floor rule:
- `floor-partition-tool` — `fdisk|sfdisk|cfdisk|parted|gpart`

**credential edit (gate-forbid, extends existing rules)**:
- add `\.azure/` (and, pending path verification, gcloud's real credential path — not `~/.gcp/`) to `forbid-cred-write` / `forbid-cred-edit` / `forbid-cred-redirect` / `forbid-cred-shell-write`'s path regex

**Flagged, not recommended one way or the other (your call)**:
- secret-read-via-cli (`az keyvault secret show`, `gcloud secrets versions access`, `kubectl get secrets`) — exfil-via-context risk, no D-20 precedent either way
- the `sudo`-opacity-defeats-floor structural issue (#2 above)
- system-path `Edit(/etc/**)` etc. — leaning drop/sandbox, but pi has no sandbox yet (F13), so there's a timing gap until srt/sbx wraps pi by default
