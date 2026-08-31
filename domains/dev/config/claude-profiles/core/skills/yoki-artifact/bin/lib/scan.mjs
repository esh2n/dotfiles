// scan.mjs — the two content gates that run before any byte leaves the machine.
//
// 1. secret scan: publishing is a one-way door (the HTML lands in R2 and is
//    served to whoever the channel is shared with), so a credential pasted into
//    a page must be caught here, not after. Pattern-based, so it is a floor and
//    not a guarantee — it catches the shapes that actually leak.
// 2. external references: the Worker serves artifacts under a strict CSP whose
//    allowlist is fixed. A page pointing at any other host would silently show
//    nothing once published, so refuse locally where the fix is cheap.
//
// Both return findings as plain frozen objects with a 1-based line number;
// neither ever returns the matched secret itself.

/** Frozen so a caller cannot reorder or extend the rule set at runtime. */
export const SECRET_RULES = Object.freeze([
  Object.freeze({ id: "openai-key", label: "OpenAI-style API key", re: /sk-[A-Za-z0-9]{20,}/g }),
  Object.freeze({ id: "github-token", label: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g }),
  Object.freeze({ id: "github-pat", label: "GitHub fine-grained PAT", re: /github_pat_[A-Za-z0-9_]{20,}/g }),
  Object.freeze({ id: "aws-access-key", label: "AWS access key id", re: /AKIA[0-9A-Z]{16}/g }),
  Object.freeze({ id: "slack-token", label: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g }),
  Object.freeze({
    id: "private-key",
    label: "private key block",
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  }),
  Object.freeze({
    id: "jwt",
    label: "JSON Web Token",
    re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
  }),
  Object.freeze({
    id: "credential-query",
    label: "credential in a query string",
    re: /[?&](?:password|token)=[^\s&"'<>]+/gi,
  }),
]);

/** Hosts the Worker's artifact CSP actually allows. Path-scoped where the CSP is. */
export const ALLOWED_HOSTS = Object.freeze([
  Object.freeze({ host: "cdnjs.cloudflare.com", prefix: "/" }),
  Object.freeze({ host: "cdn.jsdelivr.net", prefix: "/npm/" }),
  Object.freeze({ host: "cdn.tailwindcss.com", prefix: "/" }),
  Object.freeze({ host: "code.jquery.com", prefix: "/" }),
  Object.freeze({ host: "fonts.googleapis.com", prefix: "/" }),
  Object.freeze({ host: "fonts.gstatic.com", prefix: "/" }),
]);

const REF_RE = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

export function isAllowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return true; // not absolute — a relative or data: ref is not our business here
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((entry) => entry.host === host && url.pathname.startsWith(entry.prefix));
}

/**
 * @param {string} text page source
 * @returns {ReadonlyArray<{rule: string, label: string, line: number}>}
 */
export function scanSecrets(text) {
  const findings = [];
  for (const rule of SECRET_RULES) {
    // Rules are shared and `g`-flagged, so give each scan its own regex object.
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match = re.exec(text);
    while (match !== null) {
      findings.push(Object.freeze({ rule: rule.id, label: rule.label, line: lineOf(text, match.index) }));
      match = re.exec(text);
    }
  }
  return Object.freeze(findings.sort((a, b) => a.line - b.line));
}

/**
 * @returns {ReadonlyArray<{url: string, attribute: string, line: number}>}
 */
export function scanExternalRefs(text) {
  const re = new RegExp(REF_RE.source, REF_RE.flags);
  const findings = [];
  let match = re.exec(text);
  while (match !== null) {
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (value !== "" && /^https?:\/\//i.test(value) && !isAllowedUrl(value)) {
      findings.push(
        Object.freeze({ url: value, attribute: match[1].toLowerCase(), line: lineOf(text, match.index) }),
      );
    }
    match = re.exec(text);
  }
  return Object.freeze(findings);
}
