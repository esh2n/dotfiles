/**
 * `jig retire yoki [--write]` — list, and on `--write` remove, the artifacts
 * yoki and yoki-switch left on this machine that jig knows about, grouped
 * per harness, each with what it is and the evidence it is yoki's.
 * Milestone 4 of the generator that retires `yoki-switch`.
 *
 * Dry-run is the default. Everything is classified before anything is
 * removed (`domain/retire/classify.ts`, `domain/retire/codex-config.ts`),
 * and a path that does not match its evidence — a real file where a link
 * was expected, a staging directory that grew a regular file, a block with
 * no end marker — is reported as skipped and never forced. Removal order on
 * `--write`: files and links first, then the two rewritten files (each
 * renamed to `.pre-retire.<stamp>` before the new text lands atomically),
 * directories last. A refusal from the adapter (its own regular-file check
 * on a tree) is recorded per item and the run continues.
 *
 * What this command never touches: `~/.claude.json`; `~/.claude/settings.json`
 * (`jig apply --target claude` owns it, and its `statusLine.command` keeps
 * pointing at `~/.claude/scripts/statusline.sh`, which that apply now links
 * into `H/scripts/`); `~/.claude/{scripts,workflows}` (the same apply
 * replaces those links — this command skips their staging directories while
 * the links stand); `~/.codex/skills/.system` and anything in a harness
 * directory that is not named here; omp's `config.yml` (a ruling not made);
 * the source trees under `claude-profiles/` and `next/home/shared/harness/omp/`
 * that the removed links point into — jig does not delete repository files.
 */

import type { PathState } from "../../domain/claude/links";
import {
  type FoundEntry,
  MERGED_DIR_NAMES,
  type MergedDirName,
  classifyCmdSkillDir,
  classifyCursorRules,
  classifyLinkInto,
  classifyMergedDir,
  classifyStateDir,
  classifyYokiFile,
  mergedDirPath,
  parseCodexManifest,
} from "../../domain/retire/classify";
import {
  planConfigTomlRetire,
  planHooksJsonRetire,
  staleTrustTables,
} from "../../domain/retire/codex-config";
import {
  type RetireHarness,
  type RetireItem,
  isRemoval,
  retireBackupPath,
} from "../../domain/retire/items";
import type { RetirePorts } from "./ports";

export interface RetirePaths {
  /** `~/.claude` (or `CLAUDE_CONFIG_DIR`). */
  readonly claudeDir: string;
  /** `~/.codex` (or `CODEX_HOME`). */
  readonly codexHome: string;
  /** omp's agent directory, resolved as omp resolves it. */
  readonly ompAgentDir: string;
  /** `~/.cursor/rules`. */
  readonly cursorRules: string;
  /** `domains/dev/config/claude-profiles`, the retired tree yoki-switch linked from. */
  readonly claudeProfilesRoot: string;
  /** `next/home/shared/harness/omp/extensions`, where yoki's omp extensions live in the repo. */
  readonly ompRepoExtensions: string;
}

export interface RetireOptions {
  /** Called with the rewritten config.toml before it is planned as a rewrite; throw to refuse. */
  readonly validateToml?: (text: string) => void;
}

export interface RetireGroup {
  readonly harness: RetireHarness;
  readonly title: string;
  readonly items: readonly RetireItem[];
  /** Lines the group adds under its items: what it carries, what it leaves. */
  readonly notes: readonly string[];
}

export interface RetireFailure {
  readonly path: string;
  readonly error: string;
}

export interface RetireReport {
  readonly groups: readonly RetireGroup[];
  readonly write: boolean;
  /** True when `--write` ran the removals (whether or not every one succeeded). */
  readonly wrote: boolean;
  readonly counts: {
    readonly removals: number;
    readonly skipped: number;
    readonly absent: number;
  };
  /** Removals the adapter refused or that failed, in order. Empty on a dry-run. */
  readonly failures: readonly RetireFailure[];
}

async function listFound(ports: RetirePorts, dir: string): Promise<readonly FoundEntry[]> {
  const entries: FoundEntry[] = [];
  for (const name of await ports.listDir(dir)) {
    entries.push({ name, state: await ports.inspect(`${dir}/${name}`) });
  }
  return entries;
}

