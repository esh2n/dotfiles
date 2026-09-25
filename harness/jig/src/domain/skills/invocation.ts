/**
 * The switch arm B' of the skill-selection experiment flips: whether the harness lists a
 * skill to the model at all.
 *
 * `disable-model-invocation: true` is Claude Code's own field — "Set to `true` to prevent
 * Claude from automatically loading this skill. Use for workflows you want to trigger
 * manually with `/name`" (https://code.claude.com/docs/en/skills.md). Setting it on every
 * routable skill removes the list from the prompt, leaving `/name` and the router's
 * injection as the only ways in. That is the arm: the router's selection instead of the
 * harness's, measured against the same requests.
 *
 * The one hard rule here is that this edit touches ONE key. A skill's frontmatter is the
 * author's, it is checked into a repository somewhere, and an experiment switch that
 * reformats YAML on its way through would hand back 54 files of diff noise and no way to
 * tell what it changed. So the frontmatter is edited as text — the block is found, one line
 * is replaced, removed or appended, and every other byte of the file, delimiters and body
 * included, is carried through untouched. Nothing is parsed and re-emitted.
 *
 * `user-invocable: false` is refused rather than edited. That field means "only Claude
 * should invoke the skill: Claude Code hides it from the `/` menu and doesn't run it when
 * you type `/name`". Hiding model invocation on top of it would leave a skill with no way in
 * at all — not a hidden skill, a dead one. The two fields are the two doors, and this
 * command is only allowed to close one of them.
 */

const KEY = "disable-model-invocation";

/** What a toggle would do to one SKILL.md. */
export type InvocationEdit =
  | { readonly kind: "changed"; readonly text: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly why: RefusalReason };

export type RefusalReason = "no-frontmatter" | "user-invocable";

interface Frontmatter {
  readonly before: string;
  readonly body: string;
  readonly lines: readonly string[];
  readonly eol: string;
}

/**
 * The frontmatter block as text. The same shape `infra/skills/catalog.ts` recognises, split
 * so the caller can put the file back together from the parts it did not touch.
 */
function frontmatterOf(text: string): Frontmatter | undefined {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (match === null) return undefined;
  const opening = match[1] ?? "";
  const front = match[2] ?? "";
  return {
    before: opening,
    body: text.slice(opening.length + front.length),
    lines: front.split(/\r?\n/),
    eol: opening.endsWith("\r\n") ? "\r\n" : "\n",
  };
}

function rebuild(front: Frontmatter, lines: readonly string[]): string {
  return front.before + lines.join(front.eol) + front.body;
}

function indexOfKey(lines: readonly string[], key: string): number {
  return lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
}

function check(text: string): Frontmatter | { readonly why: RefusalReason } {
  const front = frontmatterOf(text);
  if (front === undefined) return { why: "no-frontmatter" };
  if (indexOfKey(front.lines, "user-invocable") !== -1) return { why: "user-invocable" };
  return front;
}

/**
 * Hide the skill from the model's listing.
 *
 * Appended as the frontmatter's last line when the key is absent, because that is the only
 * position that cannot change the meaning of a neighbouring line — a block scalar swallows
 * anything indented that follows it, and inserting "somewhere sensible" would mean knowing
 * which lines those are.
 */
export function hideFromModel(text: string): InvocationEdit {
  const front = check(text);
  if ("why" in front) return { kind: "refused", why: front.why };

  const at = indexOfKey(front.lines, KEY);
  if (at === -1) {
    return { kind: "changed", text: rebuild(front, [...front.lines, `${KEY}: true`]) };
  }
  if (/^disable-model-invocation:\s*true\s*$/.test(front.lines[at] ?? "")) {
    return { kind: "unchanged" };
  }
  const lines = [...front.lines];
  lines[at] = `${KEY}: true`;
  return { kind: "changed", text: rebuild(front, lines) };
}

/**
 * Put the skill back in the listing, by removing the key rather than setting it to `false`.
 *
 * Removing is what restores the file the experiment started from: `false` is the documented
 * default, so a left-behind `disable-model-invocation: false` would be a line the author
 * never wrote, in a file the author owns, saying nothing.
 *
 * This cannot tell a skill jig hid from one its author hid — the field is the same field —
 * so the dry run IS the review step, and it prints every skill it would unhide.
 */
export function showToModel(text: string): InvocationEdit {
  const front = check(text);
  if ("why" in front) return { kind: "refused", why: front.why };

  const at = indexOfKey(front.lines, KEY);
  if (at === -1) return { kind: "unchanged" };
  return {
    kind: "changed",
    text: rebuild(
      front,
      front.lines.filter((_line, index) => index !== at),
    ),
  };
}
