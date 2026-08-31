// tokenize.mjs — split a configured `secretCommand` string into argv.
//
// The secret command is run with shell=false: no /bin/sh, so no globbing, no
// substitution, no `;` chaining. A config file is not a shell script, and a
// mistyped one must fail loudly rather than execute something extra. This
// tokenizer therefore understands exactly what an argv needs — whitespace
// separation, single quotes, double quotes, backslash escapes — and rejects
// anything unterminated.

import { usageError } from "./errors.mjs";

const WHITESPACE = /\s/;

/**
 * @param {string} input e.g. `op read "op://Private/yoki artifact/credential"`
 * @returns {string[]} frozen argv; [] for a blank string
 */
export function tokenizeCommand(input) {
  if (typeof input !== "string") {
    throw usageError("bad_secret_command", "`secretCommand` must be a string.");
  }
  const tokens = [];
  let current = "";
  let started = false;
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\\" && quote !== "'") {
      const next = input[i + 1];
      if (next === undefined) {
        throw usageError("bad_secret_command", "`secretCommand` ends with a dangling backslash.");
      }
      current += next;
      started = true;
      i += 1;
      continue;
    }
    if (quote === null && (ch === '"' || ch === "'")) {
      quote = ch;
      started = true;
      continue;
    }
    if (quote !== null && ch === quote) {
      quote = null;
      continue;
    }
    if (quote === null && WHITESPACE.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (quote !== null) {
    throw usageError("bad_secret_command", `\`secretCommand\` has an unterminated ${quote} quote.`);
  }
  if (started) tokens.push(current);
  return Object.freeze(tokens);
}
