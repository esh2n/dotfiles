import { describe, expect, test } from "bun:test";
import {
  currentCordisBlock,
  declaredOutsideBlock,
  planCordisPatch,
} from "../../../src/domain/dsh/cordis-patch";
import { buildDshMcpRows, renderDshMcpBlock } from "../../../src/domain/dsh/mcp";
import type { McpServer } from "../../../src/domain/mcp/types";

const SERVERS: readonly McpServer[] = [
  { name: "serena", transport: "stdio", command: "uvx", args: ["serena"], targets: { dsh: true } },
  { name: "context7", transport: "stdio", command: "npx", args: ["c7"], targets: { dsh: true } },
];
const rows = buildDshMcpRows(SERVERS, { HOME: "/home/u" });
const block = renderDshMcpBlock(rows);

/** What manager.sh installs into a profile: an id override, an insert, comments. */
const REPO_PATCH = `# User patch layer for the \`proxy\` profile.
#
# Replace-by-id: a row WITHOUT \`insert\` overrides the entry of that id.
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: local-proxy
    model: main
- insert:
    - id: jig-guard
      name: '@esh2n/jig-dsh-guard'
      config:
        timeoutMs: 10000
`;

/** What dsh scaffolds: a comment and an empty layer. */
const SCAFFOLD = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;

describe("planCordisPatch", () => {
  test("no file: the block alone", () => {
    const plan = planCordisPatch(undefined, block);
    expect(plan.text).toBe(block);
    expect(plan.changed).toBe(true);
    expect(plan.currentBlock).toBeUndefined();
    expect(plan.replacesEmptyLayer).toBe(false);
  });

  test("the repo's rows are carried through byte for byte, comments included, and the block is appended", () => {
    const plan = planCordisPatch(REPO_PATCH, block);
    expect(plan.text).toBe(`${REPO_PATCH}\n${block}`);
    expect(plan.changed).toBe(true);
    const parsed = Bun.YAML.parse(plan.text) as Record<string, unknown>[];
    expect(parsed.map((row) => Object.keys(row)[0])).toEqual(["id", "insert", "insert"]);
    expect((parsed[2] as { insert: { id: string }[] }).insert.map((e) => e.id)).toEqual([
      "mcp-serena",
      "mcp-context7",
    ]);
  });

  test("the scaffold's lone `[]` gives way to the block, its comment kept; the result is a valid sequence", () => {
    const plan = planCordisPatch(SCAFFOLD, block);
    expect(plan.replacesEmptyLayer).toBe(true);
    expect(plan.text).not.toContain("[]");
    expect(plan.text).toContain("# Your patch layer for this dsh profile");
    const parsed = Bun.YAML.parse(plan.text) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  test("a second apply over its own output is a noop with the current block equal to the generated one", () => {
    const first = planCordisPatch(REPO_PATCH, block);
    const second = planCordisPatch(first.text, block);
    expect(second.changed).toBe(false);
    expect(second.currentBlock).toBe(block);
    expect(second.text).toBe(first.text);
  });

  test("a changed source replaces the old block wholesale, so a dropped server leaves no row behind", () => {
    const first = planCordisPatch(REPO_PATCH, block);
    const fewer = renderDshMcpBlock(buildDshMcpRows(SERVERS.slice(0, 1), { HOME: "/home/u" }));
    const plan = planCordisPatch(first.text, fewer);
    expect(plan.text).toBe(`${REPO_PATCH}\n${fewer}`);
    expect(plan.text).not.toContain("context7");
    expect(plan.currentBlock).toBe(block);
  });

  test("a hand edit inside the block shows in the current block, and is not kept", () => {
    const first = planCordisPatch(REPO_PATCH, block);
    const edited = first.text.replace("command: 'uvx'", "command: 'uvx'\n        cwd: '/tmp'");
    const plan = planCordisPatch(edited, block);
    expect(plan.currentBlock).toContain("cwd: '/tmp'");
    expect(plan.currentBlock).not.toBe(block);
    expect(plan.text).not.toContain("cwd");
  });

  test("no rows: the block is removed; a file left with comments only gets `[]` back, since a comments-only file fails boot", () => {
    const withBlock = planCordisPatch(SCAFFOLD, block).text;
    const plan = planCordisPatch(withBlock, "");
    expect(plan.text).toBe(SCAFFOLD);
    expect(Bun.YAML.parse(plan.text)).toEqual([]);

    const repo = planCordisPatch(planCordisPatch(REPO_PATCH, block).text, "");
    expect(repo.text).toBe(REPO_PATCH);
    expect(planCordisPatch(undefined, "")).toMatchObject({ text: "", changed: false });
    expect(planCordisPatch(REPO_PATCH, "")).toMatchObject({ text: REPO_PATCH, changed: false });
  });

  test("a begin marker without an end is invalid and the text is returned untouched", () => {
    const broken = `${REPO_PATCH}\n# jig:begin mcp\n- insert: []\n`;
    const plan = planCordisPatch(broken, block);
    expect(plan.invalid).toContain("without");
    expect(plan.text).toBe(broken);
    expect(plan.changed).toBe(false);
  });
});

describe("currentCordisBlock", () => {
  test("the block as written, markers included, or nothing", () => {
    expect(currentCordisBlock(REPO_PATCH)).toBeUndefined();
    expect(currentCordisBlock(planCordisPatch(REPO_PATCH, block).text)).toBe(block);
  });
});

describe("declaredOutsideBlock", () => {
  test("a jig id or serverName written by hand outside the block is found with its line; quoted or bare; the block itself is not", () => {
    const text = `${REPO_PATCH}- insert:
    - id: "mcp-serena"
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: serena
- insert:
    - id: my-c7   # a different id, the same server
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: 'context7'
${block}`;
    expect(declaredOutsideBlock(text, rows)).toEqual([
      { kind: "id", value: "mcp-serena", line: 15 },
      { kind: "serverName", value: "serena", line: 18 },
      { kind: "serverName", value: "context7", line: 23 },
    ]);
  });

  test("nothing outside: the repo's rows and jig's own block", () => {
    expect(declaredOutsideBlock(planCordisPatch(REPO_PATCH, block).text, rows)).toEqual([]);
    expect(declaredOutsideBlock(REPO_PATCH, rows)).toEqual([]);
  });

  test("an id-targeted row naming a jig id counts too: that is an override of jig's entry by hand", () => {
    const text = "- id: mcp-context7\n  config:\n    serverName: context7\n";
    expect(declaredOutsideBlock(text, rows).map((d) => `${d.kind}:${d.value}`)).toEqual([
      "id:mcp-context7",
      "serverName:context7",
    ]);
  });
});
