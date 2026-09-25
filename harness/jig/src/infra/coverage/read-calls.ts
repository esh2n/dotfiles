/**
 * Reading the two facts coverage reconciliation needs off disk: what jig
 * audited, and what the harnesses recorded.
 *
 * Only Claude Code and codex are read here, and on purpose: their per-call
 * id in the transcript is the same id their hook hands jig (`tool_use_id` /
 * `call_id`, confirmed against the hooks docs and the codex schema), so a
 * match is exact. pi's transcript id is a composite whose relationship to
 * the guard extension's `event.toolCallId` is not yet confirmed, and DSH's
 * transcript is zstd-compressed — reading either without confirming the id
 * shape would manufacture false gaps, so they are left to the app layer to
 * report as "not reconciled", not guessed at here.
 */

import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AuditedCall, RecordedCall } from "../../domain/coverage/reconcile";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read the guard audit log, one judgment per line, since a cutoff. */
export async function readAudit(path: string, since: Date): Promise<AuditedCall[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: AuditedCall[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (entry === undefined) continue;
    const principal = asRecord(entry.principal);
    const at = typeof entry.ts === "string" ? entry.ts : "";
    if (principal === undefined || at === "" || new Date(at) < since) continue;
    const harness = typeof principal.harness === "string" ? principal.harness : "unknown";
    const sessionId = typeof principal.sessionId === "string" ? principal.sessionId : "";
    const decision = entry.decision;
    if (sessionId === "" || (decision !== "allow" && decision !== "deny" && decision !== "ask")) {
      continue;
    }
    out.push({
      harness,
      sessionId,
      ...(typeof principal.callId === "string" ? { callId: principal.callId } : {}),
      tool: typeof entry.tool === "string" ? entry.tool : "",
      decision,
      at,
    });
  }
  return out;
}

async function jsonlFiles(root: string, since: Date): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".jsonl")) {
        try {
          if ((await stat(full)).mtime >= since) out.push(full);
        } catch {}
      }
    }
  }
  await walk(root);
  return out;
}

/** Claude Code: `~/.claude/projects/<slug>/<session>.jsonl`, `tool_use` blocks. */
export async function readClaudeCalls(projectsRoot: string, since: Date): Promise<RecordedCall[]> {
  const out: RecordedCall[] = [];
  for (const file of await jsonlFiles(projectsRoot, since)) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const entry = asRecord(safeParse(line));
      if (entry === undefined) continue;
      const message = asRecord(entry.message);
      const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
      const at = typeof entry.timestamp === "string" ? entry.timestamp : "";
      if (message === undefined || sessionId === "" || at === "" || new Date(at) < since) continue;
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const raw of content) {
        const block = asRecord(raw);
        if (block?.type !== "tool_use" || typeof block.id !== "string") continue;
        out.push({
          harness: "claude",
          sessionId,
          callId: block.id,
          tool: typeof block.name === "string" ? block.name : "",
          at,
        });
      }
    }
  }
  return out;
}

const CODEX_SESSION_UUID =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/** codex: `~/.codex/sessions/.../rollout-*.jsonl`, `custom_tool_call` payloads. */
export async function readCodexCalls(sessionsRoot: string, since: Date): Promise<RecordedCall[]> {
  const out: RecordedCall[] = [];
  for (const file of await jsonlFiles(sessionsRoot, since)) {
    const sessionId = CODEX_SESSION_UUID.exec(file)?.[1];
    if (sessionId === undefined) continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const entry = asRecord(safeParse(line));
      const payload = asRecord(entry?.payload);
      if (payload?.type !== "custom_tool_call" || typeof payload.call_id !== "string") continue;
      const at = typeof entry?.timestamp === "string" ? entry.timestamp : "";
      if (at === "" || new Date(at) < since) continue;
      out.push({
        harness: "codex",
        sessionId,
        callId: payload.call_id,
        tool: typeof payload.name === "string" ? payload.name : "",
        at,
      });
    }
  }
  return out;
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
