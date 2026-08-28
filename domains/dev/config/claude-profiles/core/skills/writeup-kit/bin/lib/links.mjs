// links.mjs — repairs `<a href>` values inside a store page.
//
// Pages migrated from the old explain-pages tool carry hrefs written as
// store-root-relative bare paths ("engineering/backend/x/2026-06-11-y.html")
// even though the page itself lives in a sub-folder; the browser resolves
// them against the page directory and 404s. Some targets have also been
// moved to legacy/ by the migration. `repairLinks` rewrites each anchor to a
// page-relative path when a target can be found, and marks the anchor with
// `data-wu-missing` / class `wu-missing` when it cannot.
//
// Pure: the filesystem is reached only through the `exists` / `resolveLegacy`
// callbacks, so tests run without a store.

import { posix } from "node:path";

// Prefixes that are never store links.
const SKIP_PREFIX_RE = /^(#|https?:|mailto:|data:|javascript:|\/|_kit\/)/i;

// Regions whose content must not be touched. `pre` swallows any nested
// `code`; a lone `code` span is matched on its own.
const PROTECTED_RE =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<pre\b[^>]*>[\s\S]*?<\/pre\s*>|<code\b[^>]*>[\s\S]*?<\/code\s*>/gi;

const ANCHOR_RE = /<a\b[^>]*>/gi;
const HREF_RE = /(\shref\s*=\s*)("([^"]*)"|'([^']*)')/i;
const CLASS_RE = /(\sclass\s*=\s*)("([^"]*)"|'([^']*)')/i;
const MISSING_ATTR_RE = /\sdata-wu-missing(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?(?=[\s>])/i;

const MISSING_CLASS = "wu-missing";

/** Splits "path#frag" / "path?q#frag" into { path, suffix }. */
function splitSuffix(href) {
  const m = /^([^?#]*)([?#][\s\S]*)?$/.exec(href);
  return { path: m[1], suffix: m[2] ?? "" };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Normalises a store-relative candidate; null when it escapes the root. */
function normalizeStorePath(p) {
  const n = posix.normalize(p);
  if (n === "." || n === "" || n.startsWith("../") || n === ".." || n.startsWith("/")) return null;
  return n;
}

function mdToHtml(p) {
  return /\.md$/i.test(p) ? p.replace(/\.md$/i, ".html") : null;
}

/**
 * Finds the store path an href should point at.
 * Returns { target, kind } where kind is one of
 *   "unchanged" (rule 2), "root" (rule 3), "legacy" (rule 4), "md" (rule 6)
 * or null when nothing resolves (rule 5).
 */
function resolveTarget(rawPath, pageDir, exists, resolveLegacy) {
  const decoded = safeDecode(rawPath);
  const pageRel = normalizeStorePath(posix.join(pageDir, decoded));
  const rootRel = normalizeStorePath(decoded);

  // Rule 2 — page-relative and present.
  if (pageRel && exists(pageRel)) return { target: pageRel, kind: "unchanged" };
  // Rule 3 — store-root-relative and present.
  if (rootRel && exists(rootRel)) return { target: rootRel, kind: "root" };
  // Rule 6 — `.md` target whose `.html` sibling exists (either resolution).
  for (const cand of [pageRel, rootRel]) {
    const html = cand && mdToHtml(cand);
    if (html && exists(html)) return { target: html, kind: "md" };
  }
  // Rule 4 — moved page known to the caller.
  if (typeof resolveLegacy === "function") {
    const seen = new Set();
    for (const cand of [pageRel, rootRel, pageRel && mdToHtml(pageRel), rootRel && mdToHtml(rootRel)]) {
      if (!cand || seen.has(cand)) continue;
      seen.add(cand);
      const moved = resolveLegacy(cand);
      if (!moved) continue;
      const normalized = normalizeStorePath(moved);
      if (normalized && exists(normalized)) return { target: normalized, kind: "legacy" };
      const movedHtml = normalized && mdToHtml(normalized);
      if (movedHtml && exists(movedHtml)) return { target: movedHtml, kind: "legacy" };
    }
  }
  return null;
}

/** Page-relative href for a store path, keeping percent-encoding style. */
function toPageRelative(target, pageDir, wasEncoded) {
  let rel = posix.relative(pageDir, target);
  if (rel === "") rel = ".";
  return wasEncoded ? rel.split("/").map(encodeURIComponent).join("/") : rel;
}

function hasMissingClass(classValue) {
  return classValue.split(/\s+/).includes(MISSING_CLASS);
}

/** Adds data-wu-missing + class wu-missing to an `<a …>` tag, idempotently. */
function markMissing(tag) {
  let out = tag;
  if (!MISSING_ATTR_RE.test(out)) {
    out = out.replace(/\s*\/?>$/, (end) => ` data-wu-missing=""${end.trimStart()}`);
  }
  const cm = CLASS_RE.exec(out);
  if (cm) {
    const value = cm[3] ?? cm[4] ?? "";
    if (!hasMissingClass(value)) {
      const quote = cm[2][0];
      const merged = value.trim() === "" ? MISSING_CLASS : `${value} ${MISSING_CLASS}`;
      out = out.slice(0, cm.index) + cm[1] + quote + merged + quote + out.slice(cm.index + cm[0].length);
    }
  } else {
    out = out.replace(/\s*\/?>$/, (end) => ` class="${MISSING_CLASS}"${end.trimStart()}`);
  }
  return out;
}

/** Removes a stale data-wu-missing / wu-missing class from a tag. */
function unmarkMissing(tag) {
  let out = tag.replace(MISSING_ATTR_RE, "");
  const cm = CLASS_RE.exec(out);
  if (cm) {
    const value = cm[3] ?? cm[4] ?? "";
    if (hasMissingClass(value)) {
      const rest = value.split(/\s+/).filter((c) => c && c !== MISSING_CLASS);
      if (rest.length === 0) {
        out = out.slice(0, cm.index) + out.slice(cm.index + cm[0].length);
      } else {
        const quote = cm[2][0];
        out = out.slice(0, cm.index) + cm[1] + quote + rest.join(" ") + quote + out.slice(cm.index + cm[0].length);
      }
    }
  }
  return out;
}

/**
 * Repairs store links in one page.
 *
 * @param {string} html
 * @param {{ pagePath: string, exists: (storeRelPath: string) => boolean,
 *           resolveLegacy?: (storeRelPath: string) => string | null }} opts
 * @returns {{ html: string, fixed: number, missing: number, unchanged: number,
 *             details: Array<{ from: string, to: string, kind: string }> }}
 */
export function repairLinks(html, { pagePath, exists, resolveLegacy } = {}) {
  if (typeof html !== "string") throw new TypeError("repairLinks: html must be a string");
  if (typeof pagePath !== "string" || pagePath === "") throw new TypeError("repairLinks: pagePath is required");
  if (typeof exists !== "function") throw new TypeError("repairLinks: exists callback is required");

  const pageDir = posix.dirname(pagePath.split("\\").join("/"));
  const counts = { fixed: 0, missing: 0, unchanged: 0 };
  const details = [];

  const repairTag = (tag) => {
    const hm = HREF_RE.exec(tag);
    if (!hm) return tag;
    const quote = hm[2][0];
    const href = hm[3] ?? hm[4] ?? "";
    if (href === "" || SKIP_PREFIX_RE.test(href.trim())) return tag;

    const { path: rawPath, suffix } = splitSuffix(href);
    if (rawPath === "") return tag; // "?x" without a path — nothing to resolve

    const resolved = resolveTarget(rawPath, pageDir, exists, resolveLegacy);
    if (!resolved) {
      counts.missing += 1;
      const marked = markMissing(tag);
      details.push({ from: href, to: href, kind: "missing" });
      return marked;
    }

    let out = unmarkMissing(tag);
    if (resolved.kind === "unchanged") {
      counts.unchanged += 1;
      if (out !== tag) details.push({ from: href, to: href, kind: "unmarked" });
      return out;
    }

    const next = toPageRelative(resolved.target, pageDir, /%[0-9a-f]{2}/i.test(rawPath)) + suffix;
    counts.fixed += 1;
    details.push({ from: href, to: next, kind: resolved.kind });
    const replacement = hm[1] + quote + next + quote;
    return out.slice(0, hm.index) + replacement + out.slice(hm.index + hm[0].length);
  };

  // Walk the document, leaving protected regions verbatim and rewriting
  // anchors only in the prose between them.
  let out = "";
  let last = 0;
  PROTECTED_RE.lastIndex = 0;
  const pushSegment = (segment) => {
    out += segment.replace(ANCHOR_RE, repairTag);
  };
  for (let m = PROTECTED_RE.exec(html); m; m = PROTECTED_RE.exec(html)) {
    pushSegment(html.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  pushSegment(html.slice(last));

  return { html: out, ...counts, details };
}
