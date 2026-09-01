'use strict';

/**
 * One implementation of "where does yoki keep its state?", shared by every
 * module that writes under it (lib/pending-context.js, lib/loop/state.js,
 * lib/loop/inbox.js, lib/graph/journal.js, hooks/artifact-comments.js).
 *
 * The rule is the XDG one `yoki-artifact`'s own `bin/lib/inbox.mjs` already
 * followed before any of these existed: `$XDG_STATE_HOME` when set and
 * non-blank, else `~/.local/state`. It lived as a near-identical two-line
 * copy in four new modules, and one of those copies (graph/journal.js) read
 * a different variable entirely and had no XDG fallback — so relocating
 * state with XDG_STATE_HOME moved four of the five state files and silently
 * left graph run journals behind. One helper, one answer.
 */

const os = require('os');
const path = require('path');

/**
 * @param {NodeJS.ProcessEnv} [env] environment to read (tests pass a literal
 *   object; production passes nothing and gets `process.env`)
 * @returns {string} `$XDG_STATE_HOME`, else `<HOME>/.local/state`
 */
function stateHome(env) {
  const environment = env && typeof env === 'object' ? env : process.env;
  const xdg = typeof environment.XDG_STATE_HOME === 'string' ? environment.XDG_STATE_HOME.trim() : '';
  if (xdg) return xdg;
  const home = environment.HOME || os.homedir() || '';
  return path.join(home, '.local', 'state');
}

module.exports = { stateHome };
