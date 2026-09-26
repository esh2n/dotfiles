import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Micro-compaction for the pi tiers. Adapted from
// earlyaidopters/marks-pi-harness (MIT).
//
// The window and the compaction limit are two different things, and this file
// owns the second one. models.json declares the window the model actually has
// (DeepSeek Flash and V4 Pro both report 1M through the proxy), so pi's own
// token accounting stays honest. How much of that window a session may carry
// before we compact is an operational choice, and it is made here. Codex CLI
// splits the same two knobs (model_context_window vs
// model_auto_compact_token_limit); Claude Code calls the second one the
// auto-compact window.
//
// Tool results are capped at creation time (full text goes to a spill file the
// agent can grep): at ~8 tok/s local decode and ~120 tok/s cold prefill, an
// oversized result is paid for again on every later turn.

const CAP_CHARS = 30_000; // ~7.5k tokens per tool result max
const SPILL_DIR = join(homedir(), ".local", "state", "pi", "spill");

// Compaction limit per model, in tokens. Models not listed fall back to
// COMPACT_AT_FRACTION of their declared window.
const COMPACT_AT_TOKENS: Record<string, number> = {
  main: 200_000, // DeepSeek Flash — ~2x the 105k effective limit before this
  complex: 500_000, // DeepSeek V4 Pro — room for a large design consultation
};
const COMPACT_AT_FRACTION = 0.8;

let spillCount = 0;
let compacting = false;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    try {
      mkdirSync(SPILL_DIR, { recursive: true });
    } catch {
      /* exists */
    }
  });

  pi.on("tool_result", async (event) => {
    const content = (event as any).result?.content;
    if (!Array.isArray(content)) return;
    let changed = false;
    for (const block of content) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      if (block.text.length <= CAP_CHARS) continue;
      const file = join(SPILL_DIR, `${Date.now()}-${++spillCount}.txt`);
      try {
        writeFileSync(file, block.text);
      } catch {
        continue;
      }
      block.text =
        block.text.slice(0, CAP_CHARS) +
        `\n\n[output capped at ${CAP_CHARS} of ${block.text.length} chars. ` +
        `Full output saved to ${file} — grep/read that file for the rest. ` +
        `Restate any facts you need from this output in your reply; it may be compacted away later.]`;
      changed = true;
    }
    if (changed) return { result: (event as any).result };
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const usage = ctx.getContextUsage();
    const model = ctx.model;
    if (!usage?.tokens || !model) return;
    const limit =
      COMPACT_AT_TOKENS[model.id] ?? Math.round(model.contextWindow * COMPACT_AT_FRACTION);
    const frac = usage.tokens / limit;
    ctx.ui.setStatus("ctx", `ctx ${(frac * 100).toFixed(0)}%/${Math.round(limit / 1_000)}k`);
    if (frac >= 1 && !compacting && ctx.isIdle()) {
      compacting = true;
      ctx.ui.notify(
        `Context at ${usage.tokens.toLocaleString()} tokens (limit ${limit.toLocaleString()}) — compacting proactively…`,
        "info",
      );
      ctx.compact({
        onComplete: () => {
          compacting = false;
          ctx.ui.notify("Compaction done.", "info");
        },
        onError: () => {
          compacting = false;
        },
      });
    }
  });
}
