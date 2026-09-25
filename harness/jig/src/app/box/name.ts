/**
 * What a box is called. The name is the only handle a box has — resume,
 * fetch and rm all take it — so it is derived, not stored: the same agent,
 * repository and branch always produce the same name, and jig can find
 * yesterday's box without a state file.
 *
 * The shape sbx accepts (`sbx create --help`): "at least two characters,
 * starting with a letter or number, containing only letters, numbers,
 * hyphens and periods; 'default' is reserved".
 */

/** sbx accepts longer names, but a name is read in a list; 60 keeps it one line. */
const MAX_LENGTH = 60;

/** sbx reserves this one, so a repo actually called `default` still gets a usable box. */
const RESERVED = "default";

export interface BoxNameInput {
  readonly agent: string;
  readonly repoPath: string;
  readonly branch: string;
}

/** Last segment of a path, ignoring trailing slashes. */
export function repoBasename(repoPath: string): string {
  const parts = repoPath.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? "";
}

/**
 * One segment reduced to sbx's alphabet. Separators (`/`, `_`, whitespace)
 * become hyphens so `feat/jig-box` stays readable; anything else is dropped
 * rather than transliterated, because a name nobody can type back is worse
 * than a short one.
 */
function sanitize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/_\s]+/g, "-")
    .replace(/[^a-z0-9.-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
}

export function boxName(input: BoxNameInput): string {
  const joined = [input.agent, repoBasename(input.repoPath), input.branch]
    .map(sanitize)
    .filter((part) => part !== "")
    .join("-");

  // Truncation can leave a trailing separator, which sbx tolerates but reads
  // badly; trim again after cutting.
  let name = sanitize(joined)
    .slice(0, MAX_LENGTH)
    .replace(/[.-]+$/, "");
  if (name === "") name = "box";
  if (name.length < 2) name = `${name}-box`;
  if (name === RESERVED) name = `${RESERVED}-box`;
  return name;
}

/**
 * The prefix every box for this agent and repository shares, so the
 * interactive entry point can list "boxes for this repo" without a registry:
 * the branch is whatever follows.
 */
export function boxNamePrefix(agent: string, repoPath: string): string {
  return `${sanitize(agent)}-${sanitize(repoBasename(repoPath))}-`;
}
