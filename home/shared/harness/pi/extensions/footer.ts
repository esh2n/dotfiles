import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// footer — the same status line Claude Code shows (harness/scripts/statusline.sh),
// drawn the way pi draws one: a `ctx.ui.setFooter` component, not a script.
//
// Owner's ruling (2026-09-27): every harness shows the same content in its own
// native form (rules/research/2026-09-27-statusline-across-harnesses.md — only
// Claude Code runs an external script; pi replaces its footer from an
// extension). Two lines:
//
//   <model>:<thinking>  📁 <dir>  🔀 <branch>  <extension statuses>
//   ▰▰▰▱▱▱▱▱▱▱ 31% of 200k | ⏱ 12m | 💰$0.1234
//
// The extension statuses carry the tier (tier-router's `setStatus("tier", …)`)
// and anything else an extension reports. pi gives no dirty/ahead/behind data
// to a footer, so the branch is the name alone.
//
// Resident cost: nothing sent to the model; the footer is rebuilt on render.

export interface FooterData {
  readonly model?: string;
  readonly thinking?: string;
  readonly cwd: string;
  readonly branch?: string | null;
  readonly statuses: readonly string[];
  readonly contextPercent?: number | null;
  readonly contextWindow?: number;
  readonly costUsd: number;
  readonly startedAt: number;
  readonly now: number;
}

const BAR = 10;

export function contextBar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * BAR);
  return "▰".repeat(filled) + "▱".repeat(BAR - filled);
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "<1m";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h${m % 60}m`;
}

/** The footer's two lines, before colour and truncation. */
export function footerLines(d: FooterData): [string, string] {
  const model =
    d.model === undefined
      ? "no model"
      : d.thinking && d.thinking !== "off"
        ? `${d.model}:${d.thinking}`
        : d.model;
  const first = [model, `📁 ${basename(d.cwd) || d.cwd}`];
  if (d.branch) first.push(`🔀 ${d.branch}`);
  if (d.statuses.length > 0) first.push(d.statuses.join(" · "));
  const second: string[] = [];
  if (d.contextPercent !== undefined && d.contextPercent !== null) {
    const window = d.contextWindow ? ` of ${Math.round(d.contextWindow / 1000)}k` : "";
    second.push(`${contextBar(d.contextPercent)} ${Math.round(d.contextPercent)}%${window}`);
  }
  second.push(`⏱ ${duration(d.now - d.startedAt)}`);
  second.push(`💰$${d.costUsd < 0.01 ? d.costUsd.toFixed(4) : d.costUsd.toFixed(2)}`);
  return [first.join("  "), second.join(" | ")];
}

/** The session's spend: every assistant message's own cost, as pi's built-in footer adds it up. */
export function sessionCost(entries: readonly unknown[]): number {
  let total = 0;
  for (const entry of entries) {
    const e = entry as {
      type?: string;
      message?: { role?: string; usage?: { cost?: { total?: unknown } } };
    };
    const cost =
      e.type === "message" && e.message?.role === "assistant"
        ? e.message.usage?.cost?.total
        : undefined;
    if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
  }
  return total;
}

export default function (pi: ExtensionAPI) {
  let startedAt = Date.now();

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    startedAt = Date.now();
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      // the duration moves once a minute; nothing else here changes on its own
      const timer = setInterval(() => tui.requestRender(), 30_000);
      (timer as { unref?: () => void }).unref?.();
      return {
        dispose() {
          unsubscribe();
          clearInterval(timer);
        },
        invalidate() {},
        render(width: number): string[] {
          const usage = ctx.getContextUsage();
          const [first, second] = footerLines({
            model: ctx.model?.id,
            thinking: pi.getThinkingLevel(),
            cwd: ctx.cwd,
            branch: footerData.getGitBranch(),
            statuses: [...footerData.getExtensionStatuses().entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => text),
            contextPercent: usage?.percent,
            contextWindow: usage?.contextWindow,
            costUsd: sessionCost(ctx.sessionManager.getEntries()),
            startedAt,
            now: Date.now(),
          });
          const line = (text: string, colour: string) =>
            truncateToWidth(theme.fg(colour, text), width);
          return visibleWidth(second) > 0
            ? [line(first, "accent"), line(second, "dim")]
            : [line(first, "accent")];
        },
      };
    });
  });
}
