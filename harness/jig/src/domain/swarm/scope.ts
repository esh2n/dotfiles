/**
 * Whether two workers may write the same files. The answer is conservative:
 * a pair is kept apart whenever it cannot be shown to be disjoint, so a
 * wrong answer only ever costs parallelism, never a clobbered file
 * (rules/decisions/2026-09-27-swarm-extension.md: never let workers write the
 * same files at once without isolation).
 *
 * Each path or glob is reduced to its literal prefix — everything before the
 * first wildcard, cut back to a whole path segment. Two scopes overlap when
 * one prefix contains the other. `src/a/**` and `src/b/*.ts` are disjoint;
 * `src/**` and `src/a/x.ts` overlap; `**` overlaps everything.
 */

const WILDCARD = /[*?[{]/;

/** `./src//a/` → `src/a`; `""` for the whole checkout. */
function normalize(path: string): string {
  return path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/** The literal directory-or-file prefix of a path or glob. */
export function literalPrefix(glob: string): string {
  const parts = normalize(glob).split("/");
  const literal: string[] = [];
  for (const part of parts) {
    if (WILDCARD.test(part)) break;
    literal.push(part);
  }
  return literal.join("/");
}

function contains(outer: string, inner: string): boolean {
  return outer === "" || inner === outer || inner.startsWith(`${outer}/`);
}

function prefixesOverlap(a: string, b: string): boolean {
  return contains(a, b) || contains(b, a);
}

/**
 * Two write scopes overlap. An empty scope is the whole checkout, so it
 * overlaps every other scope, empty ones included.
 */
export function scopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  const left = a.length === 0 ? [""] : a.map(literalPrefix);
  const right = b.length === 0 ? [""] : b.map(literalPrefix);
  return left.some((x) => right.some((y) => prefixesOverlap(x, y)));
}

/** A path the worker changed lies inside its scope. Empty scope: everything does. */
export function inScope(path: string, scope: readonly string[]): boolean {
  if (scope.length === 0) return true;
  const target = normalize(path);
  return scope.some((glob) => contains(literalPrefix(glob), target));
}
