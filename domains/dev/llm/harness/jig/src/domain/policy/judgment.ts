/**
 * A judgment is a decision plus how it was reached: which rule, from which
 * layer, and what subject extraction made of the call. The decision alone
 * is what the adapters need; the rest is what the audit log needs, so that
 * "what stopped this?" is answerable afterwards instead of guessed at.
 */

import type { Decision } from "../hooks/decision";
import type { Action } from "./types";

export type JudgmentSource =
  /** A floor rule: forbid regardless of profile, principal or mode. */
  | "floor"
  /** An ordinary rule. */
  | "rule"
  /** allowlist mode and the call could not be proven or was not covered by a permit rule. */
  | "allowlist"
  /** No rule spoke. */
  | "none"
  /** The call is not one the policy judges (unknown tool, missing field). */
  | "out-of-scope";

export interface Judgment {
  readonly decision: Decision;
  readonly source: JudgmentSource;
  readonly ruleId?: string;
  readonly action?: Action;
  /** A short description of what was judged, for the log: programs, a path, a host. */
  readonly subject?: readonly string[];
  /** What subject extraction concluded, shell calls only. */
  readonly extraction?: { readonly kind: string; readonly detail?: string };
}
