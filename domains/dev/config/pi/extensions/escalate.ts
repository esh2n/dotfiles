import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";

// /escalate — defer a hard decision to the frontier `consult` role WITHOUT
// blocking pi or auto-spending. This ENQUEUES a pending record into the same
// yoki-graph escalation queue that `yoki-graph escalate list|run` reads; it
// never calls a frontier model, so it needs no API key here. A human later
// runs `yoki-graph escalate run <id>`, which is the gate and the spend
// authorization.
//
// Resident cost 0: a slash command only, no registerTool and no per-turn
// injection — safe for this lane's 1K-token budget (README "1K-token budget").
//
// Display/queue logic lives in the yoki repo (scripts/lib/graph/escalate.js),
// resolved via $YOKI_ROOT then the default dotfiles checkout — same pattern as
// yoki-graph-widget.ts. A machine without yoki gets a quietly disabled
// command (one stderr line), never a throw into pi's extension loader.

type EscalateRecord = { id: string; role: string; status: string; question: string };
type EscalateLib = {
  enqueue: (input: Record<string, unknown>, env?: NodeJS.ProcessEnv) => EscalateRecord;
  list: (env?: NodeJS.ProcessEnv, opts?: { status?: string }) => EscalateRecord[];
};

function loadEscalateLib(): EscalateLib | null {
  const roots: string[] = [];
  const fromEnv = process.env.YOKI_ROOT;
  if (fromEnv && fromEnv.trim()) roots.push(fromEnv.trim());
  roots.push(join(
    homedir(),
    "go", "github.com", "esh2n", "dotfiles",
    "domains", "dev", "config", "claude-profiles", "runtime", "yoki",
  ));
  for (const root of roots) {
    const libDir = join(root, "scripts", "lib", "graph");
    try {
      if (!fs.existsSync(join(libDir, "escalate.js"))) continue;
      const req = createRequire(join(libDir, "_pi-escalate-loader.js"));
      return req("./escalate.js") as EscalateLib;
    } catch (err) {
      console.error(`pi /escalate disabled: failed to load ${libDir} (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  }
  console.error("pi /escalate disabled: yoki graph lib not found (set YOKI_ROOT or keep the default dotfiles path)");
  return null;
}

export default function (pi: ExtensionAPI) {
  const lib = loadEscalateLib();
  if (!lib) return; // quietly disabled — pi still starts

  pi.registerCommand("escalate", {
    description: "Defer a decision to the frontier consult queue (usage: /escalate <question> | /escalate list)",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim();
      if (text === "list") {
        const pending = lib.list(process.env, { status: "pending" });
        if (!pending.length) { ctx.ui.notify("No pending escalations.", "info"); return; }
        const lines = pending.map((r) => {
          const q = r.question.length > 60 ? `${r.question.slice(0, 57)}...` : r.question;
          return `${r.id} [${r.role}] ${q}`;
        });
        ctx.ui.notify(`Pending escalations:\n${lines.join("\n")}`, "info");
        return;
      }
      if (!text) {
        ctx.ui.notify("Usage: /escalate <question>  (or /escalate list). Enqueues for the frontier consult role; run `yoki-graph escalate run <id>` to answer.", "info");
        return;
      }
      try {
        const rec = lib.enqueue({ question: text, role: "consult", source: "pi" }, process.env);
        ctx.ui.notify(`Escalated to ${rec.role} (${rec.id}). It does NOT block you and spends nothing yet — a human runs \`yoki-graph escalate run ${rec.id}\` to get the frontier answer.`, "info");
      } catch (err) {
        ctx.ui.notify(`Escalate failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}
