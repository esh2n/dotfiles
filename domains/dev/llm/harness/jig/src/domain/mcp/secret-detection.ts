/**
 * Secret-shaped value/key detection — the subset of yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/canonical-mcp.js` that
 * `source.js`'s `assertNoLiteralSecrets` depends on. Ported verbatim (regex
 * patterns and all); everything else in canonical-mcp.js (redaction,
 * cross-harness inventory building) is out of scope for compose.
 */

/** Env keys whose values are almost always secrets. */
export const SECRET_KEY_PATTERN =
  /(token|secret|key|password|passwd|auth|credential|api[_-]?key|access[_-]?key|private)/i;

/** Known secret value prefixes (provider API keys) plus a high-entropy fallback. */
const SECRET_VALUE_PATTERNS = [
  /^sk-[A-Za-z0-9_-]{16,}$/i, // OpenAI / Anthropic (sk-ant-...)
  /^ghp_[A-Za-z0-9]{16,}$/, // GitHub PAT (classic)
  /^github_pat_[A-Za-z0-9_]{16,}$/, // GitHub PAT (fine-grained)
  /^gh[oprs]_[A-Za-z0-9]{16,}$/, // other GitHub tokens
  /^sm_[A-Za-z0-9_-]{16,}$/, // Supermemory
  /^AIza[A-Za-z0-9_-]{16,}$/, // Google API key
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack
  /^(pb|sk|pk|rk)_(live|test)_[A-Za-z0-9]{12,}$/i, // Stripe / PostBridge-style
];

export function looksLikeSecretValue(value: unknown): boolean {
  if (typeof value !== "string") return false;

  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  // High-entropy fallback: a long opaque token (letters AND digits, no path
  // or package separators) is almost certainly a credential.
  return (
    value.length >= 32 &&
    /^[A-Za-z0-9_+/=.-]+$/.test(value) &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value) &&
    !value.includes("/") &&
    !value.includes("@")
  );
}
