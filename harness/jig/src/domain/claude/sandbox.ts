/**
 * Claude Code's `sandbox` block for the HOST, per
 * `rules/decisions/2026-09-22-box-shape.md` ("日常は host モード(ハーネス自前の
 * サンドボックス + jig のガード)").
 *
 * It is the same block `app/box/kit.ts` merges into settings.json inside a
 * box, minus `network.allowedDomains`: that list exists in the box because the
 * box's own network permissions are narrowed to the same set, and the two
 * layers have to agree. On the host there is no outer layer to agree with, and
 * an allowlist here would be a second, unreviewed network policy.
 *
 * Read against https://code.claude.com/docs/en/sandboxing.md:
 *
 * - `enabled` — "The sandbox is built into Claude Code and runs on macOS,
 *   Linux, and WSL2 … On macOS, there is nothing to install: sandboxing uses
 *   the built-in Seatbelt framework."
 * - `failIfUnavailable` — "By default, if the sandbox cannot start because
 *   dependencies are missing or the platform is unsupported, Claude Code shows
 *   a warning and runs commands without sandboxing. To make this a hard
 *   failure instead, set sandbox.failIfUnavailable to true." The doc's own
 *   hardened example sets it, and on macOS there is no dependency that can go
 *   missing, so `true` costs nothing here and closes the silent fallback.
 * - `allowUnsandboxedCommands: false` — "Claude Code ignores the
 *   dangerouslyDisableSandbox escape hatch, so when a command fails under the
 *   sandbox, Claude can't retry it unsandboxed."
 * - `excludedCommands: []` — written explicitly, empty. The doc lists real
 *   macOS casualties of that emptiness (see KNOWN_MACOS_EXCLUSION_CANDIDATES);
 *   the list stays empty until one of them actually bites, and the empty array
 *   is in the file so that adding one is an edit to a visible key rather than
 *   the discovery of a missing one.
 *
 * `autoAllowBashIfSandboxed` is left at its default (`true`, per the doc), so
 * sandboxed commands keep running without a prompt — which is the point of
 * turning the sandbox on next to `permissions.defaultMode: "auto"`.
 */

import type { JsonObject } from "../compose/merge";

/**
 * What the sandboxing doc says breaks under Seatbelt on macOS with an empty
 * `excludedCommands` and no unsandboxed retry. Not written into settings —
 * surfaced in the dry-run so the operator meets the trade-off before
 * `--write`, rather than the first time `gh` fails.
 */
export const KNOWN_MACOS_EXCLUSION_CANDIDATES: readonly string[] = [
  "docker * — 'docker is incompatible with the sandbox'",
  "gh / gcloud / terraform — Go-based CLIs 'may fail TLS verification under Seatbelt'",
  "open / osascript — Apple Events are blocked by default (error -600)",
];

/**
 * `policy/sandbox.json` — the one field of the block that is a decision rather
 * than a constant.
 *
 * It lives in `policy/` with the guard rules because it is the same kind of
 * thing: a list the owner maintains and no agent may edit (the floor rules
 * `floor-policy-write` / `floor-policy-edit` cover the whole directory). The
 * generator copies `excludedCommands` verbatim and decides nothing about it.
 */
export interface SandboxSource {
  readonly excludedCommands: readonly string[];
}

/** Parses `policy/sandbox.json`. Strict: a malformed list is an error, not an empty one. */
export function parseSandboxSource(json: unknown, label: string): SandboxSource {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  const { excludedCommands } = json as { excludedCommands?: unknown };
  if (excludedCommands === undefined) {
    throw new Error(`${label}: missing "excludedCommands" (write [] for none)`);
  }
  if (
    !Array.isArray(excludedCommands) ||
    excludedCommands.some((entry) => typeof entry !== "string" || entry === "")
  ) {
    throw new Error(`${label}: "excludedCommands" must be an array of non-empty strings`);
  }
  return { excludedCommands: excludedCommands as string[] };
}

/**
 * What jig uses when `policy/sandbox.json` does not exist yet. Empty is the
 * tightest possible answer — every command stays sandboxed — so a missing
 * source can only over-restrict, never over-permit. The apply says so out
 * loud rather than letting the default pass for a decision.
 */
export const NO_SANDBOX_SOURCE: SandboxSource = { excludedCommands: [] };

/**
 * The host-mode `sandbox` value. Three fixed fields and one copied list; no
 * part of it is derived from the destination file.
 */
export function hostSandbox(source: SandboxSource): JsonObject {
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    excludedCommands: [...source.excludedCommands],
  };
}
