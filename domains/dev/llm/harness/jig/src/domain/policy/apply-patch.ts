/**
 * codex's `apply_patch` hands the hook one string: the whole patch. Judged
 * as one opaque call, a policy about paths would never see the files
 * inside it, so every write rule would fail open for codex. This module
 * reads the patch envelope (only the `*** Add File` / `*** Update File` /
 * `*** Delete File` / `*** Move to` headers; the hunks themselves are not
 * needed) and fans it out into one file operation per header, which the
 * evaluator judges as `fs.write` / `fs.edit` like any other harness's
 * write. The strictest verdict wins. yoki's codex bridge did the same
 * (its `payload.js`); this is that precedent in the core, where every
 * harness benefits from it.
 */

import type { ToolCall } from "../hooks/decision";

export interface PatchFileOperation {
  readonly kind: "add" | "update" | "delete" | "move";
  readonly path: string;
  /** For a move: where the file ends up. */
  readonly to?: string;
}

const HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+?)\s*$/;

/** The file operations a patch declares, in order. Empty when the text is not a patch. */
export function patchOperations(patch: string): readonly PatchFileOperation[] {
  const ops: PatchFileOperation[] = [];
  for (const line of patch.split("\n")) {
    const m = HEADER.exec(line);
    if (m === null) continue;
    const [, header = "", path = ""] = m;
    switch (header) {
      case "Add File":
        ops.push({ kind: "add", path });
        break;
      case "Update File":
        ops.push({ kind: "update", path });
        break;
      case "Delete File":
        ops.push({ kind: "delete", path });
        break;
      case "Move to": {
        // `*** Move to:` follows the `*** Update File:` it renames.
        const last = ops.at(-1);
        if (last !== undefined && last.kind === "update") {
          ops[ops.length - 1] = { kind: "move", path: last.path, to: path };
        }
        break;
      }
    }
  }
  return ops;
}

/** Is this call codex's apply_patch, and if so, its patch text? */
export function applyPatchText(call: ToolCall): string | undefined {
  if (call.tool !== "apply_patch") return undefined;
  for (const key of ["command", "patch", "input"]) {
    const value = call.input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * The tool calls a patch amounts to, in the vocabulary every harness's
 * writes already use: a new file is a `Write`, a changed file an `Edit`, a
 * deletion a `Write` of its path (the closest thing a path rule can judge),
 * a move a `Write` at the destination plus an `Edit` at the source.
 */
export function fanOut(patch: string): readonly ToolCall[] {
  const calls: ToolCall[] = [];
  for (const op of patchOperations(patch)) {
    switch (op.kind) {
      case "add":
      case "delete":
        calls.push({ tool: "Write", input: { file_path: op.path } });
        break;
      case "update":
        calls.push({ tool: "Edit", input: { file_path: op.path } });
        break;
      case "move":
        calls.push({ tool: "Edit", input: { file_path: op.path } });
        if (op.to !== undefined) calls.push({ tool: "Write", input: { file_path: op.to } });
        break;
    }
  }
  return calls;
}
