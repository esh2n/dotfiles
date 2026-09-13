import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

// Live yoki-graph progress in pi's below-editor widget slot.
//
// Constraints this file is built around, in order of importance:
//
//  1. ZERO model-context cost. This extension registers no tool, injects no
//     message, and never calls sendMessage/sendUserMessage — the local
//     lane's 1K-token budget (see ../README.md) must not notice it exists.
//     Only UI APIs (setWidget) and lifecycle events are used.
//
//  2. NEVER break pi's startup. All the display logic lives in the yoki
//     repo (scripts/lib/graph/), resolved at session_start via YOKI_ROOT or
//     the default dotfiles path. Resolution failure disables the extension
//     with ONE console.error line; every watcher/timer/render entry point
//     is wrapped so a throw degrades to a stale widget, not a dead agent.
//
//  3. ZERO lines when quiet. The widget is set only while at least one run
//     is active (run.json status=running whose lock pid is alive — stale
//     runs included, they need a human) and removed the moment none is.
//
//  4. NO POLLING for data. fs.watch on the graph state root plus each
//     active runDir, coalesced to one refresh per 500ms; the single timer
//     is a 5s safety tick (same rationale as `yoki-graph top`: a silently
//     dead watcher must degrade to 5s latency, not a frozen widget — and
//     it is also what keeps the elapsed columns moving between events).
//
//  5. NOTHING re-implemented. Event folding, run discovery, lane-run
//     nesting and liveness come from top.js (buildViews); line assembly
//     and sanitation from widget-lines.js / top-render.js — the same code
//     `yoki-graph top` renders with, tested by the yoki repo's own suite.
//     The .ts side is watcher + setWidget glue only.
//
// pi API surface used (verified against 0.84.4 d.ts):
//   ctx.ui.setWidget(key, (tui, theme) => Component, {placement}) — the
//   component form is pull-rendered (`render(width): string[]`), so watch
//   events update state and call tui.requestRender(); passing `undefined`
//   as content removes the widget. Teardown on "session_shutdown".

const WIDGET_KEY = "yoki-graph";

/** One refresh per watch burst: a run emitting many events.ndjson appends
 *  in quick succession costs one re-read + one redraw request. */
const COALESCE_MS = 500;

/** The safety net — the ONLY recurring timer, and the ceiling the no-polling
 *  rule allows. Unref'd so it never holds pi's process open. */
const SAFETY_MS = 5000;

/** What this file needs to know about a RunView — everything else stays
 *  opaque and flows straight from buildViews into widgetLines. */
interface RunViewLike {
  runId: string;
  dir: string;
  liveness: string;
  children: RunViewLike[];
}

interface GraphMods {
  graphRoot(env: NodeJS.ProcessEnv): string;
  buildViews(
    views: Map<string, unknown>,
    env: NodeJS.ProcessEnv,
    dirty: Set<string> | null,
    now: number,
    host: string,
  ): RunViewLike[];
  widgetLines(views: RunViewLike[], width: number, now: number): string[];
}

/**
 * Resolve the yoki graph lib: $YOKI_ROOT first, then the default dotfiles
 * checkout. The path is environment-dependent by nature (this extension is
 * symlinked into ~/.pi/agent/extensions/, so relative paths mean nothing),
 * and a machine without yoki must get a quietly disabled extension — one
 * stderr line, never a throw that reaches pi's extension loader.
 */
