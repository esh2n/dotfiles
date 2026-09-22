import { describe, expect, test } from "bun:test";
import { hideFromModel, showToModel } from "../../../src/domain/skills/invocation";

const SKILL = [
  "---",
  "name: writeup",
  'description: "documents that are kept"',
  "allowed-tools: Read, Write",
  "---",
  "",
  "# Writeup",
  "",
  "Body text, unchanged.",
  "",
].join("\n");

function changed(edit: ReturnType<typeof hideFromModel>): string {
  if (edit.kind !== "changed") throw new Error(`expected a change, got ${edit.kind}`);
  return edit.text;
}

describe("hideFromModel", () => {
  test("adds the key and leaves every other byte alone", () => {
    const text = changed(hideFromModel(SKILL));

    expect(text).toBe(
      [
        "---",
        "name: writeup",
        'description: "documents that are kept"',
        "allowed-tools: Read, Write",
        "disable-model-invocation: true",
        "---",
        "",
        "# Writeup",
        "",
        "Body text, unchanged.",
        "",
      ].join("\n"),
    );
    // The point of the assertion above: the quoting, the comma spacing and the body are the
    // author's, and an experiment switch that reformats them hands back 54 files of noise.
    expect(text.replace("disable-model-invocation: true\n", "")).toBe(SKILL);
  });

  test("flips an existing false rather than adding a second key", () => {
    const text = changed(
      hideFromModel(SKILL.replace("allowed-tools: Read, Write", "disable-model-invocation: false")),
    );

    expect(text).toContain("disable-model-invocation: true");
    expect(text.match(/disable-model-invocation:/g)?.length).toBe(1);
  });

  test("a skill already hidden is unchanged, not rewritten", () => {
    const hidden = changed(hideFromModel(SKILL));
    expect(hideFromModel(hidden)).toEqual({ kind: "unchanged" });
  });

  test("refuses a skill that sets user-invocable", () => {
    // `user-invocable: false` already closes the `/name` door; closing the model's too would
    // leave a skill with no way in at all.
    const guarded = SKILL.replace("allowed-tools: Read, Write", "user-invocable: false");
    expect(hideFromModel(guarded)).toEqual({ kind: "refused", why: "user-invocable" });
  });

  test("refuses a file with no frontmatter", () => {
    expect(hideFromModel("# just a body\n")).toEqual({ kind: "refused", why: "no-frontmatter" });
  });

  test("keeps CRLF line endings", () => {
    const text = changed(hideFromModel(SKILL.replace(/\n/g, "\r\n")));

    expect(text).toContain("disable-model-invocation: true\r\n---");
    expect(text).not.toMatch(/[^\r]\n/);
  });
});

describe("showToModel", () => {
  test("removes the key rather than setting it to false", () => {
    const text = changed(showToModel(changed(hideFromModel(SKILL))));

    // `false` is the documented default, so writing it would leave a line the author never
    // wrote, saying nothing.
    expect(text).toBe(SKILL);
    expect(text).not.toContain("disable-model-invocation");
  });

  test("a skill already listed is unchanged", () => {
    expect(showToModel(SKILL)).toEqual({ kind: "unchanged" });
  });

  test("refuses a skill that sets user-invocable, the same way hide does", () => {
    const guarded = "---\nname: x\nuser-invocable: false\ndisable-model-invocation: true\n---\n";
    expect(showToModel(guarded)).toEqual({ kind: "refused", why: "user-invocable" });
  });
});
