/**
 * Claude Code's `sandbox` block for the HOST: off.
 *
 * `rules/decisions/2026-09-30-host-claude-without-os-sandbox.md` supersedes
 * the host half of `2026-09-22-box-shape.md` ("日常は host モード(ハーネス自前の
 * サンドボックス + jig のガード)"). On the host the OS sandbox stopped work
 * the owner then had to finish by hand — `op` failing TLS under Seatbelt, no
 * writes to the main checkout the harness extensions load from,
 * `settings.json` out of reach — while the protection it added over jig's
 * guard (credential reads and writes are forbidden there) and auto mode's
 * classifier did not justify that cost. Containers keep their own sandbox
 * (`app/box/kit.ts`), unchanged.
 *
 * `enabled: false` is written rather than the key left out, so a sandbox
 * turned on by hand in settings.json is visibly jig's to turn off, and the
 * choice reads in the file (https://code.claude.com/docs/en/settings-reference
 * — `sandbox.enabled`).
 */

import type { JsonObject } from "../compose/merge";

export const HOST_SANDBOX: JsonObject = { enabled: false };
