/**
 * Subject extraction — what a shell command string actually runs.
 *
 * The guard's rules used to be matched against the raw command string, which
 * has no notion of what is a program and what is an argument: `grep "rm -rf"
 * notes.md` looked like a delete, `sudo rm -rf x` looked like nothing. This
 * module reads the string with a real bash grammar and reports the programs
 * that will run, so a rule can say "program is git and argv mentions --force"
 * instead of guessing from characters.
 *
 * Two readings come out of every string, and the asymmetry is the point:
 *
 *  - `resolved` — the strict reading. Present only when every construct in
 *    the string is on the allowlist (simple commands, pipes, `&&`/`;`,
 *    literal and quoted words) and every transparent wrapper was peeled.
 *    Permitting a call needs this proof.
 *  - `suspects` — the lenient reading. Every command the parser can see
 *    anywhere, including inside `$()`, backticks, loops, heredocs and the
 *    literal payload of `sh -c`. Forbidding a call needs only this suspicion.
 *
 * `grep "rm -rf" notes.md` resolves to grep (the quoted text is an argument),
 * so nothing that forbids rm fires; `echo $(rm -rf /)` cannot be resolved but
 * its suspects contain `rm -rf /`, so the forbid fires anyway.
 */

/** One program invocation with its arguments, as the shell would exec it. */
export interface ShellCommand {
  /** The program word as written (`git`, `/usr/bin/git`, `sudo`, …). */
  readonly program: string;
  /** Arguments after the program, unquoted. */
  readonly argv: readonly string[];
  /**
   * Transparent wrappers peeled to reach this program, outermost first
   * (`["timeout", "nohup"]` for `timeout 10 nohup make`). Empty when none.
   */
  readonly wrappers: readonly string[];
  /**
   * Files this invocation writes through output redirection (`>`, `>>`,
   * `>|`, `&>`, `&>>`, `<>`), unquoted. A shell redirect is a file write the
   * program never sees in its argv, so rules about paths need it here.
   */
  readonly writes: readonly string[];
}

/** Why a string could not be read strictly. Stable strings, used in audit and in ask reasons. */
export type UnresolvedReason =
  | { readonly kind: "parse-error"; readonly detail: string }
  | { readonly kind: "unsupported-syntax"; readonly detail: string }
  | { readonly kind: "wrapper-depth"; readonly detail: string }
  | { readonly kind: "wrapper-option"; readonly detail: string }
  | { readonly kind: "too-large"; readonly detail: string }
  | { readonly kind: "too-slow"; readonly detail: string }
  | { readonly kind: "too-many-nodes"; readonly detail: string };

export type Extraction =
  | {
      /** Every executed program is known. */
      readonly kind: "resolved";
      readonly commands: readonly ShellCommand[];
      readonly suspects: readonly ShellCommand[];
    }
  | {
      /** The string uses syntax the strict reader does not model; nothing is proven. */
      readonly kind: "unresolved";
      readonly reason: UnresolvedReason;
      readonly suspects: readonly ShellCommand[];
    }
  | {
      /**
       * The string was read, and it hands control to content the reader
       * cannot see (`eval`, `xargs`, `curl | sh`, `python -c`, …). Always a
       * question for the human, whatever the policy mode.
       */
      readonly kind: "carrier";
      readonly carrier: string;
      readonly detail: string;
      readonly suspects: readonly ShellCommand[];
    };

/** Resource caps. Exceeding any of them yields `unresolved`, never a partial `resolved`. */
export interface ExtractionLimits {
  readonly maxBytes: number;
  readonly maxMillis: number;
  readonly maxNodes: number;
  /** How many transparent wrappers may be peeled from one command. */
  readonly maxWrapperDepth: number;
  /** How deep `sh -c '…'` literal payloads are re-read (Codex and OpenHands stop at 8 too). */
  readonly maxShellDepth: number;
}

export const DEFAULT_LIMITS: ExtractionLimits = {
  maxBytes: 10_000,
  maxMillis: 50,
  maxNodes: 50_000,
  maxWrapperDepth: 8,
  maxShellDepth: 8,
};
