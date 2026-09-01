// access-group.mjs — the Cloudflare Access half of `share` / `unshare`.
//
// Viewer access needs TWO lists to agree:
//   1. the D1 `viewers` rows the Worker checks in canRead()   — POST /viewers
//   2. the account-wide Access group `yoki-artifact-viewers`,  — this file
//      whose members Cloudflare admits at the edge
//
// Updating only (1) grants nothing usable: Access rejects the new viewer
// before the Worker ever runs. Updating only (2) leaves someone at the edge
// who the Worker will refuse. So `share`/`unshare` is the single entry point
// and does both — and when it cannot do (2), it says exactly what to run by
// hand instead of returning a quiet success.
//
// The group is updated read-modify-write (GET then PUT the whole object)
// because Cloudflare has no "add one member" endpoint. Anything in the group
// that is not an email include rule — an everyone rule, an IdP group, a
// country rule someone added in the dashboard — is carried through untouched.

export const CF_API_BASE = "https://api.cloudflare.com/client/v4";
export const VIEWERS_GROUP_NAME = "yoki-artifact-viewers";
export const API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
export const ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";

/** The email an include rule grants, or null for any other kind of rule. */
export function ruleEmail(rule) {
  const email = rule?.email?.email;
  return typeof email === "string" && email.trim() !== "" ? email.trim().toLowerCase() : null;
}

/**
 * Merge an email add/remove into an existing `include` array.
 * Foreign rules keep their identity and their order; email rules are only
 * dropped when named in `remove`, and appended (once) when named in `add`.
 */
export function mergeInclude(include, { add = [], remove = [] } = {}) {
  const rules = Array.isArray(include) ? include : [];
  const removing = new Set(remove.map((email) => String(email).trim().toLowerCase()));
  const kept = rules.filter((rule) => {
    const email = ruleEmail(rule);
    return email === null || !removing.has(email);
  });
  const present = new Set(kept.map(ruleEmail).filter((email) => email !== null));
  const appended = [];
  for (const raw of add) {
    const email = String(raw).trim().toLowerCase();
    if (email === "" || present.has(email)) continue;
    present.add(email);
    appended.push({ email: { email } });
  }
  return [...kept, ...appended];
}

/**
 * Everything the Access update needs, or the list of what is missing.
 * The token and account come from the environment (they are operator
 * credentials, never stored); the group id comes from config.json, written by
 * worker/scripts/setup.mjs.
 *
 * @returns {{ok: true, apiToken, accountId, groupId}
 *          | {ok: false, missing: string[], accountId: string|null}}
 */
export function resolveAccessGroupTarget({ env = process.env, config = null } = {}) {
  const configFile = config?.file ?? "~/.config/yoki-artifact/config.json";
  const apiToken = env?.[API_TOKEN_ENV]?.trim() ?? "";
  // The account id is the same on every run, so config.json (written by setup)
  // is a fine fallback; the token never is, and is read from the environment
  // only.
  const accountId = env?.[ACCOUNT_ID_ENV]?.trim() || config?.accountId || "";
  const groupId = config?.accessGroupId ?? "";
  const missing = [
    apiToken === "" ? `$${API_TOKEN_ENV}` : null,
    accountId === "" ? `$${ACCOUNT_ID_ENV}` : null,
    groupId === "" ? `"accessGroupId" in ${configFile}` : null,
  ].filter((entry) => entry !== null);
  if (missing.length > 0) {
    return Object.freeze({ ok: false, missing: Object.freeze(missing), accountId: accountId || null });
  }
  return Object.freeze({ ok: true, apiToken, accountId, groupId });
}

/** A Cloudflare API refusal, carrying enough to name it in the manual step. */
export class AccessGroupError extends Error {
  constructor(message, { status = 0, detail = null } = {}) {
    super(message);
    this.name = "AccessGroupError";
    this.status = status;
    this.detail = detail;
  }
}

