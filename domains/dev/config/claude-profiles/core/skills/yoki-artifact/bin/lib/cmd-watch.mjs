// cmd-watch.mjs — poll one or more channels for comments addressed to the
// agent and drop each new one into the inbox log.
//
// "New" means: to_agent=1, not yet picked up server-side (agent_seen_at is
// null), and not already in the inbox file. The last condition is what makes
// `--once` safe to run from cron every minute — see inbox.mjs.
//
// Picking a comment up is deliberately not the same as answering it: watch
// never mutates server state. `seen` and `reply` are separate commands the
// agent runs once it has actually handled the thread.

import { appendInboxEntry, inboxEntry, inboxPath, readInboxIds } from "./inbox.mjs";
import { assertChannel } from "./validate.mjs";
import { usageError } from "./errors.mjs";

export const DEFAULT_INTERVAL_SECONDS = 30;
export const MIN_INTERVAL_SECONDS = 5;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watchChannels(positionals) {
  if (positionals.length === 0) {
    throw usageError("missing_argument", "watch needs at least one <channel>.");
  }
  return Object.freeze(positionals.map((channel) => assertChannel(channel)));
}

function watchInterval(flags) {
  const seconds = flags.interval ?? DEFAULT_INTERVAL_SECONDS;
  if (seconds < MIN_INTERVAL_SECONDS) {
    throw usageError(
      "bad_flag_value",
      `--interval must be at least ${MIN_INTERVAL_SECONDS} seconds (the Worker is rate limited).`,
    );
  }
  return seconds;
}

async function pollOnce({ client, channels, file, now }) {
  const known = readInboxIds(file);
  const written = [];
  for (const channel of channels) {
    const { body } = await client.request("GET", `/api/artifacts/${encodeURIComponent(channel)}/comments`, {
      query: { to_agent: "1" },
    });
    const comments = Array.isArray(body?.comments) ? body.comments : [];
    for (const comment of comments) {
      if (comment.agent_seen_at !== null || known.has(comment.id)) continue;
      const entry = inboxEntry({ channel, comment, viewerUrl: client.viewerUrl(channel), now: now() });
      appendInboxEntry(file, entry);
      known.add(comment.id);
      written.push(entry);
    }
  }
  return Object.freeze(written);
}

/**
 * Which failures end a long-running watch. Anything Access or the CLI itself
 * refuses is permanent — retrying it every 30s just hides it — while a
 * timeout, a 5xx or a rate limit is exactly what a poll loop is supposed to
 * ride out. `access_redirect` is a service token that is not authorised for
 * this app: permanent, even though it arrives as a redirect.
 */
export function isFatalWatchError(error) {
  if (!error || typeof error !== "object") return true;
  if (error.name !== "CliError") return true;
  if (error.code === "access_redirect") return true;
  return error.status === 401 || error.status === 403;
}

export async function cmdWatch({
  client,
  positionals,
  flags,
  env,
  now = () => new Date(),
  print,
  stderr,
  // Injected for the same reason `now` is: the loop's failure handling has to
  // be testable without waiting out a real poll interval.
  sleep = realSleep,
}) {
  const channels = watchChannels(positionals);
  const interval = watchInterval(flags);
  const file = inboxPath(env);
  const once = flags.once === true;

  const first = await pollOnce({ client, channels, file, now });
  if (once) {
    return Object.freeze({
      json: Object.freeze({ inbox: file, channels, entries: first }),
      lines:
        first.length === 0
          ? [`no new agent comments on ${channels.join(", ")}`]
          : first.map((entry) => `${entry.channel}  ${entry.comment.id}  ${entry.comment.author}`),
    });
  }

  // Long-running mode: print each entry as it arrives rather than accumulating
  // a result nobody would ever see.
  for (const entry of first) print(JSON.stringify(entry));
  const warn = (line) => stderr?.write?.(`${line}\n`);
  for (;;) {
    await sleep(interval * 1000);
    let entries;
    try {
      entries = await pollOnce({ client, channels, file, now });
    } catch (error) {
      // A blip must not end the watch: the SessionStart hook only ever reads
      // the inbox file, so a dead watcher looks exactly like "no new
      // comments" and unread comments stop arriving silently.
      if (isFatalWatchError(error)) throw error;
      warn(`watch: ${error.message} — retrying in ${interval}s`);
      continue;
    }
    for (const entry of entries) print(JSON.stringify(entry));
  }
}
