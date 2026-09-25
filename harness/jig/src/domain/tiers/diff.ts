/**
 * A small, dependency-free unified-diff renderer for `jig apply`'s dry-run
 * output. No shell-out to a `diff` binary (portability, determinism, and one
 * fewer infra dependency for a pure domain module) — an LCS over lines,
 * grouped into standard `@@ -aStart,aCount +bStart,bCount @@` hunks with a
 * few lines of context, same shape `diff -u` produces.
 */

const CONTEXT = 3;

type Op = { readonly kind: "equal" | "delete" | "insert"; readonly line: string };

/** `noUncheckedIndexedAccess` makes every array read possibly-`undefined`; every index below is in-bounds by construction, so this throws rather than lint-suppressing with `!`. */
function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`diff: index ${index} out of bounds (length ${arr.length})`);
  }
  return value;
}

/** Longest-common-subsequence line alignment, then a delete/insert/equal op list. */
function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of LCS of a[i..] and b[j..], built bottom-up as a flat
  // (n+1) x (m+1) grid to keep every read a single, boundable index.
  const width = m + 1;
  const lcs = new Array<number>((n + 1) * width).fill(0);
  const idx = (i: number, j: number) => i * width + j;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const value =
        at(a, i) === at(b, j)
          ? at(lcs, idx(i + 1, j + 1)) + 1
          : Math.max(at(lcs, idx(i + 1, j)), at(lcs, idx(i, j + 1)));
      lcs[idx(i, j)] = value;
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at(a, i) === at(b, j)) {
      ops.push({ kind: "equal", line: at(a, i) });
      i++;
      j++;
    } else if (at(lcs, idx(i + 1, j)) >= at(lcs, idx(i, j + 1))) {
      ops.push({ kind: "delete", line: at(a, i) });
      i++;
    } else {
      ops.push({ kind: "insert", line: at(b, j) });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", line: at(a, i) });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "insert", line: at(b, j) });
    j++;
  }
  return ops;
}

interface Hunk {
  readonly aStart: number;
  readonly aCount: number;
  readonly bStart: number;
  readonly bCount: number;
  readonly lines: readonly string[];
}

function findChangeRanges(ops: readonly Op[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let k = 0; k < ops.length; k++) {
    if (at(ops, k).kind !== "equal") {
      if (start === -1) start = k;
    } else if (start !== -1) {
      ranges.push([start, k - 1]);
      start = -1;
    }
  }
  if (start !== -1) ranges.push([start, ops.length - 1]);
  return ranges;
}

function mergeOverlapping(ranges: readonly (readonly [number, number])[]): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function buildHunk(ops: readonly Op[], s: number, e: number): Hunk {
  let aStart = 0;
  let bStart = 0;
  for (let k = 0; k < s; k++) {
    const kind = at(ops, k).kind;
    if (kind !== "insert") aStart++;
    if (kind !== "delete") bStart++;
  }

  let aCount = 0;
  let bCount = 0;
  const lines: string[] = [];
  for (let k = s; k <= e; k++) {
    const op = at(ops, k);
    if (op.kind === "equal") {
      lines.push(` ${op.line}`);
      aCount++;
      bCount++;
    } else if (op.kind === "delete") {
      lines.push(`-${op.line}`);
      aCount++;
    } else {
      lines.push(`+${op.line}`);
      bCount++;
    }
  }
  return { aStart: aStart + 1, aCount, bStart: bStart + 1, bCount, lines };
}

function groupHunks(ops: readonly Op[]): Hunk[] {
  const changeRanges = findChangeRanges(ops);
  if (changeRanges.length === 0) return [];

  const padded: Array<[number, number]> = changeRanges.map(([s, e]) => [
    Math.max(0, s - CONTEXT),
    Math.min(ops.length - 1, e + CONTEXT),
  ]);

  return mergeOverlapping(padded).map(([s, e]) => buildHunk(ops, s, e));
}

/** Splits on "\n"; a trailing empty element from a trailing newline is dropped so line counts match human expectations. */
function toLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** Empty string when `aText === bText`. Otherwise a standard unified diff with `---`/`+++` headers naming `aLabel`/`bLabel`. */
export function unifiedDiff(aLabel: string, aText: string, bLabel: string, bText: string): string {
  if (aText === bText) return "";

  const ops = diffLines(toLines(aText), toLines(bText));
  const hunks = groupHunks(ops);
  if (hunks.length === 0) return "";

  const out: string[] = [`--- ${aLabel}`, `+++ ${bLabel}`];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`);
    out.push(...hunk.lines);
  }
  return out.join("\n");
}
