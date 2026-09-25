# DeepSeek Harness (dsh) — second front, measured

DSH is the second daily-driver front (alongside pi), pointed at the same local
LiteLLM proxy so both run through one measurement plane and the better one is
chosen with data. Developer preview (MIT), so expect breaking changes.

## How it fits

```
dsh (front)  ─┐
pi  (front)  ─┼─→ LiteLLM proxy :4000 ─→ main=deepseek / complex=astra / deterministic=local
             ─┘        (measures TTFT / tok/s / cost / prefix-hit for both fronts)
```

DSH holds **only the proxy's key** (`LITELLM_API_KEY`); the DeepSeek/OpenAI
provider keys live on the proxy. So no provider secret lands in DSH config.

## Files

| File | Role |
|---|---|
| `settings.yaml` | model/provider settings → symlink to `~/.dsh/settings.yaml`. One `local-proxy` route (OpenAI-compatible → `:4000`) with 3 models (`main`/`complex`/`deterministic`, matching the LiteLLM aliases). Re-read per request. |
| `dsh.op-vars` | op:// reference for the proxy key (pointer, not a secret) |
| `start-dsh.sh` | `op run --env-file dsh.op-vars -- npx @deepseek-ai/dsh web` |

## Run (after the LiteLLM proxy is up on :4000)

```sh
./start-dsh.sh          # web UI at http://127.0.0.1:3080
```

Config home is `$DSH_HOME` (default `~/.dsh`). Links are managed by
`core/config/manager.sh link_dsh_resources` (run `manager.sh link dev` from
the MAIN checkout — it refuses worktrees): `settings.yaml` →
`~/.dsh/settings.yaml`, and `profiles/<name>/cordis.patch.yml` into each
profile dsh has already scaffolded (the patch pins the default model to
`local-proxy`/`main`, since dsh-base otherwise starts sessions on
deepseek-official directly, bypassing the proxy). Keys resolve from the
inherited env first, so `op run` injection wins and never touches
`~/.dsh/.credentials.yaml`.

Remote from a phone = SSH tunnel to `127.0.0.1:3080` (no cloud). Sessions are
event-sourced JSONL server-side, so phone↔PC continuity is "both hit the same
`dsh web` over the tunnel."

## jig plugin

Both profiles (`profiles/proxy/cordis.patch.yml`, `profiles/headless/cordis.patch.yml`)
compose jig's own cordis plugin, `@esh2n/jig-dsh-guard`
(`harness/jig/adapters/dsh`, built by `make update`). It
subscribes four DSH events, so dsh gets what Claude Code, pi and omp get:

| DSH event | what runs | file |
|---|---|---|
| `agent/pre-step` | skill selection: a human's message goes to jig's judgment service (`/skill`); a match is appended as one message naming the SKILL.md. `DSH_SKILL_ROUTER=off` turns it off | `src/skill.ts` |
| `tools/pre-execute` | the guard, the same evaluator and policy as every other harness | `src/index.ts` |
| `tools/post-execute` | format the file `write` / `edit` / `str_replace_editor` wrote, silently | `src/format.ts` |
| `agent/turn-stopping` | typecheck/lint (the project's hooks first); a failure is steered back, at most twice per session | `src/gate.ts` |

The section below describes the bridge the plugin replaced; `hooks.claude.json`
is still installed but no profile composes the bridge.

### Before the plugin: the Claude Code bridge

`hooks.claude.json` wires dsh into jig's PreToolUse hook via the official
`@deepseek-ai/dsh-hooks-claude-code` bridge, so dsh reads the same shared
guard policy (`harness/policy/guard-rules.json`) through the
same evaluator as pi's `extensions/guard.ts` and Claude Code's hook. The
cordis row (id: `hooks-claude`, in both `profiles/proxy/cordis.patch.yml`
and `profiles/headless/cordis.patch.yml`) points `configPath` at
`~/.dsh/hooks.claude.json`, installed there by `link_dsh_resources`
(`install_expanded`: a copy with `{{DOTFILES_ROOT}}` resolved, not a
symlink). The command is
`bun .../jig/src/cli/jig.ts hooks pre-tool-use --harness dsh` with a 10s
`timeout`; `--harness dsh` stamps who is asking on every judgment.

Verified against the bridge's source (2026-09-21): the matcher is split on
`|` and compared to tool names exactly (dsh's are `bash`, `write`, `edit`,
`str_replace_editor`); the payload is Claude Code's shape
(`tool_name`/`tool_input`/`session_id`/`cwd`); `hook.timeout` is honored.
Two things to know: the bridge treats a crashed or overrunning hook as no
opinion (fails open), and `str_replace_editor` sends `path` rather than
`file_path` — jig reads both.

Redeploy after editing: `make link`, or run `link_dsh_resources` from the
**main checkout** (manager.sh recomputes `DOTFILES_ROOT` from its own
location, so sourcing it from a worktree writes a wrong path). Either way
the function ends with `jig apply --target dsh --write`, which delivers
jig's MCP rows and `$DSH_HOME/AGENTS.md` after the expanded copies land.
The main checkout's jig needs `bun install --frozen-lockfile` once.

## Confirm at first run (unverified points)

- **`baseURL` suffix** — `http://localhost:4000/v1` vs bare `:4000`. If model
  calls 404 on `/chat/completions`, flip it. (LiteLLM serves both in most
  setups.)
- **The 3 model `id`s** must match the LiteLLM `model_name` aliases exactly
  (`main`/`complex`/`deterministic`).
- **Install** — `npx @deepseek-ai/dsh web` is documented; a global
  `npm i -g @deepseek-ai/dsh` is plausible but unverified. Node `^22.19 || >=24`.
- **Model picker** — selection is Web-UI-driven (Settings → Models); a `/model`
  slash command was not found in the docs.
- **op item coordinate** in `dsh.op-vars` is assumed (`op://Private/litellm/...`)
  — same key as the proxy's master key; fix if your item name differs.

## Not yet done

Install + first run + wiring `~/.dsh/settings.yaml` all need the machine (op
unlock + the proxy running). This scaffold is config-only, uncommitted until
reviewed/tested.
