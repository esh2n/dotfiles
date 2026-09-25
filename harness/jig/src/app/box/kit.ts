/**
 * The sbx kit a box is launched with, rendered at launch and never installed
 * as a file.
 *
 * It is a *fork* of a built-in agent (`kind: sandbox`, `extends: claude`),
 * not a mixin, and that is the whole point. Read out of the sbx v0.43.0
 * binary with `strings`, the built-in kits launch:
 *
 *   claude:  entrypoint: [claude, "--dangerously-skip-permissions"]
 *   codex:   entrypoint: [codex, "--dangerously-bypass-approvals-and-sandbox"]
 *
 * That is the "yolo inside the box" the decision record rejects, and no
 * amount of editing `settings.json` or `config.toml` reaches it, because the
 * entrypoint is an argv, not a setting. A mixin cannot fix it either — the
 * kit reference is explicit: a mixin "must not declare a `sandbox:` block,
 * `extends:`, or `mixins:`". Docker documents the fix as forking:
 *
 *   "Use `extends:` to inherit the parent's complete configuration and
 *    declare only the fields you want to change. … The child inherits the
 *    built-in image, credentials, network permissions, persistent volumes,
 *    settings, MCP integration, agent instructions, setup entries, and
 *    environment variables. Its `sandbox.entrypoint` replaces the inherited
 *    entrypoint."
 *   — https://docs.docker.com/ai/sandboxes/customize/kit-examples.md
 *
 * Neither parent declares `sandbox.command`, so replacing `entrypoint` is
 * enough; there is no inherited argument tail to restate. (Were there one:
 * "For a kit that uses `extends:`, `sandbox.command` replaces the full
 * inherited argument tail … Define every argument the child needs." —
 * https://docs.docker.com/ai/sandboxes/customize/kit-reference.md)
 *
 * The rest of the decision record still holds: jig's config enters as static
 * files under `files/home/`, no credentials enter at all (the posture kit, a
 * mixin stacked on top with `--kit`, is the only place a GitHub token is
 * granted), and Claude Code's own sandbox stays on inside the VM as a second
 * layer under the microVM boundary.
 *
 * Pure: a map of relative path -> content. Writing it to a directory is the
 * adapter's job, so this is testable without a filesystem.
 */

export type BoxAgent = "claude" | "codex";

/** Every built-in sbx agent jig can fork today. */
export const BOX_AGENTS: readonly BoxAgent[] = ["claude", "codex"];

/** Fork kits are named `jig-<agent>`, which is what `sbx ls --json` then reports as the agent. */
export const JIG_KIT_PREFIX = "jig-";

/** The built-in agent behind a box, given whatever `sbx ls` called it. */
export function normalizeAgent(agent: string): string {
  return agent.startsWith(JIG_KIT_PREFIX) ? agent.slice(JIG_KIT_PREFIX.length) : agent;
}

/** Where jig itself lands inside the box. */
export const JIG_HOME = "/home/agent/.local/share/jig";

/**
 * What the box is allowed to reach. The parent kit's own allowances are
 * inherited (api.anthropic.com and friends), so this list is only what jig
 * adds: the apt mirrors and npm registry its install steps need. It is also
 * the list Claude Code's own sandbox is given below, so the two layers agree
 * instead of one silently blocking what the other permits.
 */
export const BOX_NETWORK_ALLOW: readonly string[] = [
  // apt on arm64 Ubuntu resolves to ports.ubuntu.com, not archive.
  "ports.ubuntu.com",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  // The base image has node and npm but no bun, so bun comes from npm.
  "registry.npmjs.org",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
];

/** The PreToolUse matcher jig's guard is registered under inside the box. */
const CLAUDE_HOOK_MATCHER = "Bash|Read|Write|Edit|MultiEdit|WebFetch";

/** Everything after the bun binary in the hook command; the binary is resolved at install. */
const CLAUDE_HOOK_TAIL = `${JIG_HOME}/src/cli/jig.ts hooks pre-tool-use --harness claude`;

