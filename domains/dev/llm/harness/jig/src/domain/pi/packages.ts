/**
 * pi's `packages` setting, read to REPORT whether an extension jig relies on
 * is declared — never to write it. Two extensions matter to the generator:
 * pi-mcp-adapter (the MCP delivery of
 * `rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md`) and
 * tintinweb/pi-subagents (the workflow runner of
 * `rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`, the one
 * that runs a Claude Code workflow script unchanged per
 * `rules/research/2026-09-22-workflow-script-portability.md` §1).
 *
 * pi's own documentation fixes the shape:
 * - https://pi.dev/docs/latest/settings ("Resources"): `packages` — "npm,
 *   git, or local Pi package sources".
 * - https://pi.dev/docs/latest/packages ("Install and manage packages"):
 *   `pi install npm:<pkg>[@version]`; "Personal installs are written to
 *   `~/.pi/agent/settings.json`". ("Select package resources"): an entry is
 *   either a source string or an object with `source` and per-resource
 *   filters. ("Understand scope and identity"): "Pi identifies npm packages
 *   by package name", so `npm:pi-mcp-adapter` and `npm:pi-mcp-adapter@1.2.3`
 *   are the same package.
 *
 * On the machine this is for, `~/.pi/agent/settings.json` is a symlink into
 * the repository (`domains/dev/config/pi/settings.json`, made by
 * `core/config/manager.sh link_pi_resources`), so the REPO file is the
 * source that is read here; the generator reads sources only.
 *
 * Pure: the caller hands over the file's text.
 */

/** The npm package name of pi-mcp-adapter (README, "Install": `pi install npm:pi-mcp-adapter`). */
export const PI_MCP_ADAPTER_NPM = "pi-mcp-adapter";

/** The npm package name of tintinweb/pi-subagents (portability record §1: `pi install npm:@tintinweb/pi-subagents`). */
export const PI_SUBAGENTS_NPM = "@tintinweb/pi-subagents";

export interface PiPackages {
  /** Every declared source, verbatim (`npm:x`, `git:…`, `https://…`, `./local`), in file order. */
  readonly sources: readonly string[];
  /** Set when the file could not be read as a JSON object; `sources` is then empty. */
  readonly invalid?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `packages` array of a pi settings.json, string and object entries alike; anything else is skipped. */
export function parsePiPackages(text: string | undefined): PiPackages {
  if (text === undefined || text.trim() === "") return { sources: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { sources: [], invalid: error instanceof Error ? error.message : String(error) };
  }
  if (!isObject(value)) return { sources: [], invalid: "the top level is not a JSON object" };
  const packages = Array.isArray(value.packages) ? value.packages : [];
  const sources: string[] = [];
  for (const entry of packages) {
    if (typeof entry === "string") sources.push(entry);
    else if (isObject(entry) && typeof entry.source === "string") sources.push(entry.source);
  }
  return { sources };
}

/**
 * The npm package name a source names, or undefined for git/local sources.
 * `npm:@scope/name@1.0.0` → `@scope/name`; `npm:name@^2` → `name`.
 */
export function npmPackageName(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice("npm:".length);
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

/** The declared source for an npm package, by pi's identity rule (package name, any version), or undefined. */
export function findNpmPackage(packages: PiPackages, name: string): string | undefined {
  return packages.sources.find((source) => npmPackageName(source) === name);
}

/** The `pi install` line that records the package in the user settings (packages doc, "Install and manage packages"). */
export function piInstallLine(name: string): string {
  return `pi install npm:${name}`;
}

/** The entry to add to the `packages` array by hand, as it would appear in the file. */
export function piPackagesEntry(name: string): string {
  return JSON.stringify(`npm:${name}`);
}