async function entriesIfDir(
  ports: RetirePorts,
  dir: string,
  state: PathState,
): Promise<readonly FoundEntry[]> {
  return state.kind === "dir" ? listFound(ports, dir) : [];
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

async function planClaude(ports: RetirePorts, paths: RetirePaths): Promise<RetireGroup> {
  const items: RetireItem[] = [];
  const dir = paths.claudeDir;

  // The one live link this command removes itself: hooks has no jig
  // successor — the five hooks are settings.json-inline (hooks-five-events).
  const hooksPath = `${dir}/hooks`;
  items.push(
    classifyLinkInto({
      harness: "claude",
      path: hooksPath,
      state: await ports.inspect(hooksPath),
      what: "yoki-switch's link to its hooks staging directory; jig's hooks are inline in settings.json",
      roots: [mergedDirPath(dir, "hooks")],
      rootsLabel: ".hooks-merged",
    }),
  );

  for (const name of MERGED_DIR_NAMES) {
    const path = mergedDirPath(dir, name);
    const state = await ports.inspect(path);
    items.push(
      classifyMergedDir({
        claudeDir: dir,
        name,
        state,
        entries: await entriesIfDir(ports, path, state),
        liveState: await ports.inspect(`${dir}/${name}`),
      }),
    );
  }

  const yokiDir = `${dir}/.yoki`;
  items.push(
    classifyStateDir(
      "claude",
      yokiDir,
      await ports.inspect(yokiDir),
      "yoki's hook-enforced permission set (permissions.json); the guard reads policy/guard-rules.json directly",
    ),
  );

  const packs = `${dir}/.claude-packs`;
  items.push(
    classifyYokiFile({
      harness: "claude",
      path: packs,
      state: await ports.inspect(packs),
      what: "yoki-switch's enabled-packs list; packs are gone (rules by paths:, skills by the judgment service)",
    }),
  );

  return {
    harness: "claude",
    title: "Claude Code",
    items,
    notes: [
      `${dir}/settings.json is not touched: jig apply --target claude owns it, and its statusLine.command`,
      "keeps naming ~/.claude/scripts/statusline.sh, which that apply links into H/scripts/.",
      "~/.claude/scripts and ~/.claude/workflows are that apply's too (managed directories since milestone 4);",
      "their staging directories are skipped here while those links still stand.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const CODEX_SKILL_PORT_LINKS = ["grilling", "code-graph-exploration"] as const;

async function planCodex(
  ports: RetirePorts,
  paths: RetirePaths,
  options: RetireOptions,
  now: Date,
): Promise<RetireGroup> {
  const items: RetireItem[] = [];
  const notes: string[] = [];
  const home = paths.codexHome;

  // hooks.json first: config.toml's plan needs to know which handlers go.
  const hooksJsonPath = `${home}/hooks.json`;
  const hooksText = await ports.readFile(hooksJsonPath);
  let removedHandlers: ReturnType<typeof planHooksJsonRetire>["removed"] = [];
  if (hooksText === undefined) {
    items.push({
      harness: "codex",
      path: hooksJsonPath,
      what: "Codex's hook registry; yoki's groups run through run-with-flags.js or read YOKI_*",
      evidence: "a hook group whose command references run-with-flags.js, $YOKI_ROOT or YOKI_",
      action: { kind: "absent" },
    });
  } else {
    try {
      const plan = planHooksJsonRetire(hooksText);
      removedHandlers = plan.removed;
      const removedLines = plan.removed.map(
        (h) => `${h.event}[${h.groupIndex}].hooks[${h.handlerIndex}]: ${shorten(h.command)}`,
      );
      const carried = [
        `${plan.keptGroups} group${plan.keptGroups === 1 ? "" : "s"} kept in order (jig's registered guard, orca's, herdr's, anything else)`,
        ...(plan.droppedEvents.length === 0
          ? []
          : [`events left with no group, dropped: ${plan.droppedEvents.join(", ")}`]),
        ...plan.shifted.map(
          (s) => `${s.event}: kept group moves ${s.from} → ${s.to} (${shorten(s.command)})`,
        ),
      ];
      items.push({
        harness: "codex",
        path: hooksJsonPath,
        what: "Codex's hook registry; yoki's groups run through run-with-flags.js or read YOKI_*",
        evidence: "a hook group whose command references run-with-flags.js, $YOKI_ROOT or YOKI_",
        action: plan.changed
          ? {
              kind: "rewrite",
              backup: retireBackupPath(hooksJsonPath, now),
              content: plan.text,
              removed: removedLines,
              carried,
            }
          : { kind: "skip", reason: "no yoki group in the file" },
      });
    } catch (error) {
      items.push({
        harness: "codex",
        path: hooksJsonPath,
        what: "Codex's hook registry",
        evidence: "a hook group whose command references run-with-flags.js, $YOKI_ROOT or YOKI_",
        action: { kind: "skip", reason: `will not parse: ${message(error)}` },
      });
    }
  }

  const configTomlPath = `${home}/config.toml`;
  const configText = await ports.readFile(configTomlPath);
  if (configText === undefined) {
    items.push({
      harness: "codex",
      path: configTomlPath,
      what: "Codex's config; yoki's block and permission tables",
      evidence:
        "the `# yoki:begin … # yoki:end` block, [permissions.yoki] tables, trust entries of removed handlers",
      action: { kind: "absent" },
    });
  } else {
    try {
      const plan = planConfigTomlRetire({
        text: configText,
        hooksJsonPath,
        removedHandlers,
      });
      const stale =
        hooksText === undefined
          ? []
          : staleTrustTables(
              plan.text,
              hooksJsonPath,
              (() => {
                try {
                  return planHooksJsonRetire(hooksText).shifted;
                } catch {
                  return [];
                }
              })(),
            );
      if (plan.changed) options.validateToml?.(plan.text);
      items.push({
        harness: "codex",
        path: configTomlPath,
        what: "Codex's config; yoki's block and permission tables",
        evidence:
          "the `# yoki:begin … # yoki:end` block, [permissions.yoki] tables, trust entries of removed handlers",
        action: plan.changed
          ? {
              kind: "rewrite",
              backup: retireBackupPath(configTomlPath, now),
              content: plan.text,
              removed: plan.removed,
              carried: [
                ...plan.carried.map(
                  (header) =>
                    `${header} lifted out of the block and kept: Codex's own switch (hooks = true is what runs jig's registered guard)`,
                ),
                "every other table byte for byte: [projects.*], jig's two blocks, [sandbox_workspace_write], the rest",
                ...stale.map(
                  (table) =>
                    `${table}: a trust entry of a kept handler whose group index shifts — stale after the rewrite; Codex re-prompts to trust it, and jig codex register re-trusts jig's own`,
                ),
              ],
            }
          : { kind: "skip", reason: "nothing of yoki's in the file" },
      });
    } catch (error) {
      items.push({
        harness: "codex",
        path: configTomlPath,
        what: "Codex's config",
        evidence: "the `# yoki:begin … # yoki:end` block, [permissions.yoki] tables",
        action: { kind: "skip", reason: `not safely editable: ${message(error)}` },
      });
    }
  }

  const rules = `${home}/rules/yoki.rules`;
  items.push(
    classifyYokiFile({
      harness: "codex",
      path: rules,
      state: await ports.inspect(rules),
      what: "yoki-switch's Codex rules file (permissions.yaml → to-codex.js); jig's guard is the PreToolUse hook",
      marker: { text: await ports.readFile(rules), needle: "GENERATED by yoki" },
    }),
  );

  const yokiDir = `${home}/.yoki`;
  items.push(
    classifyStateDir(
      "codex",
      yokiDir,
      await ports.inspect(yokiDir),
      "yoki's Codex manifest and permission set (codex-manifest.json, permissions.json)",
    ),
  );

  const skillsDir = `${home}/skills`;
  const skillsState = await ports.inspect(skillsDir);
  const skillEntries = await entriesIfDir(ports, skillsDir, skillsState);
  const manifestPaths = parseCodexManifest(await ports.readFile(`${yokiDir}/codex-manifest.json`));
  for (const entry of [...skillEntries].sort((a, b) => compare(a.name, b.name))) {
    const path = `${skillsDir}/${entry.name}`;
    if (entry.name.startsWith("cmd-")) {
      items.push(
        ...classifyCmdSkillDir({
          path,
          state: entry.state,
          entries: await entriesIfDir(ports, path, entry.state),
          manifestPaths,
        }),
      );
    } else if (entry.state.kind === "symlink") {
      items.push(
        classifyLinkInto({
          harness: "codex",
          path,
          state: entry.state,
          what: `yoki's link to a codex/SKILL.md port${(CODEX_SKILL_PORT_LINKS as readonly string[]).includes(entry.name) ? "" : " (a name the inventory did not list)"}; ports are dropped, the skill reaches Codex through ~/.agents/skills`,
          roots: [paths.claudeProfilesRoot],
          rootsLabel: "the retired claude-profiles/ tree",
        }),
      );
    }
  }
  const left = skillEntries.filter(
    (entry) => !entry.name.startsWith("cmd-") && entry.state.kind !== "symlink",
  );
  if (skillsState.kind === "dir") {
    notes.push(
      `${skillsDir}: ${left.length === 0 ? "nothing else there" : `left alone: ${left.map((e) => e.name).join(", ")}`} (Codex's .system/ is Codex's own; the directory itself stays)`,
    );
  }
  if (manifestPaths === undefined) {
    notes.push(
      "no readable .yoki/codex-manifest.json: cmd-* directories are matched against the inventory's sixteen names instead",
    );
  }

  return { harness: "codex", title: "Codex", items, notes };
}

// ---------------------------------------------------------------------------
// omp
// ---------------------------------------------------------------------------

async function planOmp(ports: RetirePorts, paths: RetirePaths): Promise<RetireGroup> {
  const items: RetireItem[] = [];
  const dir = paths.ompAgentDir;

  const hooks = `${dir}/yoki-hooks.json`;
  items.push(
    classifyYokiFile({
      harness: "omp",
      path: hooks,
      state: await ports.inspect(hooks),
      what: "yoki's hook registry for omp (omp-hooks.js); jig's hooks are the extension",
    }),
  );

  const rulesMd = `${dir}/RULES.md`;
  items.push(
    classifyYokiFile({
      harness: "omp",
      path: rulesMd,
      state: await ports.inspect(rulesMd),
      what: "yoki's sticky rules for omp (omp-rules-md.js); jig delivers rules through ~/.claude/CLAUDE.md",
      marker: { text: await ports.readFile(rulesMd), needle: "<!-- yoki:begin -->" },
    }),
  );

  const yokiDir = `${dir}/.yoki`;
  items.push(
    classifyStateDir(
      "omp",
      yokiDir,
      await ports.inspect(yokiDir),
      "yoki's omp manifest and permission set (omp-manifest.json, permissions.json)",
    ),
  );

  const extensions = `${dir}/extensions`;
  for (const name of ["yoki-bridge.ts", "yoki-guard.ts"]) {
    const path = `${extensions}/${name}`;
    items.push(
      classifyLinkInto({
        harness: "omp",
        path,
        state: await ports.inspect(path),
        what: "yoki's omp extension link (link_omp_resources); jig's extension is extensions/jig.ts",
        roots: [paths.ompRepoExtensions, paths.claudeProfilesRoot],
        rootsLabel: "next/home/shared/harness/omp/extensions/ or claude-profiles/",
      }),
    );
  }

  return {
    harness: "omp",
    title: "omp",
    items,
    notes: [
      `${dir}/config.yml is not touched: yoki generated it, but what jig should write there is a ruling not yet made.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

async function planCursor(ports: RetirePorts, paths: RetirePaths): Promise<RetireGroup> {
  const dir = paths.cursorRules;
  const state = await ports.inspect(dir);
  const result = classifyCursorRules({
    dir,
    entries: await entriesIfDir(ports, dir, state),
    yokiCursorRules: `${paths.claudeProfilesRoot}/runtime/yoki/.cursor/rules`,
  });
  const notes =
    state.kind !== "dir"
      ? [`${dir}: ${state.kind === "missing" ? "absent" : "not a directory"}; nothing to do`]
      : [
          `${result.items.length} link${result.items.length === 1 ? "" : "s"} into claude-profiles/runtime/yoki/.cursor/rules/; ${result.foreign.length} other entr${result.foreign.length === 1 ? "y" : "ies"} left alone${result.foreign.length === 0 ? "" : ` (${result.foreign.map((e) => e.name).join(", ")})`}; the directory stays.`,
        ];
  return { harness: "cursor", title: "Cursor", items: result.items, notes };
}

// ---------------------------------------------------------------------------
// The use-case
// ---------------------------------------------------------------------------

export async function retireYoki(
  input: { readonly paths: RetirePaths; readonly write: boolean; readonly options?: RetireOptions },
  ports: RetirePorts,
): Promise<RetireReport> {
  const now = ports.now();
  const options = input.options ?? {};
  const groups: RetireGroup[] = [
    await planClaude(ports, input.paths),
    await planCodex(ports, input.paths, options, now),
    await planOmp(ports, input.paths),
    await planCursor(ports, input.paths),
  ];
  const items = groups.flatMap((group) => group.items);
  const counts = {
    removals: items.filter((item) => isRemoval(item.action)).length,
    skipped: items.filter((item) => item.action.kind === "skip").length,
    absent: items.filter((item) => item.action.kind === "absent").length,
  };

  if (!input.write || counts.removals === 0) {
    return { groups, write: input.write, wrote: false, counts, failures: [] };
  }

  const failures: RetireFailure[] = [];
  const attempt = async (path: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      failures.push({ path, error: message(error) });
    }
  };

  // Files and links first, then the rewrites, directories last — a cmd-*
  // directory's SKILL.md is gone before the (then empty) directory is.
  for (const item of items) {
    if (item.action.kind === "remove-file")
      await attempt(item.path, () => ports.removeFile(item.path));
    if (item.action.kind === "remove-link")
      await attempt(item.path, () => ports.removeLink(item.path));
  }
  for (const item of items) {
    const { action } = item;
    if (action.kind !== "rewrite") continue;
    await attempt(item.path, async () => {
      await ports.rename(item.path, action.backup);
      await ports.writeAtomic(item.path, action.content);
    });
  }
  for (const item of items) {
    if (item.action.kind === "remove-tree")
      await attempt(item.path, () => ports.removeTree(item.path));
  }

  return { groups, write: true, wrote: true, counts, failures };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A hook command line, cut to what identifies it. */
function shorten(command: string): string {
  return command.length <= 96 ? command : `${command.slice(0, 93)}…`;
}
