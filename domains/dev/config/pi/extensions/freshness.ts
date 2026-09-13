import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { resolve } from "node:path";

// File-freshness guard for the local 27B lane.
// Adapted from earlyaidopters/marks-pi-harness (MIT). Small local models'
// single most common failure class is editing from a stale memory of a file;
// this blocks that structurally instead of asking the model to be careful.
//
// Three guards, all zero resident-context cost (pure hooks):
//  1. edits to a file whose mtime moved since the agent last read it → block
//  2. any failed edit marks the file stale until it is re-read → block
//  3. the 3rd identical tool call in a row → block (no-op loop breaker)

const lastRead = new Map<string, number>();
const editFailed = new Set<string>();

let lastCallKey = "";
let repeatCount = 0;

function mtime(path: string): number | null {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    lastRead.clear();
    editFailed.clear();
    lastCallKey = "";
    repeatCount = 0;
  });

  pi.on("tool_result", async (event) => {
    const name = (event as any).toolName;
    const input = (event as any).input;
    const raw = input?.path ?? input?.file_path ?? input?.filePath;
    if (!raw) return;
    const abs = resolve(String(raw));
    const isError = (event as any).result?.isError === true;
    if (name === "edit" && isError) {
      editFailed.add(abs);
      return;
    }
    if (name === "read" || name === "write" || (name === "edit" && !isError)) {
      const m = mtime(abs);
      if (m !== null) lastRead.set(abs, m);
      editFailed.delete(abs);
    }
  });

  pi.on("tool_call", async (event) => {
    const key = event.toolName + JSON.stringify(event.input ?? {});
    if (key === lastCallKey) {
      if (++repeatCount >= 3) {
        repeatCount = 0;
        return {
          block: true,
          reason:
            "You have made this exact tool call 3 times in a row — repeating it will not change the outcome. " +
            "Step back: re-read the file or error, form a different hypothesis, and try a different approach.",
        };
      }
    } else {
      lastCallKey = key;
      repeatCount = 1;
    }

    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const input = event.input as any;
    const raw = input?.path ?? input?.file_path ?? input?.filePath;
    if (!raw) return;
    const path = resolve(String(raw));

    if (event.toolName === "edit" && editFailed.has(path)) {
      return {
        block: true,
        reason:
          `Your previous edit to ${path} FAILED to match — your memory of this file is stale. ` +
          `Read the region you are editing first, then re-apply the edit using the exact current text. ` +
          `Do not guess at whitespace from memory.`,
      };
    }

    const known = lastRead.get(path);
    const current = mtime(path);
    if (known === undefined || current === null) return; // new file or never read — allow
    if (current > known) {
      return {
        block: true,
        reason:
          `${path} changed on disk after you last read it (external edit or another process). ` +
          `Read it again first, then re-apply your change against the current content.`,
      };
    }
  });
}
