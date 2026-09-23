// assets.mjs — shared containment guard for a page-relative asset `src`
// (a `.wu-shot` image, so far the only kind). Three call sites need the
// exact same rule and previously each rolled its own: self-check's
// `resolveShotAsset` (path-arithmetic only, no symlink check), to-md's
// `renderShot` (no containment check at all — `join(pageDir, src)` would
// happily copy `../../../.ssh/id_rsa` into `figures/`), and publish's
// `inlinePageAssets` (same gap as to-md, just for inlining instead of
// copying). One helper, one place to get it right.
//
// `resolvePageAsset(pageDir, src)` rejects:
//   - a URL scheme (`data:`, `https:`, …) or a leading `/` — not a
//     same-directory relative path at all;
//   - a `../` (or deeper) escape, checked on the plain joined path so a
//     src that doesn't exist on disk is still caught (no realpath needed
//     to see "this points above pageDir");
//   - a disallowed extension;
//   - once the file exists, a symlink whose real target resolves outside
//     the page's own real directory — `fs.realpathSync` on both `pageDir`
//     and the candidate, so a symlink hop through an intermediate
//     directory is followed too, not just a same-level symlink.
//
// Returns the resolved path (the realpath, once the file exists — so a
// caller can `copyFileSync`/`readFileSync` it directly and always get the
// real bytes, never a symlink's own inode) or `null`. When the candidate
// path is contained but nothing exists there yet, the plain joined path is
// returned instead (existence is the caller's own question — self-check's
// "image file does not exist" row needs to fire distinctly from "escapes
// the page's own directory", and only the caller knows which message to
// show for which).

import { existsSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function escapesDir(dir, candidate) {
  const rel = relative(dir, candidate)
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel))
}

/**
 * @param {string} pageDir the page's own directory (absolute or relative
 *   to cwd — resolved the same way `path.resolve` would)
 * @param {string} src the `<img src>` (or similar) attribute value
 * @returns {string|null}
 */
export function resolvePageAsset(pageDir, src) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) return null
  const candidate = resolve(pageDir, src)
  if (escapesDir(pageDir, candidate)) return null
  if (!ALLOWED_EXTENSIONS.has(extname(candidate).slice(1).toLowerCase())) return null
  if (!existsSync(candidate)) return candidate

  let realPageDir
  let realCandidate
  try {
    realPageDir = realpathSync(pageDir)
    realCandidate = realpathSync(candidate)
  } catch {
    return null
  }
  if (escapesDir(realPageDir, realCandidate)) return null
  return realCandidate
}
