/**
 * What the repository in front of a `UserPromptSubmit` hook is made of.
 *
 * This runs on the prompt's critical path — the hook holds the turn open while it works —
 * and it runs only when the router has ALREADY failed, so it is bounded three ways (time,
 * file count, depth) and every one of those bounds resolves to `known: false` rather than to
 * an error. "I could not tell" is an answer the fallback knows what to do with; a throw here
 * would turn a router failure into a hook failure.
 *
 * Two sources, in order:
 *
 *  1. `git ls-files` at the checkout's toplevel. It is the cheapest complete answer there
 *     is: git already has the index in memory-mappable form, it excludes everything
 *     `.gitignore` excludes (a `node_modules` of 40,000 JavaScript files does not make a
 *     Go repository look like a JavaScript one), and it needs no walk.
 *  2. A bounded `readdir` walk, for a directory that is not a checkout. Same caps, plus a
 *     skip list for the directories that hold other people's languages — `node_modules`,
 *     `vendor`, `target`, `.venv` — which is the filtering git got for free.
 *
 * The toplevel rather than the cwd: a repository's languages are the repository's, and a
 * hook fired from `docs/` would otherwise see a Markdown project.
 */

import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { type RepoSignals, UNKNOWN_SIGNALS } from "../../domain/skills/fallback-catalog";

export interface RepoSignalsOptions {
  /** Stop after this many files; the extension set has long since converged. Default 20,000. */
  readonly maxFiles?: number;
  /** Wall-clock ceiling on the whole detection, git included. Default 400ms. */
  readonly maxMs?: number;
  /** How deep the fallback walk goes below the root. Default 6. */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_MS = 400;
const DEFAULT_MAX_DEPTH = 6;

/**
 * Directories whose contents are somebody else's languages. They are only consulted on the
 * walk: inside a checkout, git's own ignore rules have already removed them, and this list
 * is not trying to be a second `.gitignore`.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".venv",
  ".tox",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "coverage",
  "__pycache__",
]);

/** One bounded `git` call, resolving to `undefined` on any failure at all. */
function git(args: readonly string[], timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => resolve(error === null ? stdout : undefined),
    );
  });
}

async function gitFiles(
  cwd: string,
  maxFiles: number,
  deadline: number,
): Promise<readonly string[] | undefined> {
  const remaining = () => deadline - Date.now();
  if (remaining() <= 0) return undefined;

  const toplevel = (await git(["-C", cwd, "rev-parse", "--show-toplevel"], remaining()))?.trim();
  if (toplevel === undefined || toplevel === "") return undefined;
  if (remaining() <= 0) return undefined;

  // `-z` rather than newlines: a path may legally contain one, and git quotes such paths in
  // the default output, which would turn a real filename into an escaped approximation.
  const listed = await git(["-C", toplevel, "ls-files", "-z"], remaining());
  if (listed === undefined) return undefined;
  return listed
    .split("\0")
    .filter((entry) => entry !== "")
    .slice(0, maxFiles);
}

async function walkFiles(
  root: string,
  maxFiles: number,
  maxDepth: number,
  deadline: number,
): Promise<readonly string[]> {
  const found: string[] = [];
  const pending: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (pending.length > 0) {
    if (found.length >= maxFiles || Date.now() >= deadline) break;
    const next = pending.shift();
    if (next === undefined) break;

    let entries: readonly Dirent[];
    try {
      entries = await readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (next.depth >= maxDepth) continue;
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        pending.push({ dir: join(next.dir, entry.name), depth: next.depth + 1 });
        continue;
      }
      // Symlinks are counted as files by name only: following one could leave the repository
      // entirely, and the name already carries the extension this is after.
      found.push(entry.name);
    }
  }

  return found;
}

function signalsFrom(files: readonly string[]): RepoSignals {
  const extensions = new Set<string>();
  const filenames = new Set<string>();
  for (const file of files) {
    const name = (file.split("/").pop() ?? file).toLowerCase();
    if (name === "") continue;
    filenames.add(name);
    const extension = extname(name);
    if (extension !== "") extensions.add(extension);
  }
  return { known: true, extensions, filenames };
}

/**
 * The repository's file signals, or `UNKNOWN_SIGNALS` when they cannot be had in the budget.
 *
 * Never throws and never rejects: every failure — no git, no checkout, an unreadable
 * directory, the deadline — is the same `known: false` answer.
 */
export async function detectRepoSignals(
  cwd: string,
  options: RepoSignalsOptions = {},
): Promise<RepoSignals> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const deadline = Date.now() + (options.maxMs ?? DEFAULT_MAX_MS);

  try {
    const tracked = await gitFiles(cwd, maxFiles, deadline);
    if (tracked !== undefined && tracked.length > 0) return signalsFrom(tracked);

    const walked = await walkFiles(cwd, maxFiles, options.maxDepth ?? DEFAULT_MAX_DEPTH, deadline);
    return walked.length === 0 ? UNKNOWN_SIGNALS : signalsFrom(walked);
  } catch {
    return UNKNOWN_SIGNALS;
  }
}
