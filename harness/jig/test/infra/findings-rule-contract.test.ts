import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findingsRuleFor } from "../../src/infra/skills/findings-rule";

// The rule lives in hand-edited Markdown: a wrapped list or a renamed agent would quietly
// shrink what the check covers, so the real files are read here.
const HARNESS = join(import.meta.dir, "..", "..", "..");
const agent = (name: string): string => join(HARNESS, "agents", `${name}.md`);

describe("change-review's findings rule and the agents it names", () => {
  const rule = findingsRuleFor(join(HARNESS, "skills"), "change-review");

  test("parses, with every reporter and the verifier an agent of this harness", () => {
    expect(rule).toBeDefined();
    for (const name of [...(rule?.reporters ?? []), rule?.verifier ?? ""]) {
      expect({ name, exists: existsSync(agent(name)) }).toEqual({ name, exists: true });
    }
  });

  test("every reporter is told to end with the Findings line", () => {
    for (const name of rule?.reporters ?? []) {
      expect({ name, told: readFileSync(agent(name), "utf8").includes("`Findings: <n>`") }).toEqual(
        { name, told: true },
      );
    }
  });
});
