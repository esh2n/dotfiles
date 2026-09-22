/**
 * What the end-of-turn gate runs, and how much of a failure the model sees.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md`: 型検査と lint は
 * 応答の終わりで関門にし、出力は末尾だけに切り詰める。One project, one check —
 * the gate is a backstop behind the LSP diagnostics and the per-edit
 * formatter, not a build.
 *
 * The decision's cost note is the reason for `tail`: 「Stop の関門は空回りすると
 * 高い(35k トークン・20 分の記録)」. A whole `tsc` log in the model's context is
 * exactly that cost, and the last lines are what it needs to act.
 *
 * Pure: `exists` is injected, nothing is executed.
 */

const TAIL_LINES = 40;
const TAIL_CHARS = 4_000;

export interface GateCommand {
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/** The check this project answers to, by what is in its root. */
export function gateCommandFor(
  cwd: string,
  exists: (path: string) => boolean,
): GateCommand | undefined {
  const has = (name: string): boolean => exists(`${cwd}/${name}`);
  if (has("tsconfig.json")) {
    return { label: "bunx tsc --noEmit", bin: "bunx", args: ["tsc", "--noEmit"] };
  }
  if (has("go.mod")) return { label: "go vet ./...", bin: "go", args: ["vet", "./..."] };
  if (has("pyproject.toml") || has("ruff.toml") || has(".ruff.toml")) {
    return { label: "ruff check", bin: "ruff", args: ["check", "."] };
  }
  if (has("Cargo.toml")) {
    return { label: "cargo check", bin: "cargo", args: ["check", "--quiet"] };
  }
  return undefined;
}

/** The last lines of a failed run, which is all the model needs to act. */
export function tail(text: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length <= chars ? kept : kept.slice(kept.length - chars);
}
