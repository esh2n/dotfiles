import { describe, expect, test } from "bun:test";
import type { PluginCheckout } from "../../src/app/apply/plugins";
import { pluginLines } from "../../src/cli/apply";

const VERIFIED = "019a6a20592c10bf92869e5740368f578a9997fd";
const NEWER = "1111111111112222222222223333333333334444";
const OPENING = "pstack/skills/poteto-mode/playbooks/opening-a-pr.md";
const MODE = "pstack/skills/poteto-mode/SKILL.md";

function pack(patch: Partial<PluginCheckout>): PluginCheckout {
  return {
    name: "pstack",
    dir: "/p/pstack",
    source: {
      name: "pstack",
      repo: "https://github.com/cursor/plugins",
      ref: "main",
      skills: "pstack/skills",
      translated: [],
    },
    present: true,
    skillsDir: "/p/pstack/pstack/skills",
    untranslated: [],
    ...patch,
  };
}

const text = (plugins: readonly PluginCheckout[]) => pluginLines(plugins).join("\n");

describe("pluginLines: the precedence check", () => {
  test("every quote found and the checkout at verifiedAt: one quiet ok line", () => {
    const out = text([pack({ precedence: { missing: [] } })]);
    expect(out).toContain("precedence quotes: all found in the pack");
    expect(out).not.toContain("WARNING");
  });

  test("missing quotes: a warning with row id, file and quote, one per line", () => {
    const out = text([
      pack({
        precedence: {
          missing: [
            { id: "pr-readiness", file: OPENING, text: "Open every PR ready.", fileMissing: false },
            {
              id: "outward-writes",
              file: MODE,
              text: "proceed without asking.",
              fileMissing: true,
            },
          ],
        },
      }),
    ]);
    expect(out).toContain(
      "WARNING: 2 precedence quote(s) no longer in the pack (harness/plugins/pstack/precedence.json):",
    );
    expect(out).toContain(`pr-readiness  ${OPENING}  "Open every PR ready."`);
    expect(out).toContain(`outward-writes  ${MODE} (file gone)  "proceed without asking."`);
    expect(out).toContain("re-read those rows of rules/common/80-pstack.md");
  });

  test("the checkout moved past verifiedAt: the rows whose files changed", () => {
    const out = text([
      pack({
        precedence: {
          missing: [],
          drift: {
            kind: "moved",
            head: NEWER,
            verifiedAt: VERIFIED,
            rows: [{ id: "pr-readiness", files: [OPENING] }],
          },
        },
      }),
    ]);
    expect(out).toContain(
      "WARNING: the pack is at 111111111111; its precedence quotes were verified at 019a6a20592c",
    );
    expect(out).toContain(`1 row(s) quote files changed since: pr-readiness (${OPENING})`);
  });

  test("moved, no quoted file changed: says so, still a warning to bump verifiedAt", () => {
    const out = text([
      pack({
        precedence: {
          missing: [],
          drift: { kind: "moved", head: NEWER, verifiedAt: VERIFIED, rows: [] },
        },
      }),
    ]);
    expect(out).toContain("no quoted file changed since; bump verifiedAt");
  });

  test("moved, but the old commit is not in the checkout: which rows is unknown", () => {
    const out = text([
      pack({
        precedence: {
          missing: [],
          drift: { kind: "unknown", head: NEWER, verifiedAt: VERIFIED },
        },
      }),
    ]);
    expect(out).toContain("019a6a20592c is not in the checkout");
    expect(out).toContain(`git -C /p/pstack fetch --depth 1 origin ${VERIFIED}`);
    expect(out).toContain("then run jig apply again");
    expect(out).toContain(`set verifiedAt to ${NEWER}`);
  });

  test("a broken precedence.json is a warning, not a conflict", () => {
    const out = text([
      pack({ precedence: { invalid: "precedence.json is not JSON", missing: [] } }),
    ]);
    expect(out).toContain("WARNING: precedence check could not run (precedence.json is not JSON)");
  });

  test("no precedence.json: no precedence line at all", () => {
    expect(text([pack({})])).not.toContain("precedence");
  });
});
