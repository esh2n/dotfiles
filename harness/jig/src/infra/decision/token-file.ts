/**
 * The judgment service's bearer token: a shared secret both the service and its
 * callers read from one 0600 file. This defends against another local user
 * reaching the loopback service (it cannot read the token) or calling it
 * directly; same-uid malware can already read anything this account can, so
 * defending against it is explicitly out of scope.
 *
 * Filesystem-only, no framing about what the token is used for — that is
 * `serve.ts`'s job on the server side and `http-decision-client.ts`'s on the
 * client side.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_TOKEN_FILE = join(homedir(), "Library/Application Support/jig/decision.token");

/** Where the token file lives: `JIG_DECISION_TOKEN_FILE`, else the default path. */
export function tokenFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.JIG_DECISION_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
}

/**
 * Server-side: the token to require, generating and persisting one on first
 * run. An existing non-empty file is reused as-is, so restarting the service
 * does not invalidate the token every running consumer already holds.
 */
export async function ensureDecisionToken(path: string): Promise<string> {
  const existing = await readFile(path, "utf8").catch(() => undefined);
  const reused = existing?.trim();
  if (reused !== undefined && reused !== "") return reused;

  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, token, { mode: 0o600 });
  return token;
}

/**
 * Client-side: the token if the file exists and is readable, else `undefined`.
 * Never throws — a caller with no token still gets to try the request and let
 * the service's 401 tell it what happened.
 */
export async function readDecisionToken(path: string): Promise<string | undefined> {
  try {
    const trimmed = (await readFile(path, "utf8")).trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}
