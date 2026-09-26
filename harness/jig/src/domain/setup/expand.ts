/**
 * The placeholders a repo-owned harness file carries for what differs per
 * machine. DSH reads paths literally, so its copies are filled in before they
 * are installed (`app/setup/setup-harness.ts`).
 */

export interface ExpandVars {
  readonly home: string;
  readonly user: string;
  readonly dotfilesRoot: string;
}

/** Fill `{{HOME}}`, `{{USER}}` and `{{DOTFILES_ROOT}}`; every other `{{…}}` is left as written. */
export function expandPlaceholders(text: string, vars: ExpandVars): string {
  return text
    .replaceAll("{{HOME}}", vars.home)
    .replaceAll("{{USER}}", vars.user)
    .replaceAll("{{DOTFILES_ROOT}}", vars.dotfilesRoot);
}
