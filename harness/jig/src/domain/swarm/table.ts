/**
 * The always-visible table below the editor: one line per worker plus a
 * header and a summary, never more than ten lines (omp caps a string widget
 * at ten; pi's is the same shape). Columns follow the screen the owner asked
 * for — NAME, MODEL, EFFORT, STATUS, PROGRESS, IDLE, AGE, NOTE — with COST and
 * TOKENS added so spend is never hidden
 * (rules/decisions/2026-09-27-swarm-extension.md).
 *
 * Pure: plain strings, no colour (the adapters colour by status), width in
 * terminal cells, `now` passed in.
 */

import { type Status, type Worker, isFinished } from "./types";

export const MAX_LINES = 10;
const BAR = 10;

/** Rows are ordered by what needs attention first. */
const ORDER: Record<Status, number> = {
  working: 0,
  queued: 1,
  unread: 2,
  held: 3,
  failed: 4,
  done: 5,
  cancelled: 6,
};

const LABEL: Record<Status, string> = {
  working: "Working",
  queued: "Queued",
  unread: "Unread",
  held: "Held",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function cost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

function totalTokens(w: Worker): number {
  return w.usage.input + w.usage.output + w.usage.cacheRead + w.usage.cacheWrite;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * How far along a worker is, 0..1, or `undefined` when there is nothing to
 * measure it against. No harness reports a real percentage, so a running
 * worker is measured against the median time its finished batch-mates took,
 * and never shown as done (0.95 at most) before it is.
 */
export function progress(w: Worker, all: readonly Worker[], now: number): number | undefined {
  if (w.status === "queued") return 0;
  if (isFinished(w.status)) return 1;
  const took = all
    .filter(
      (o) =>
        o.batch === w.batch &&
        o.startedAt !== undefined &&
        o.endedAt !== undefined &&
        o.status !== "cancelled",
    )
    .map((o) => (o.endedAt ?? 0) - (o.startedAt ?? 0));
  const typical = median(took);
  if (typical === undefined || typical <= 0 || w.startedAt === undefined) return undefined;
  return Math.min(0.95, (now - w.startedAt) / typical);
}

/** A bar of BAR cells; unknown progress is a pulse that moves with `now`. */
export function bar(fraction: number | undefined, now: number): string {
  if (fraction === undefined) {
    const at = Math.floor(now / 500) % BAR;
    return Array.from({ length: BAR }, (_, i) => (i === at ? "▬" : "·")).join("");
  }
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * BAR);
  return "▬".repeat(filled) + "·".repeat(BAR - filled);
}

function note(w: Worker): string {
  if (w.note !== undefined) return w.note;
  return w.spec.isolated ? `worktree ${w.spec.name}` : "direct";
}

function cells(w: Worker, all: readonly Worker[], now: number): string[] {
  const idle =
    w.status === "working" && w.lastEventAt !== undefined ? duration(now - w.lastEventAt) : "—";
  const age = duration((w.endedAt ?? now) - (w.startedAt ?? w.queuedAt));
  return [
    w.spec.name,
    w.model ?? w.spec.tier,
    w.spec.effort ?? "—",
    LABEL[w.status],
    bar(progress(w, all, now), now),
    idle,
    age,
    note(w),
    cost(w.usage.cost),
    tokens(totalTokens(w)),
  ];
}

const HEADER = [
  "NAME",
  "MODEL",
  "EFFORT",
  "STATUS",
  "PROGRESS",
  "IDLE",
  "AGE",
  "NOTE",
  "COST",
  "TOKENS",
];
/** Columns that give up width first, most expendable first: NOTE, MODEL, NAME. */
const SHRINK = [7, 1, 0];
const MIN_SHRUNK = 4;

/** Terminal cells a character takes: East Asian wide and full-width forms take two. */
function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd);
  return wide ? 2 : 1;
}

export function cellWidth(text: string): number {
  let n = 0;
  for (const ch of text) n += charWidth(ch);
  return n;
}

/** `text` in at most `width` cells, with an ellipsis when cut. */
function cut(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}

function layout(rows: readonly string[][], width: number): number[] {
  const widths = HEADER.map((_, col) => Math.max(...rows.map((r) => cellWidth(r[col] ?? ""))));
  const total = () => widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1);
  for (const col of SHRINK) {
    const over = total() - width;
    if (over <= 0) break;
    const current = widths[col] ?? 0;
    widths[col] = Math.max(MIN_SHRUNK, current - over);
  }
  return widths;
}

function line(row: readonly string[], widths: readonly number[], width: number): string {
  const text = row
    .map((cell, col) => pad(cut(cell, widths[col] ?? 0), widths[col] ?? 0))
    .join("  ");
  return cut(text.trimEnd(), width);
}

/** The summary line: what runs, what waits, what is unread, and the spend so far. */
export function summary(workers: readonly Worker[]): string {
  const count = (s: Status) => workers.filter((w) => w.status === s).length;
  const parts = [
    `${count("working")} working`,
    `${count("queued")} queued`,
    `${count("unread")} unread`,
  ];
  if (count("held") > 0) parts.push(`${count("held")} held`);
  if (count("failed") > 0) parts.push(`${count("failed")} failed`);
  const costs = workers.map((w) => w.usage.cost).filter((c): c is number => c !== undefined);
  parts.push(costs.length === 0 ? "cost —" : cost(costs.reduce((a, b) => a + b, 0)));
  parts.push(`${tokens(workers.reduce((a, w) => a + totalTokens(w), 0))} tok`);
  const state = count("working") > 0 ? "Working" : count("queued") > 0 ? "Queued" : "Idle";
  return `Swarm · ${state} · ${parts.join(" · ")}`;
}

/** What a line of the table is, so an adapter can colour it. */
export type LineTone = "header" | Status | "more" | "summary";

export interface TableLine {
  readonly text: string;
  readonly tone: LineTone;
}

/** The widget's lines with what each one is, at most MAX_LINES; empty when there are no workers. */
export function tableLines(workers: readonly Worker[], width: number, now: number): TableLine[] {
  if (workers.length === 0) return [];
  const sorted = [...workers].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.queuedAt - b.queuedAt,
  );
  const room = MAX_LINES - 2;
  const shown = sorted.length > room ? sorted.slice(0, room - 1) : sorted;
  const rows = shown.map((w) => cells(w, workers, now));
  const widths = layout([HEADER, ...rows], width);
  const out: TableLine[] = [
    { text: line(HEADER, widths, width), tone: "header" },
    ...rows.map((r, i) => ({
      text: line(r, widths, width),
      tone: shown[i]?.status ?? ("done" as const),
    })),
  ];
  if (sorted.length > room) {
    out.push({ text: cut(`… ほか ${sorted.length - shown.length} 件`, width), tone: "more" });
  }
  out.push({ text: cut(summary(workers), width), tone: "summary" });
  return out;
}

/** The widget's lines, at most MAX_LINES; empty when there are no workers. */
export function renderTable(workers: readonly Worker[], width: number, now: number): string[] {
  return tableLines(workers, width, now).map((l) => l.text);
}
