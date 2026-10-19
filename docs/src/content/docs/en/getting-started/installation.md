---
title: Install
description: Installing and updating the dotfiles, and machine roles.
---

## Install and update

One command installs a new machine and updates an existing one; running it
again changes nothing.

```bash
cd dotfiles
make up    # = ./bootstrap.sh
```

`bootstrap.sh` installs Nix with the official multi-user installer when it
is missing and stops (exit code 2); open a new shell and run `make up` again.
With Nix present it hands over to `dotctl up`, which:

1. checks the roles file (below)
2. removes the broken links the old layout left behind
3. builds and switches the configuration: nix-darwin on macOS, home-manager on Linux
4. runs the steps Nix cannot declare (`dotctl setup`)
5. makes zsh the login shell and installs mise's runtimes

## Roles file

Which roles a machine takes lives in an untracked, machine-local file,
`~/.config/dotfiles/roles.json`. Without it `dotctl up` stops and shows an
example.

```json
{"roles": ["developer", "desk-user", "model-provider", "observer"]}
```

| Role | What it adds |
|------|--------------|
| (every machine) | shell, CLI tools, app configs |
| `developer` | language tooling, the local LiteLLM, jig's decision service |
| `desk-user` | GUI apps, fonts, media tools |
| `model-provider` | lends local models on the tailnet: LM Studio on macOS, llama-server on Linux + NVIDIA |
| `observer` | Prometheus, Grafana, Open WebUI and the AI cost ledger (one machine) |

## Where packages come from

| Kind | Where |
|------|-------|
| CLI tools, language servers | the flake (`home/*/packages*`) |
| GUI apps | Homebrew casks declared by nix-darwin (`system/darwin/homebrew.nix`) |
| Language runtimes | mise |

After changing any of them, run `make up`.
