/**
 * jig's own source, as it goes into a box. Read relative to this file rather
 * than from `process.cwd()`, so the box gets the jig that launched it and not
 * whatever jig happens to be under the working directory.
 *
 * `src/**` plus the three files `bun install` needs — no `node_modules` (the
 * box installs its own, for linux/arm64) and no `test/` (nothing in the box
 * runs it, and it is the largest part of the tree).
 */

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { JigSource, SourceReader } from "../../app/box/ports";

/** The files `bun install --frozen-lockfile` needs, plus the config tsc reads. */
const ROOT_FILES = ["package.json", "bun.lock", "tsconfig.json"];

/**
 * What the agent is told about where it is. Kept short and factual: the box's
 * posture is enforced by the kit and by sbx, not by asking nicely — this only
 * saves the agent from discovering the constraints by hitting them.
 */
const BOX_INSTRUCTIONS = `# Working inside a jig box

This is a Docker Sandboxes microVM, not the host.

- The repository here is a **clone**. The host checkout is mounted read-only
  and is not what you are editing. Commit your work on a branch; that is the
  only way it leaves — the human fetches it with \`jig box fetch\`.
- You cannot push. The clone is fetch-only from the host's side and there is
  no write path back.
- There are no credentials here unless this box was created with \`--pr\`, in
  which case a GitHub token reaches github.com through the host-side proxy and
  never enters this VM as a value. No SSH agent reaches here either: jig
  refuses to create a box at all while sbx would forward one.
- You are **not** in bypass mode. jig launches Claude Code with
  \`--permission-mode auto\`, and codex with \`--approve-for-me\` inside codex's
  own workspace-write sandbox — not the \`--dangerously-*\` entrypoints the
  stock sandbox images use. Approvals still mean something here.
- jig's guard runs in front of your tool calls with the same rules as the
  host. A denial here means the same thing it means there.
- Network egress is filtered. Package registries and github.com are allowed;
  anything else will fail to resolve rather than hang.
`;

function jigRoot(): string {
  // src/infra/box/ -> src/infra -> src -> <jig>
  return join(import.meta.dir, "..", "..", "..");
}

async function readTextOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Every file under `dir`, as paths relative to `base`, with `/` separators. */
async function collect(dir: string, base: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files[relative(base, absolute).split(sep).join("/")] = await readFile(absolute, "utf8");
  }
  return files;
}

export interface JigSourceReaderOptions {
  /** Overridable for tests; defaults to the checkout this file lives in. */
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The guard policy the box will judge with: the machine's linked copy first,
 * since that is what the host is actually running, and the repository's copy
 * as a fallback so a machine that has not run `jig apply` yet still gets a
 * guard rather than an empty one.
 */
async function readGuardRules(root: string, home: string): Promise<string> {
  const linked = join(home, ".config", "jig", "policy", "guard-rules.json");
  const inRepo = join(root, "..", "policy", "guard-rules.json");
  const text = (await readTextOrUndefined(linked)) ?? (await readTextOrUndefined(inRepo));
  if (text === undefined) {
    throw new Error(`no guard policy found at ${linked} or ${inRepo}`);
  }
  return text;
}

export function createJigSourceReader(options: JigSourceReaderOptions = {}): SourceReader {
  const root = options.root ?? jigRoot();
  const env = options.env ?? process.env;

  return {
    async read(): Promise<JigSource> {
      const files: Record<string, string> = await collect(join(root, "src"), root);
      for (const name of ROOT_FILES) {
        const text = await readTextOrUndefined(join(root, name));
        if (text !== undefined) files[name] = text;
      }
      return {
        files,
        guardRules: await readGuardRules(root, env.HOME ?? homedir()),
        instructions: BOX_INSTRUCTIONS,
      };
    },
  };
}
