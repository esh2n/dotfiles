import { describe, expect, test } from "bun:test";
import {
  missingQuotes,
  parsePrecedence,
  precedenceFiles,
  rowsTouchedBy,
} from "../../../src/domain/plugins/precedence";

const COMMIT = "019a6a20592c10bf92869e5740368f578a9997fd";
const OPENING = "pstack/skills/poteto-mode/playbooks/opening-a-pr.md";
const MODE = "pstack/skills/poteto-mode/SKILL.md";
const VALID = {
  _comment: "ignored",
  verifiedAt: COMMIT,
  rows: [
    { id: "pr-readiness", quotes: [{ file: OPENING, text: "Open every PR ready." }] },
    {
      id: "outward-writes",
      quotes: [
        { file: MODE, text: "proceed without asking." },
        { file: OPENING, text: "ticket updates" },
      ],
    },
  ],
};

describe("parsePrecedence", () => {
  test("reads the rows, their quotes and the verified commit", () => {
    const table = parsePrecedence("pstack", JSON.stringify(VALID));
    expect(table.verifiedAt).toBe(COMMIT);
    expect(table.rows.map((row) => row.id)).toEqual(["pr-readiness", "outward-writes"]);
    expect(table.rows[1]?.quotes[0]).toEqual({ file: MODE, text: "proceed without asking." });
  });

  test("verifiedAt is optional", () => {
    const table = parsePrecedence("pstack", JSON.stringify({ rows: [] }));
    expect(table.verifiedAt).toBeUndefined();
  });

  test("a malformed table is refused with the reason", () => {
    const bad = (value: unknown) => () => parsePrecedence("pstack", JSON.stringify(value));
    expect(() => parsePrecedence("pstack", "{")).toThrow("not JSON");
    expect(bad([])).toThrow("must be an object");
    expect(bad({ rows: {} })).toThrow('"rows"');
    expect(bad({ ...VALID, verifiedAt: "abc" })).toThrow("40 hex");
    expect(bad({ rows: [{ id: "", quotes: [] }] })).toThrow("id");
    expect(bad({ rows: [{ id: "a", quotes: "x" }] })).toThrow("quotes");
    expect(bad({ rows: [{ id: "a", quotes: [{ file: "../x", text: "t" }] }] })).toThrow(
      "inside the checkout",
    );
    expect(bad({ rows: [{ id: "a", quotes: [{ file: "x.md", text: "" }] }] })).toThrow("text");
    expect(
      bad({
        rows: [
          { id: "a", quotes: [] },
          { id: "a", quotes: [] },
        ],
      }),
    ).toThrow("twice");
  });
});

describe("precedenceFiles", () => {
  test("each quoted file once, in order", () => {
    expect(precedenceFiles(parsePrecedence("pstack", JSON.stringify(VALID)))).toEqual([
      OPENING,
      MODE,
    ]);
  });
});

describe("missingQuotes", () => {
  const table = parsePrecedence("pstack", JSON.stringify(VALID));

  test("nothing is missing when every quote is in its file verbatim", () => {
    const contents = new Map([
      [OPENING, "x\nOpen every PR ready. Also ticket updates\n"],
      [MODE, "and proceed without asking."],
    ]);
    expect(missingQuotes(table, contents)).toEqual([]);
  });

  test("a rewritten quote and a removed file are both named, row by row", () => {
    const contents = new Map<string, string | undefined>([
      [OPENING, "Open every PR as a draft. ticket updates"],
      [MODE, undefined],
    ]);
    expect(missingQuotes(table, contents)).toEqual([
      { id: "pr-readiness", file: OPENING, text: "Open every PR ready.", fileMissing: false },
      { id: "outward-writes", file: MODE, text: "proceed without asking.", fileMissing: true },
    ]);
  });

  test("verbatim means verbatim: case and spacing count", () => {
    const contents = new Map([
      [OPENING, "open every PR ready. ticket  updates"],
      [MODE, "proceed without asking."],
    ]);
    expect(missingQuotes(table, contents).map((m) => m.text)).toEqual([
      "Open every PR ready.",
      "ticket updates",
    ]);
  });
});

describe("rowsTouchedBy", () => {
  const table = parsePrecedence("pstack", JSON.stringify(VALID));

  test("the rows whose quoted files changed, with those files", () => {
    expect(rowsTouchedBy(table, [OPENING, "pstack/README.md"])).toEqual([
      { id: "pr-readiness", files: [OPENING] },
      { id: "outward-writes", files: [OPENING] },
    ]);
  });

  test("no changed file, no row", () => {
    expect(rowsTouchedBy(table, ["pstack/README.md"])).toEqual([]);
  });
});
