import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Blast-radius guard for the local lane — the pi-side counterpart of yoki's
// git-guard.sh (hooks are Claude Code-only; pi needs its own enforcement).
// Adapted from earlyaidopters/marks-pi-harness (MIT), rules aligned with
// the yoki git conventions.
//
// Two tiers:
//  - HARD: never allowed, no confirmation offered (yoki NEVER rules)
//  - CONFIRM: destructive enough to require interactive approval;
//    denied by default when running headless

const HARD: Array<{ re: RegExp; why: string }> = [
  { re: /\bgit\s+push\b(?=.*\b(main|master)\b)/, why: "pushing to main/master is forbidden (yoki git conventions)" },
  { re: /\bgit\s+push\s+[^|;&]*(--force|\s-f\b)/, why: "force push is forbidden (yoki git conventions)" },
  { re: /--no-verify\b/, why: "bypassing hooks is forbidden — fix the failure instead" },
  { re: /\blms\s+load\b/, why: "loading a second model would exhaust unified memory on this machine" },
  { re: /\bmlx_vlm\.server|mlx-vlm.*serve/, why: "second model server — can exhaust memory and crash this machine" },
];

const CONFIRM: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, why: "recursive force delete" },
  { re: /\bgit\s+reset\s+--hard\b/, why: "discards uncommitted work" },
  { re: /\bgit\s+clean\s+-[a-z]*f/, why: "deletes untracked files" },
  { re: /\bkill(all)?\b.*-9|\bpkill\b/, why: "force-killing processes" },
  { re: /\bsudo\b/, why: "privilege escalation" },
  { re: /curl[^|]*\|\s*(ba|z)?sh|wget[^|]*\|\s*(ba|z)?sh/, why: "piping remote script to shell" },
  { re: /\bchmod\s+-R\s+777\b/, why: "world-writable permissions" },
  { re: /\b(mkfs|diskutil\s+erase|dd\s+.*of=\/dev)/i, why: "disk-level destruction" },
  { re: /\b(shutdown|reboot|halt)\b/, why: "system power control" },
  { re: /rm\s+[^|;&]*(package-lock\.json|\.lock\b)/, why: "deleting lock files to silence errors" },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" && event.toolName !== "bash_background") return;
    const cmd: string = (event.input as any)?.command ?? "";

    for (const rule of HARD) {
      if (!rule.re.test(cmd)) continue;
      return {
        block: true,
        reason:
          `Blocked: ${rule.why}. This is a hard rule — do not retry or work around it with a variant. ` +
          `State what you wanted to do and why, and let the user decide.`,
      };
    }

    for (const rule of CONFIRM) {
      if (!rule.re.test(cmd)) continue;
      let ok = false;
      try {
        ok = await ctx.ui.confirm(`Guarded command (${rule.why})`, cmd.slice(0, 300));
      } catch {
        ok = false; // headless: deny by default
      }
      if (!ok) {
        return {
          block: true,
          reason:
            `Blocked: ${rule.why}. Do not retry this command or work around the block with a variant. ` +
            `Explain to the user what you wanted to do and why, and let them decide.`,
        };
      }
      return; // user approved this one call — approval is not blanket
    }
  });
}
