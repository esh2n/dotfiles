import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
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
//   The factory's second argument is pi's Theme (modes/interactive/theme/
//   theme.d.ts): `fg(color, text)` wraps text in the theme's ANSI for a
//   semantic color name ("accent" | "success" | "error" | "warning" |
//   "dim" | …). widget-lines.js's widgetLinesRich takes a paint callback
//   and applies it only AFTER sanitize/truncate/pad, so theme escapes are
//   never measured as display cells; the roles it uses are mapped to those
//   theme colors below. NO_COLOR (set and non-empty) drops the paint
//   entirely — the widget then renders the same layout in plain text.

const WIDGET_KEY = "yoki-graph";

/** The env var runner.js/agent-cli.js read to stamp a run's originating
 *  session into run.json. Setting it here (and inheriting it into pi's bash
 *  children) is what lets the widget show only the runs THIS pi launched. */
const SCOPE_ENV = "YOKI_RUN_SCOPE";

/** Charset for a scope value, mirrored from runner.js's runScope: the value
 *  becomes a run.json field and a filter key, so anything outside this is
 *  rejected in favour of a random id. */
const RUN_SCOPE_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * This pi session's scope, `pi-<sessionId>`. pi exposes no `ctx.sessionId`
 * (verified against 0.84.4 dist/core/extensions/types.d.ts and
 * session-manager.d.ts) — the stable per-session id is
 * `ctx.sessionManager.getSessionId()`. When that is unavailable (older pi) or
 * yields something the scope charset would reject, fall back to a random id so
 * the session is always scoped to a unique value rather than silently sharing
 * an unscoped view with every other session on the machine. session_start
 * re-fires on resume/fork, so a forked session re-derives its own scope.
 */
function sessionScope(ctx: ExtensionContext): string {
  let id = "";
  try {
    const mgr = ctx.sessionManager as { getSessionId?: () => string } | undefined;
    if (mgr && typeof mgr.getSessionId === "function") id = mgr.getSessionId() || "";
  } catch { /* fall through to a random id */ }
  const scope = `pi-${id}`;
  return RUN_SCOPE_RE.test(scope) ? scope : `pi-${randomUUID()}`;
}

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

/** What widget-lines needs from the caller to color a finished cell —
 *  structural, so an older yoki checkout without the rich renderer (or a
 *  paintless call) still typechecks. */
type WidgetPaint = (role: string, text: string) => string;

interface GraphMods {
  graphRoot(env: NodeJS.ProcessEnv): string;
  buildViews(
    views: Map<string, unknown>,
    env: NodeJS.ProcessEnv,
    dirty: Set<string> | null,
    now: number,
    host: string,
  ): RunViewLike[];
  widgetLines(views: RunViewLike[], width: number, now: number, selfScope?: string): string[];
  /** Themed, aligned layout (newer yoki); absent on older checkouts —
   *  the loader keeps the plain widgetLines as the fallback. */
  widgetLinesRich?(views: RunViewLike[], width: number, now: number, paint?: WidgetPaint, selfScope?: string): string[];
}

/** The subset of pi's Theme the paint callback uses — structural on
 *  purpose (the concrete Theme class is an internal d.ts path). */
interface ThemeLike {
  fg?(color: string, text: string): string;
}

/** widget-lines roles → pi semantic theme colors. The names coincide
 *  today, but the mapping is explicit so a widget-lines role can never
 *  silently reach theme.fg as an unknown color name. */
const ROLE_COLORS: Record<string, string> = {
  accent: "accent",
  success: "success",
  error: "error",
  warning: "warning",
  dim: "dim",
};

/**
 * Theme-backed paint for widgetLinesRich, or null for plain output.
 * Null when the user opted out (NO_COLOR set and non-empty) or the theme
 * cannot color; any theme.fg throw degrades to the plain cell — a color
 * problem must never cost the widget its text.
 */
function makePaint(theme: ThemeLike | undefined): WidgetPaint | null {
  const noColor = process.env.NO_COLOR;
  if (typeof noColor === "string" && noColor !== "") return null;
  if (!theme || typeof theme.fg !== "function") return null;
  return (role, text) => {
    const color = ROLE_COLORS[role];
    if (!color || !text) return text;
    try {
      return theme.fg!(color, text);
    } catch {
      return text;
    }
  };
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
      const widget = req("./widget-lines.js") as Pick<GraphMods, "widgetLines" | "widgetLinesRich">;
      return {
        graphRoot: top.graphRoot,
        buildViews: top.buildViews,
        widgetLines: widget.widgetLines,
        widgetLinesRich: typeof widget.widgetLinesRich === "function" ? widget.widgetLinesRich : undefined,
      };
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
  let selfScope: string | undefined; // this pi session's YOKI_RUN_SCOPE
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
        ui.setWidget(WIDGET_KEY, (tui: { requestRender(force?: boolean): void }, theme?: ThemeLike) => {
          // The component is pull-rendered: pi asks for lines at its own
          // redraw moments with the CURRENT width, so resize costs nothing
          // extra. Watch events land as requestRender() calls, and the
          // render itself is guarded — a render throw inside pi's TUI loop
          // must degrade to an empty widget, never crash the agent.
          requestRender = () => tui.requestRender();
          const paint = makePaint(theme);
          return {
            render: (width: number): string[] => {
              try {
                // Rich (themed, aligned, bars) when this yoki checkout has
                // it; plain widgetLines otherwise — same visibility rules.
                return lib.widgetLinesRich
                  ? lib.widgetLinesRich(activeViews, width, Date.now(), paint ?? undefined, selfScope)
                  : lib.widgetLines(activeViews, width, Date.now(), selfScope);
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
      // Stamp this session's scope into the environment BEFORE the tui guard:
      // runs launched from pi's bash tool (a child process) inherit it and
      // land in run.json with this session's scope, whether or not a widget
      // is drawn. Re-derived on every session_start, so resume/fork rescopes.
      selfScope = sessionScope(ctx);
      process.env[SCOPE_ENV] = selfScope;
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
    try {
      // Stop stamping runs with a scope that no longer has a live widget.
      // A reload/replacement fires session_start next, which re-sets it; a
      // real quit leaves the env clean for whatever the shell does after pi.
      if (process.env[SCOPE_ENV] === selfScope) delete process.env[SCOPE_ENV];
      selfScope = undefined;
    } catch { /* env cleanup must never throw into pi */ }
    try { stop(true); } catch { /* teardown must never throw into pi */ }
  });
}
