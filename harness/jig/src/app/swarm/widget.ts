/**
 * The table below the editor, as the component factory pi's and omp's
 * `ctx.ui.setWidget(key, factory, { placement: "belowEditor" })` take — the
 * same contract in both (`render(width)`, `invalidate()`, `dispose()`;
 * `tui.requestRender()`; `theme.fg(colour, text)`).
 *
 * A factory rather than a string list because the width is only known at
 * render time and every line must fit it. While a worker runs, or a read row
 * is still waiting to leave, the widget asks for a redraw once a second so
 * IDLE, AGE and the progress bar move and the row goes on time; with neither
 * it stays still and costs nothing.
 */

import { type Workers, nextHideAt } from "../../domain/swarm/state";
import { type LineTone, tableLines } from "../../domain/swarm/table";

/** The slice of pi's / omp's TUI and theme the widget touches. */
export interface WidgetTui {
  requestRender(): void;
}
export interface WidgetTheme {
  fg(color: string, text: string): string;
}
export interface WidgetComponent {
  render(width: number): string[];
  invalidate(): void;
  dispose(): void;
}

/** Colour names both harnesses' themes define (`accent`, `success`, `warning`, `error`, `muted`, `dim`). */
const TONE: Record<LineTone, string | undefined> = {
  header: "muted",
  working: "accent",
  queued: "muted",
  unread: "warning",
  held: "warning",
  failed: "error",
  done: "success",
  cancelled: "dim",
  more: "dim",
  summary: "muted",
};

const TICK_MS = 1_000;

export function swarmWidget(
  current: () => Workers,
  now: () => number = Date.now,
): (tui: WidgetTui, theme: WidgetTheme) => WidgetComponent {
  return (tui, theme) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const workers = current();
      const running =
        workers.some((w) => w.status === "working" || w.status === "queued") ||
        nextHideAt(workers, now()) !== undefined;
      if (running && timer === undefined) {
        timer = setInterval(() => tui.requestRender(), TICK_MS);
        (timer as { unref?: () => void }).unref?.();
      } else if (!running && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    return {
      render(width) {
        tick();
        return tableLines(current(), width, now()).map((line) => {
          const colour = TONE[line.tone];
          if (colour === undefined) return line.text;
          try {
            return theme.fg(colour, line.text);
          } catch {
            // an unknown colour name throws in pi; plain text is still the table
            return line.text;
          }
        });
      },
      invalidate() {},
      dispose() {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      },
    };
  };
}