async function call(method, url, { apiToken, body = null, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new AccessGroupError(`could not reach the Cloudflare API (${method} ${url})`, { detail: String(cause) });
  }
  const text = await response.text();
  let payload = null;
  if (text.trim() !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AccessGroupError(`Cloudflare returned a non-JSON body (${response.status})`, {
        status: response.status,
      });
    }
  }
  if (!response.ok || payload?.success === false) {
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const summary =
      errors.length === 0
        ? `HTTP ${response.status}`
        : errors.map((e) => `${e?.code ?? "?"}: ${e?.message ?? e}`).join("; ");
    throw new AccessGroupError(`${method} ${url} failed (${response.status}): ${summary}`, {
      status: response.status,
      detail: text.slice(0, 300),
    });
  }
  return payload?.result ?? null;
}

/**
 * Read the Access group, apply the add/remove, write it back.
 * `name`, `exclude` and `require` are echoed back exactly as Cloudflare
 * returned them: a PUT replaces the whole object, so anything not sent is
 * deleted.
 *
 * @returns {{emails: string[], include: object[], unchanged: boolean}}
 */
export async function syncAccessGroup({
  apiToken,
  accountId,
  groupId,
  add = [],
  remove = [],
  fetchImpl = fetch,
}) {
  const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/access/groups/${encodeURIComponent(groupId)}`;
  const group = await call("GET", url, { apiToken, fetchImpl });
  if (!group || typeof group !== "object") {
    throw new AccessGroupError(`Access group ${groupId} was not found in account ${accountId}.`);
  }
  const include = mergeInclude(group.include, { add, remove });
  const before = JSON.stringify(Array.isArray(group.include) ? group.include : []);
  const unchanged = before === JSON.stringify(include);
  if (!unchanged) {
    await call("PUT", url, {
      apiToken,
      fetchImpl,
      body: {
        name: group.name ?? VIEWERS_GROUP_NAME,
        include,
        exclude: Array.isArray(group.exclude) ? group.exclude : [],
        require: Array.isArray(group.require) ? group.require : [],
      },
    });
  }
  return Object.freeze({
    include: Object.freeze(include),
    emails: Object.freeze(include.map(ruleEmail).filter((email) => email !== null)),
    unchanged,
  });
}

/**
 * What to do by hand when the edge could not be updated. Named, exact steps —
 * this is printed at exit 2, and it is the only thing standing between a
 * "shared" artifact and a viewer who cannot open it.
 */
export function manualAccessGroupSteps({
  command,
  channel,
  emails,
  configFile,
  accountId = null,
  missing = [],
  cause = null,
}) {
  const verb = command === "unshare" ? "removed from" : "added to";
  const list = emails.join(", ");
  const account = accountId ? `account ${accountId}` : "your Cloudflare account";
  return [
    "",
    `The D1 viewer list for "${channel}" WAS updated — that part succeeded.`,
    `The Cloudflare Access group "${VIEWERS_GROUP_NAME}" was NOT, so ${list}`,
    command === "unshare"
      ? "can still be admitted by Access until the group is updated."
      : "is still blocked by Access before the Worker ever runs.",
    "",
    ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}`] : []),
    ...(cause ? [`Cloudflare API: ${cause}`] : []),
    "",
    `Do ONE of these so ${list} is ${verb} "${VIEWERS_GROUP_NAME}" in ${account}:`,
    "",
    `  a. export ${API_TOKEN_ENV}=… ${ACCOUNT_ID_ENV}=… and re-run:`,
    `       yoki-artifact ${command} ${channel} ${emails.map((email) => `--to ${email}`).join(" ")}`,
    `     (the D1 write is idempotent, so re-running is safe)`,
    "",
    `  b. edit worker/viewers.json (${command === "unshare" ? "remove" : "add"} ${list}) and run:`,
    "       cd worker && node scripts/setup.mjs",
    `     setup.mjs rewrites the group from that file and records accessGroupId`,
    `     in ${configFile}.`,
    "",
    "  c. Cloudflare dashboard: Zero Trust → Access → Access Groups →",
    `     "${VIEWERS_GROUP_NAME}" → ${command === "unshare" ? "delete" : "add"} the Emails include rule for ${list}.`,
    "",
  ];
}