function loadGraphMods(): GraphMods | null {
  const roots: string[] = [];
  const fromEnv = process.env.YOKI_ROOT;
  if (fromEnv && fromEnv.trim()) roots.push(fromEnv.trim());
  roots.push(join(
    homedir(),
    "go", "github.com", "esh2n", "dotfiles",
    "domains", "dev", "config", "claude-profiles", "runtime", "yoki",
  ));
  for (const root of roots) {
    const libDir = join(root, "scripts", "lib", "graph");
    try {
      if (!fs.existsSync(join(libDir, "top.js"))) continue;
      // createRequire against a filename inside libDir so the CJS modules'
      // own relative requires (./journal, ./top-fold, …) resolve in place.
      const req = createRequire(join(libDir, "_pi-widget-loader.js"));
      const top = req("./top.js") as Pick<GraphMods, "graphRoot" | "buildViews">;
      const widget = req("./widget-lines.js") as Pick<GraphMods, "widgetLines">;
      return { graphRoot: top.graphRoot, buildViews: top.buildViews, widgetLines: widget.widgetLines };
    } catch (err) {
      console.error(`yoki-graph-widget disabled: failed to load ${libDir} (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  }
  console.error("yoki-graph-widget disabled: yoki graph lib not found (set YOKI_ROOT or keep the default dotfiles path)");
  return null;
}

export default function (pi: ExtensionAPI) {
  let mods: GraphMods | null = null;
  let loadFailed = false; // one stderr line total, not one per session_start
  let ui: ExtensionContext["ui"] | null = null;
  let running = false;
  const host = hostname();

  // Persistent across refreshes: each RunView holds an incremental FileTail
  // whose byte offset must survive between reads (top.js's contract).
  const views = new Map<string, unknown>();
  const dirty = new Set<string>();
  let refreshAll = true;
  let activeViews: RunViewLike[] = [];
  let widgetSet = false;
  let requestRender: (() => void) | null = null;

  let rootWatcher: fs.FSWatcher | null = null;
  const runWatchers = new Map<string, fs.FSWatcher>();
  let coalesce: ReturnType<typeof setTimeout> | null = null;
  let safety: ReturnType<typeof setInterval> | null = null;

  /** Coalesced refresh request — at most one refresh per COALESCE_MS,
   *  trailing requests folded in, never dropped. */
  function schedule(): void {
    if (!running || coalesce) return;
    coalesce = setTimeout(() => {
      coalesce = null;
      refresh();
    }, COALESCE_MS);
    coalesce.unref?.();
  }

  /** Watch the graph state root for runDirs appearing/disappearing. May
   *  fail (root not created yet on a fresh machine) — the safety tick
   *  retries, so the widget appears once the first run ever starts. */
  function watchRoot(): void {
    if (!mods) return;
    try {
      const watcher = fs.watch(mods.graphRoot(process.env), () => {
        try {
          refreshAll = true; // a new/removed runDir — re-discover everything
          schedule();
        } catch { /* never propagate into pi */ }
      });
      watcher.on("error", () => {
        try { watcher.close(); } catch { /* already closed */ }
        // Null the handle so the safety tick's `if (!rootWatcher)` check
        // re-attaches — a dead watcher held here would watch nothing forever.
        if (rootWatcher === watcher) rootWatcher = null;
      });
      rootWatcher = watcher;
    } catch { /* root missing — safety tick retries */ }
  }

  /** Watch exactly the ACTIVE runDirs (top-level and nested lane runs): an
   *  events.ndjson append, run.json rename or lock change all fire the dir
   *  watch and mean "re-read this run". Finished runs cost no fd — a pi
   *  session lives much longer than any run, and the state root accretes.
   *  An errored watcher is closed and dropped; the safety tick's full
   *  refresh re-attaches it via this same sync. */
  function syncRunWatchers(): void {
    const wanted = new Map<string, string>();
    for (const view of activeViews) {
      wanted.set(view.runId, view.dir);
      for (const child of view.children || []) {
        if (child.liveness === "running" || child.liveness === "stale") {
          wanted.set(child.runId, child.dir);
        }
      }
    }
    for (const [runId, watcher] of [...runWatchers]) {
      if (wanted.has(runId)) continue;
      try { watcher.close(); } catch { /* already closed */ }
      runWatchers.delete(runId);
    }
    for (const [runId, dir] of wanted) {
      if (runWatchers.has(runId)) continue;
      try {
        const watcher = fs.watch(dir, () => {
          try {
            dirty.add(runId);
            schedule();
          } catch { /* never propagate into pi */ }
        });
        watcher.on("error", () => {
          try { watcher.close(); } catch { /* already closed */ }
          runWatchers.delete(runId);
        });
        runWatchers.set(runId, watcher);
      } catch { /* runDir vanished between discovery and watch — safety re-syncs */ }
    }
  }

  /** Re-read state and reconcile the widget: set it when runs become
   *  active, remove it when the last one settles, request a TUI redraw
   *  when it stays. All reading is incremental (dirty set) except after
   *  refreshAll — root changes and the safety tick. */
  function refresh(): void {
    if (!running || !mods || !ui) return;
    try {
      const now = Date.now();
      const tree = mods.buildViews(views, process.env, refreshAll ? null : dirty, now, host);
      refreshAll = false;
      dirty.clear();
      activeViews = tree.filter((v) => v.liveness === "running" || v.liveness === "stale");
      syncRunWatchers();
      if (activeViews.length && !widgetSet) {
        const lib = mods;
        ui.setWidget(WIDGET_KEY, (tui: { requestRender(force?: boolean): void }) => {
          // The component is pull-rendered: pi asks for lines at its own
          // redraw moments with the CURRENT width, so resize costs nothing
          // extra. Watch events land as requestRender() calls, and the
          // render itself is guarded — a render throw inside pi's TUI loop
          // must degrade to an empty widget, never crash the agent.
          requestRender = () => tui.requestRender();
          return {
            render: (width: number): string[] => {
              try {
                return lib.widgetLines(activeViews, width, Date.now());
              } catch {
                return [];
              }
            },
            invalidate: (): void => { /* stateless between renders */ },
            dispose: (): void => { /* watchers are owned by the extension, not the component */ },
          };
        }, { placement: "belowEditor" });
        widgetSet = true;
      } else if (!activeViews.length && widgetSet) {
        ui.setWidget(WIDGET_KEY, undefined);
        widgetSet = false;
        requestRender = null;
      }
      if (widgetSet) requestRender?.();
    } catch { /* a broken refresh must never reach pi — safety tick retries */ }
  }

  /** Release every resource. Idempotent — runs on shutdown AND before a
   *  session_start re-arms, so a reload never leaks a watcher. */
  function stop(clearWidget: boolean): void {
    running = false;
    if (coalesce) { clearTimeout(coalesce); coalesce = null; }
    if (safety) { clearInterval(safety); safety = null; }
    if (rootWatcher) {
      try { rootWatcher.close(); } catch { /* already closed */ }
      rootWatcher = null;
    }
    for (const watcher of runWatchers.values()) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    runWatchers.clear();
    views.clear();
    dirty.clear();
    activeViews = [];
    requestRender = null;
    if (clearWidget && widgetSet && ui) {
      try { ui.setWidget(WIDGET_KEY, undefined); } catch { /* UI already gone */ }
    }
    widgetSet = false;
    if (clearWidget) ui = null;
  }

  pi.on("session_start", (_event, ctx) => {
    try {
      stop(false); // session_start also fires on reload/new/resume — re-arm cleanly
      if (ctx.mode !== "tui") return; // a bottom widget only means something on a TTY
      if (!mods && !loadFailed) {
        mods = loadGraphMods();
        if (!mods) loadFailed = true;
      }
      if (!mods) return;
      ui = ctx.ui;
      running = true;
      refreshAll = true;
      watchRoot();
      safety = setInterval(() => {
        try {
          refreshAll = true; // full re-read at human timescale: dead-watcher net + elapsed tick
          if (!rootWatcher) watchRoot();
          schedule();
        } catch { /* never propagate into pi */ }
      }, SAFETY_MS);
      safety.unref?.();
      refresh();
    } catch (err) {
      console.error(`yoki-graph-widget disabled: ${err instanceof Error ? err.message : String(err)}`);
      loadFailed = true;
      stop(false);
    }
  });

  pi.on("session_shutdown", () => {
    try { stop(true); } catch { /* teardown must never throw into pi */ }
  });
}
