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

## Guard hook (Phase 1 guard-policy unification)

`hooks.claude.json` wires dsh into jig's own PreToolUse hook via the official
`@deepseek-ai/dsh-hooks-claude-code` bridge — the third front (alongside
Claude Code and pi) to read the single shared guard policy at
`domains/dev/llm/harness/policy/guard-rules.json`. The cordis row (id:
`hooks-claude`, added to both `profiles/proxy/cordis.patch.yml` and
`profiles/headless/cordis.patch.yml`) points `configPath` at
`~/.dsh/hooks.claude.json`, symlinked there by `link_dsh_resources`. That
file's `PreToolUse` command runs
`bun .../domains/dev/llm/harness/jig/src/cli/jig.ts hooks pre-tool-use` — the
same evaluator Claude Code's hook and pi's `extensions/guard.ts` use.

## Confirm at first run (unverified points)

- **The hooks-claude bridge itself** — unverified end to end: whether
  `@deepseek-ai/dsh-hooks-claude-code` expects `hooks.claude.json`'s
  top-level `hooks.PreToolUse` shape (mirrors Claude Code's own
  `settings.json`) or something else, whether dsh's bash tool is literally
  named `Bash` (the `matcher` value) or differently, and what field names
  dsh's own PreToolUse payload carries — jig's hook expects
  `tool_name`/`tool_input`, Claude Code's convention. Fix
  `hooks.claude.json` and the `matcher` once dsh's actual hook payload is
  seen.
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
