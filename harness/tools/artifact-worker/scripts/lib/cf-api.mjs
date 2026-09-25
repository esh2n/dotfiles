// cf-api.mjs — a minimal Cloudflare REST client and the "what already exists"
// snapshot the planner runs on. Zero dependencies: Node's global `fetch`.
//
// The API token is only ever used as an Authorization header. It is never
// printed, never written to a file and never included in an error message.

import { ACCESS_APP_NAME, API_BASE } from "./constants.mjs";
import { SetupError } from "./env.mjs";

/** A non-2xx or `success: false` response from the Cloudflare API. */
export class ApiError extends Error {
  constructor(message, { status = 0, errors = [], method = "", path = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = Object.freeze([...errors]);
    this.method = method;
    this.path = path;
  }

  /** True when Cloudflare complained about the request body's shape. */
  get isValidation() {
    return this.status === 400 || this.status === 422 || this.errors.some((e) => e?.code === 1000);
  }
}

const summarise = (errors) =>
  errors.length === 0 ? "no error detail" : errors.map((e) => `${e?.code ?? "?"}: ${e?.message ?? e}`).join("; ");

export function createApi({ apiToken, baseUrl = API_BASE, fetchImpl = fetch }) {
  if (typeof apiToken !== "string" || apiToken.trim() === "") {
    throw new SetupError("CLOUDFLARE_API_TOKEN is empty");
  }

  async function call(method, path, body = null) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: body === null ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(`could not reach the Cloudflare API (${method} ${path})`, { method, path, errors: [String(cause)] });
    }
    const text = await response.text();
    let payload = null;
    if (text.trim() !== "") {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ApiError(`Cloudflare returned a non-JSON body (${response.status})`, {
          status: response.status,
          method,
          path,
        });
      }
    }
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    if (!response.ok || payload?.success === false) {
      throw new ApiError(`${method} ${path} failed (${response.status}): ${summarise(errors)}`, {
        status: response.status,
        errors,
        method,
        path,
      });
    }
    return payload?.result ?? null;
  }

  return Object.freeze({ call, get: (path) => call("GET", path) });
}

/** GET a list endpoint, treating "not found / not enabled" as an empty list. */
async function listOrEmpty(api, path, pick = (result) => result) {
  try {
    const result = await api.get(path);
    const list = pick(result);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return [];
    throw err;
  }
}

/**
 * Read the account's current state. Everything the planner needs, and nothing
 * else — one GET per resource kind.
 */
export async function discover(api, accountId, { wranglerVars = {} } = {}) {
  const [d1Databases, r2Buckets, accessApps, accessGroups, serviceTokens, workersSubdomain] = await Promise.all([
    listOrEmpty(api, `/accounts/${accountId}/d1/database`),
    listOrEmpty(api, `/accounts/${accountId}/r2/buckets`, (result) => result?.buckets ?? result),
    listOrEmpty(api, `/accounts/${accountId}/access/apps`),
    listOrEmpty(api, `/accounts/${accountId}/access/groups`),
    listOrEmpty(api, `/accounts/${accountId}/access/service_tokens`),
    api
      .get(`/accounts/${accountId}/workers/subdomain`)
      .then((result) => result?.subdomain ?? null)
      .catch(() => null),
  ]);

  const app = accessApps.find((item) => item?.name === ACCESS_APP_NAME) ?? null;
  const accessPolicies = app ? await listOrEmpty(api, `/accounts/${accountId}/access/apps/${app.id}/policies`) : [];

  return Object.freeze({
    d1Databases: Object.freeze(d1Databases),
    r2Buckets: Object.freeze(r2Buckets),
    accessApps: Object.freeze(accessApps),
    accessPolicies: Object.freeze(accessPolicies),
    accessGroups: Object.freeze(accessGroups),
    serviceTokens: Object.freeze(serviceTokens),
    workersSubdomain,
    wranglerVars: Object.freeze({ ...wranglerVars }),
  });
}