export interface RenderAgentKitInput {
  readonly agent: BoxAgent;
  /**
   * jig's own source, relative path -> content: `package.json`, `bun.lock`,
   * `tsconfig.json` and `src/**` only. No `node_modules` (the box installs
   * its own, for its own platform) and no `test/`.
   */
  readonly jigSource: Readonly<Record<string, string>>;
  /** The guard policy, verbatim, as the JSON text jig's hook parses. */
  readonly guardRules: string;
  /** Agent instructions, placed at whichever file this agent reads. */
  readonly instructions: string;
}

function yamlList(items: readonly string[], indent: string): string {
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

/** Indent a block scalar's body under a YAML key. */
function block(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}${line}`))
    .join("\n");
}

/**
 * Turn Claude Code's own sandbox on and register jig's guard, by merging into
 * `~/.claude/settings.json` rather than shipping it as a static file: that
 * path is written by the parent kit's own install step, and a static file over
 * it is either overwritten or overwrites the agent's own provisioning. Merging
 * keeps both, and is written to be idempotent so a re-create converges.
 *
 * `bun` is resolved to an absolute path here, not written as a bare word: the
 * hook runs in whatever environment Claude Code hands it, which is not a
 * login shell and carries no promise about PATH. If bun is missing the step
 * fails loudly instead of writing a hook that silently never runs — a guard
 * that cannot execute is worse than no guard, because it looks like one.
 *
 * `permissions.defaultMode` is brought in line with the entrypoint too. The
 * parent kit's image ships `bypassPermissions` there (observed in a live box),
 * and while the `--permission-mode auto` on the command line wins for the
 * session, leaving the file saying otherwise is a contradiction anyone
 * reading it — or any code path consulting it — would trip on.
 */
function claudeSettingsScript(): string {
  const domains = BOX_NETWORK_ALLOW.map((domain) => `"${domain}"`).join(", ");
  return `import json, os, shutil, sys
bun = shutil.which("bun")
if bun is None:
    print("jig: bun not found — guard NOT registered")
    sys.exit(1)
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
s.setdefault("permissions", {})["defaultMode"] = "auto"
s["sandbox"] = {
  "enabled": True,
  "failIfUnavailable": True,
  "allowUnsandboxedCommands": False,
  "network": {"allowedDomains": [${domains}]},
}
entry = {
  "matcher": ${JSON.stringify(CLAUDE_HOOK_MATCHER)},
  "hooks": [{"type": "command", "timeout": 10, "command": bun + " " + ${JSON.stringify(CLAUDE_HOOK_TAIL)}}],
}
hooks = s.setdefault("hooks", {})
kept = [g for g in hooks.get("PreToolUse", []) if g.get("matcher") != entry["matcher"]]
hooks["PreToolUse"] = [entry] + kept
json.dump(s, open(p, "w"), indent=2)
print("jig: claude sandbox on, guard registered via " + bun)
`;
}

/**
 * Codex's own sandbox level, below the entrypoint flag.
 *
 * The parent kit's install writes `approval_policy = "never"` and
 * `sandbox_mode = "danger-full-access"` into `~/.codex/config.toml`
 * unconditionally on every create (read out of the sbx binary, and observed
 * in a live box). Both are flipped here.
 *
 * `approval_policy` is not cosmetic: `--approve-for-me` "routes approval
 * requests through automatic review", and under `never` the model never
 * raises one, so there is nothing to route and the flag does nothing.
 * `on-request` ("the model decides when to ask the user for approval", from
 * `codex --help`'s `--ask-for-approval` values) is what gives the automatic
 * review something to answer — unattended, but not unasked.
 *
 * `jig codex register --write` is also what persists hook trust. Codex
 * "requires you to review and trust the exact hook definition … Codex
 * records trust against the hook's current hash"
 * (https://learn.chatgpt.com/docs/hooks, where developers.openai.com/codex/hooks
 * redirects), and the interactive route is `/hooks`. jig already writes the
 * non-interactive equivalent — `[hooks.state."<hooks.json>:pre_tool_use:0:0"]`
 * with `trusted_hash` and `enabled = true` — see `domain/codex/register.ts`.
 * So `--dangerously-bypass-hook-trust` is NOT on the entrypoint: the trust is
 * real and per-definition, not bypassed.
 *
 * This runs at startup rather than install because the parent's install
 * rewrites config.toml on every create, which would wipe a trust block
 * written earlier in the same phase.
 */
function codexSetupScript(): string {
  return `set -eu
config="\${CODEX_HOME:-$HOME/.codex}/config.toml"
if [ -f "$config" ]; then
  sed -i 's/danger-full-access/workspace-write/g' "$config"
  sed -i 's/^approval_policy = "never"/approval_policy = "on-request"/' "$config"
  sed -i 's/^# This configuration enables "yolo mode".*/# Reset by jig: workspace-write sandbox, approvals on request./' "$config"
  grep -q '^\\[sandbox_workspace_write\\]' "$config" ||
    printf '\\n[sandbox_workspace_write]\\nnetwork_access = true\\n' >> "$config"
fi
bun ${JIG_HOME}/src/cli/jig.ts codex register --write
`;
}

/**
 * Everything jig does inside the box, as `setup.install` steps.
 *
 * All of it is install, none of it is startup, and that is deliberate. sbx's
 * own claude kit says why, in a comment beside the same choice: "Install
 * commands are synchronous container PostStart hooks that complete during
 * create, BEFORE the CLI attaches and launches the interactive `claude`
 * session. Registering here (rather than only in commands.startup) closes a
 * race: startup commands are delivered to /etc/durable-startup.d and fired by
 * a DETACHED dispatcher". Measured: with the guard registration in startup,
 * `sbx create` returned with no `hooks` key in settings.json at all, and it
 * appeared only on the next probe — so an agent attaching immediately would
 * have run its first tool calls unguarded.
 *
 * The parent's own writes (settings.json, config.toml) are install steps too,
 * and the child's run after them — verified by the merged result surviving.
 * Everything here is written to be idempotent anyway.
 */
function jigInstall(steps: readonly string[]): string {
  return `setup:
  install:
${steps.join("")}`;
}

/** apt, bun, and jig's dependencies — the steps both forks share. */
function bunSteps(): string {
  return `    - command: npm install -g bun
      description: The base image has node 22 and npm but no bun, and jig is a bun program.
    - command: ln -sf "$(npm prefix -g)/bin/bun" /usr/local/bin/bun
      description: >-
        npm's global bin is NOT on the PATH that agent hooks get. Measured
        inside a box, "env -i sh -c 'bun --version'" exits 127, while
        /usr/local/bin is on that bare PATH. Without this symlink the guard's
        hook command cannot be resolved — which is exactly what happened the
        first time.
    - command: chown -R 1000:1000 /home/agent/.local/share/jig /home/agent/.config/jig
      description: Static files arrive root-owned; the agent user has to be able to install into them.
    - command: cd ${JIG_HOME} && bun install --frozen-lockfile
      user: "1000"
      description: >-
        Resolve jig's dependencies before the agent can make a tool call, so
        the guard is never the thing that is still installing.
`;
}

function claudeSpec(): string {
  return `schemaVersion: "2"
kind: sandbox
name: jig-claude
extends: claude
displayName: Claude Code under jig's guard
description: >-
  A fork of the built-in claude agent that does not bypass approvals.
  Rendered at launch, never installed as a file, so the kit always matches
  the caller's checkout.

# Why a fork and not a mixin: the built-in kit's entrypoint is
# [claude, "--dangerously-skip-permissions"], and only sandbox.entrypoint
# replaces it. A mixin "must not declare a sandbox: block, extends:, or
# mixins:" (kit-reference), so a mixin cannot reach the argv at all.
#
# "The child inherits the built-in image, credentials, network permissions,
#  persistent volumes, settings, MCP integration, agent instructions, setup
#  entries, and environment variables. Its sandbox.entrypoint replaces the
#  inherited entrypoint." — docs.docker.com/ai/sandboxes/customize/kit-examples
#
# The parent declares no sandbox.command, so there is no inherited argument
# tail to restate here.
#
# No credentials are declared: the posture kit (guarded / connected), stacked
# with --kit, is the only mixin that grants any. SSH agent forwarding is not a
# kit setting at all — it is the machine-wide ssh.agentForwardingEnabled,
# which the launcher checks and refuses to create against rather than
# flipping behind its user.

sandbox:
  # auto, not bypassPermissions: the guard below judges what it knows about,
  # and Claude Code's own classifier is left to judge the rest. A hook "deny"
  # is honored in every permission mode, so the guard would hold under bypass
  # too — but everything the guard does not judge would not be asked about.
  entrypoint: [claude, "--permission-mode", "auto"]

permissions:
  network:
    allow:
${yamlList(BOX_NETWORK_ALLOW, "      ")}

${jigInstall([
  `    - command: apt-get update && apt-get install -y bubblewrap socat
      description: >-
        What Claude Code's own Bash sandbox needs on Linux. The microVM is the
        boundary; this is the second layer under it, enabled below.
`,
  bunSteps(),
  `    - command: |
        python3 - <<'JIG_PY'
${block(claudeSettingsScript(), "        ")}
        JIG_PY
      user: "1000"
      description: >-
        Merge into ~/.claude/settings.json — a path the parent kit writes in
        its own install step, so it is edited here rather than shipped as a
        static file. Turns Claude Code's own sandbox on (fail-closed) and puts
        jig's guard in front of its tools, with bun resolved to an absolute
        path. Install, not startup: startup is a detached dispatcher and the
        agent does not wait for it.
`,
])}`;
}

function codexSpec(): string {
  return `schemaVersion: "2"
kind: sandbox
name: jig-codex
extends: codex
displayName: Codex under jig's guard
description: >-
  A fork of the built-in codex agent that does not bypass its own sandbox.
  Rendered at launch, never installed as a file, so the kit always matches
  the caller's checkout.

# Why a fork and not a mixin: the built-in kit's entrypoint is
# [codex, "--dangerously-bypass-approvals-and-sandbox"], and only
# sandbox.entrypoint replaces it. A mixin "must not declare a sandbox: block,
# extends:, or mixins:" (kit-reference), so a mixin cannot reach the argv.
#
# "The child inherits the built-in image, credentials, network permissions,
#  persistent volumes, settings, MCP integration, agent instructions, setup
#  entries, and environment variables. Its sandbox.entrypoint replaces the
#  inherited entrypoint." — docs.docker.com/ai/sandboxes/customize/kit-examples
#
# The parent declares no sandbox.command, so there is no inherited argument
# tail to restate here.
#
# No credentials are declared: the posture kit (guarded / connected), stacked
# with --kit, is the only mixin that grants any. SSH agent forwarding is the
# machine-wide ssh.agentForwardingEnabled, which the launcher refuses against
# rather than flipping behind its user.
#
# Nothing apt-installed beyond bun: codex has no second-layer sandbox of its
# own to feed, so the VM boundary plus workspace-write is the whole story.

sandbox:
  # --approve-for-me: "Route approval requests through automatic review using
  # the workspace-write sandbox" (codex --help). Unattended like the built-in
  # entrypoint, but inside codex's own sandbox rather than outside it.
  # --dangerously-bypass-hook-trust is deliberately NOT here: jig persists
  # real hook trust in config.toml (see the install step).
  entrypoint: [codex, "--approve-for-me"]

permissions:
  network:
    allow:
${yamlList(BOX_NETWORK_ALLOW, "      ")}

${jigInstall([
  bunSteps(),
  `    - command: |
${block(codexSetupScript(), "        ")}
      user: "1000"
      description: >-
        ~/.codex/config.toml is written by the parent kit's own install step,
        so this runs after it and edits in place: drop danger-full-access and
        approval_policy "never", then register jig's guard AND persist its
        hook trust. Install, not startup: startup is a detached dispatcher and
        codex does not wait for it.
`,
])}`;
}

/** Relative path, inside the kit, of the file this agent reads instructions from. */
function instructionsPath(agent: BoxAgent): string {
  return agent === "claude" ? "files/home/.claude/CLAUDE.md" : "files/home/.codex/AGENTS.md";
}

export function renderAgentKit(input: RenderAgentKitInput): Record<string, string> {
  const files: Record<string, string> = {
    "spec.yaml": input.agent === "claude" ? claudeSpec() : codexSpec(),
    "files/home/.config/jig/policy/guard-rules.json": input.guardRules,
    [instructionsPath(input.agent)]: input.instructions,
  };
  for (const [relative, content] of Object.entries(input.jigSource)) {
    files[`files/home/.local/share/jig/${relative}`] = content;
  }
  return files;
}
