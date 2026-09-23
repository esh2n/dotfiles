/**
 * Loading the guard policy is two reads, not one: the policy document, and
 * each waiver list a rule names (`unlessCwdIn`), read from beside the policy
 * file. This is the one loader every adapter goes through — Claude Code's
 * CLI hook, DSH's bridge, pi's and omp's in-process extensions — so a list
 * is read the same way everywhere.
 *
 * A list that cannot be read (absent, unreadable) is an empty list: the rule
 * simply stays in force, which is the fail-closed direction. The hash covers
 * the policy text only; a waiver shows up in the audit line by rule id
 * instead.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parsePolicy, waiverListNames, withWaivers } from "../../domain/policy/parse";
import { type Waivers, parseWaiverList } from "../../domain/policy/waivers";
import { type LoadedPolicy, policyHash } from "./run-hook";

/** How the loader reads a file; the caller picks the port (node fs, a fake). */
export type ReadText = (path: string) => Promise<string>;

export interface LoadPolicyOptions {
  /** `~` in a waiver list expands to this. Defaults to the process's home. */
  readonly home?: string;
}

/** Read the policy at `path` and the waiver lists it names, into one LoadedPolicy. Throws on a bad policy. */
export async function loadGuardPolicy(
  path: string,
  read: ReadText,
  options: LoadPolicyOptions = {},
): Promise<LoadedPolicy> {
  const text = await read(path);
  const policy = parsePolicy(JSON.parse(text) as Record<string, unknown>);
  const home = options.home ?? homedir();
  const lists: Record<string, readonly string[]> = {};
  for (const name of waiverListNames(policy)) {
    let listText: string;
    try {
      listText = await read(join(dirname(path), name));
    } catch {
      listText = "";
    }
    lists[name] = parseWaiverList(listText, home);
  }
  const waivers: Waivers = lists;
  return { policy: withWaivers(policy, waivers), hash: policyHash(text) };
}
