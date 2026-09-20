/**
 * Port of yoki's runtime/yoki/scripts/lib/permissions/test/parse.test.js —
 * tests tagged [yoki-verified] assert the same behavior as that suite.
 */

import { describe, expect, test } from "bun:test";
import { parseYamlPermissions } from "../../../src/domain/permissions/parse";

describe("parseYamlPermissions", () => {
  test("[yoki-verified] allow/deny entries with reason and enforce", () => {
    const text = `
allow:
  - pattern: "Bash(git status *)"
  - pattern: "Read(**)"
    reason: "reads are safe"
deny:
  - pattern: "Bash(rm -rf /*)"
    reason: "wildcard rm"
    enforce: [hook]
defaultMode: auto
`;
    const result = parseYamlPermissions(text);
    expect(result.allow).toEqual([
      { pattern: "Bash(git status *)" },
      { pattern: "Read(**)", reason: "reads are safe" },
    ]);
    expect(result.deny).toEqual([
      { pattern: "Bash(rm -rf /*)", reason: "wildcard rm", enforce: ["hook"] },
    ]);
    expect(result.defaultMode).toBe("auto");
  });

  test("[yoki-verified] comments and blank lines are ignored", () => {
    const text = `
# a leading comment
allow:
  # another comment
  - pattern: "Bash(ls *)"

deny: []
defaultMode: auto
`;
    const result = parseYamlPermissions(text);
    expect(result.allow).toEqual([{ pattern: "Bash(ls *)" }]);
    expect(result.deny).toEqual([]);
  });

  test("[yoki-verified] inline empty list closes the block", () => {
    const text = `
allow: []
deny:
  - pattern: "Bash(rm -rf /)"
defaultMode: auto
`;
    const result = parseYamlPermissions(text);
    expect(result.allow).toEqual([]);
    expect(result.deny).toEqual([{ pattern: "Bash(rm -rf /)" }]);
  });

  test("[yoki-verified] single and double quoted patterns both unquote", () => {
    const text = `
allow:
  - pattern: 'Bash(pwd)'
  - pattern: "Bash(whoami)"
deny: []
defaultMode: auto
`;
    const result = parseYamlPermissions(text);
    expect(result.allow).toEqual([{ pattern: "Bash(pwd)" }, { pattern: "Bash(whoami)" }]);
  });

  test("[yoki-verified] unrecognized line throws", () => {
    expect(() => parseYamlPermissions("nonsense: {\n")).toThrow(
      /unsupported top-level key|unrecognized line/,
    );
  });

  test("[yoki-verified] pattern outside a block throws", () => {
    expect(() => parseYamlPermissions('  - pattern: "Bash(ls)"\n')).toThrow(
      /outside an allow\/deny block/,
    );
  });

  test("empty text yields an empty layer (loadLayer's missing-file case, ported as parsing '')", () => {
    expect(parseYamlPermissions("")).toEqual({
      allow: [],
      deny: [],
      guardFloor: [],
      defaultMode: undefined,
    });
  });

  test("[yoki-verified] guardFloor entries carry hook, event and matcher", () => {
    const text = `
allow: []
deny: []
guardFloor:
  - hook: git-guard.sh
    event: PreToolUse
    matcher: Bash
  - hook: unattended-guard.sh
    event: PreToolUse
    matcher: "Bash|Write|Edit"
defaultMode: auto
`;
    const result = parseYamlPermissions(text);
    expect(result.guardFloor).toEqual([
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Bash" },
      { hook: "unattended-guard.sh", event: "PreToolUse", matcher: "Bash|Write|Edit" },
    ]);
  });

  test("[yoki-verified] a file with no guardFloor block yields an empty floor", () => {
    const result = parseYamlPermissions(
      'allow:\n  - pattern: "Bash(ls *)"\ndeny: []\ndefaultMode: auto\n',
    );
    expect(result.guardFloor).toEqual([]);
  });

  test("[yoki-verified] guardFloor: [] is the explicit empty form", () => {
    const result = parseYamlPermissions("allow: []\ndeny: []\nguardFloor: []\ndefaultMode: auto\n");
    expect(result.guardFloor).toEqual([]);
  });

  test('[yoki-verified] "- hook:" outside a guardFloor block throws', () => {
    expect(() => parseYamlPermissions("allow:\n  - hook: git-guard.sh\n")).toThrow(
      /outside a guardFloor block/,
    );
  });

  test('[yoki-verified] "- pattern:" inside guardFloor throws', () => {
    expect(() => parseYamlPermissions('guardFloor:\n  - pattern: "Bash(ls)"\n')).toThrow(
      /outside an allow\/deny block/,
    );
  });

  test("a defaultMode value is unquoted like a pattern", () => {
    const result = parseYamlPermissions('allow: []\ndeny: []\ndefaultMode: "plan"\n');
    expect(result.defaultMode).toBe("plan");
  });

  test("an unsupported top-level key throws with its line number", () => {
    expect(() => parseYamlPermissions("allow: []\nbogus: 1\n")).toThrow(
      /permissions\.yaml:2: unsupported top-level key "bogus"/,
    );
  });
});
