import { describe, expect, test } from "bun:test";
import type { ApplyPorts, ProvenanceInfo } from "../../src/app/apply/ports";
import { applyCli } from "../../src/cli/apply";
import { fakeClaudeFs } from "../app/apply/fake-claude-ports";

const TIERS_JSON_PATH = "/repo/policy/tiers.json";
const PI_PATH = "/repo/config/pi/models.json";
const DSH_PATH = "/repo/config/dsh/settings.yaml";
const LITELLM_PATH = "/repo/config/litellm/config.yaml";

const MINIMAL_TIERS = {
  version: 1,
  connections: {
    proxy: {
      baseUrl: "http://localhost:4000/v1",
      api: "openai-completions",
      compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
      pi: { apiKey: "sk-local-proxy" },
      dsh: { displayName: "LiteLLM (local)", apiKeyEnv: "LITELLM_API_KEY" },
    },
  },
  tiers: {
    main: {
      alias: "main",
      displayName: "DeepSeek Flash",
      backend: { provider: "deepseek", model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY" },
      reasoning: true,
      input: ["text"],
      contextWindow: 1000000,
      maxTokens: 16384,
      compat: { thinkingFormat: "deepseek" },
      pi: { name: "main" },
      dsh: { name: "main" },
    },
    complex: {
      alias: "complex",
      displayName: "DeepSeek V4 Pro",
      backend: { provider: "deepseek", model: "deepseek-v4-pro", apiKeyEnv: "DEEPSEEK_API_KEY" },
      reasoning: true,
      input: ["text"],
      contextWindow: 1000000,
      maxTokens: 32768,
      compat: { thinkingFormat: "deepseek" },
      pi: { name: "complex" },
      dsh: { name: "complex" },
    },
    deterministic: {
      alias: "deterministic",
      displayName: "local Qwen",
      backend: { provider: "lm_studio", model: "qwen/qwen3.8-27b" },
      reasoning: true,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 32768,
      compat: { thinkingFormat: "qwen-chat-template", supportsReasoningEffort: false },
      pi: { name: "deterministic" },
      dsh: { name: "deterministic" },
    },
  },
};

function fakePorts(initialFiles: Record<string, string>): {
  ports: ApplyPorts;
  files: Record<string, string>;
} {
  const files: Record<string, string> = { ...initialFiles };
  const manifest: Record<string, string> = {};
  const provenance: Record<string, ProvenanceInfo> = {};

  const ports: ApplyPorts = {
    async readFile(path) {
      return files[path];
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    sha256(content) {
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return { ...manifest };
    },
    async writeManifest(next) {
      for (const key of Object.keys(manifest)) {
        if (!(key in next)) delete manifest[key];
      }
      Object.assign(manifest, next);
    },
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    jigVersion: "0.0.0-test",
  };

  return { ports, files };
}

const paths = {
  tiersJsonPath: TIERS_JSON_PATH,
  destPaths: { pi: PI_PATH, dsh: DSH_PATH, litellm: LITELLM_PATH },
};

describe("applyCli", () => {
  test("defaults to all targets, dry-run, exit 0", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli([], ports, paths);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).toContain("== dsh ==");
    expect(result.stdout).toContain("== litellm ==");
  });

  test("--target pi restricts to one target", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "pi"], ports, paths);

    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).not.toContain("== dsh ==");
  });

  test("--target=pi (equals form) works too", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target=pi"], ports, paths);
    expect(result.stdout).toContain("== pi ==");
  });

  test("rejects an unknown --target", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "bogus"], ports, paths);
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/unknown --target/);
  });

  test("--target all never reaches claude: that target writes into $HOME and must be named", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli([], ports, paths);
    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).not.toContain("== claude ==");
  });

  test("--target claude with no claude context is refused rather than silently doing nothing", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("not wired");
  });
});

/**
 * The claude dry-run's report, which is what a reader agrees to before
 * `--write`. Exercised through the CLI because the wording — what is owned,
 * what leaves, where the sandbox list came from — IS the contract; a correct
 * composition reported badly is still a surprise.
 */
describe("applyCli --target claude", () => {
  const H = "/repo/llm/harness";
  const CLAUDE = "/home/u/.claude";
  const CLAUDE_PATHS = {
    harnessRoot: H,
    guardRules: `${H}/policy/guard-rules.json`,
    mcpServers: `${H}/mcp/servers.json`,
    sandbox: `${H}/policy/sandbox.json`,
    decisions: `${H}/rules/decisions`,
    settings: `${CLAUDE}/settings.json`,
    agentsMd: `${CLAUDE}/AGENTS.md`,
    claudeMd: `${CLAUDE}/CLAUDE.md`,
    skills: `${CLAUDE}/skills`,
    agents: `${CLAUDE}/agents`,
    rulesDir: `${CLAUDE}/rules`,
    commands: `${CLAUDE}/commands`,
    home: "/home/u",
  };

  const SOURCES: Record<string, string> = {
    [CLAUDE_PATHS.guardRules]: JSON.stringify({ version: 1, floor: [], rules: [] }),
    [CLAUDE_PATHS.mcpServers]: JSON.stringify({ schemaVersion: "jig.mcp.v1", servers: [] }),
    [`${CLAUDE_PATHS.decisions}/a.md`]: "# 題\n\nStatus: accepted — x\n\nrule: Do the thing.\n",
    [`${H}/rules/common/README.md`]: "# rules/common\n",
  };

  function claudeContext(extra: Record<string, string> = {}, links: Record<string, string> = {}) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return {
      ports: fake.ports,
      paths: CLAUDE_PATHS,
      hookPaths: { bun: "/abs/bun", jig: "/abs/jig.ts" },
    };
  }

  /** What `~/.claude` looks like before the first milestone-2 write. */
  const YOKI_SWITCH_LINKS = {
    [CLAUDE_PATHS.skills]: `${CLAUDE}/.skills-merged`,
    [CLAUDE_PATHS.agents]: `${CLAUDE}/.agents-merged`,
    [CLAUDE_PATHS.rulesDir]: `${CLAUDE}/.rules-merged`,
    [CLAUDE_PATHS.commands]: `${CLAUDE}/.commands-merged`,
  };

  test("reports the five hooks, the owned keys, and the paste-ready permit fragment", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hooks (5):");
    expect(result.stdout).toContain("hooks stop-gate --harness claude");
    expect(result.stdout).toContain("keys jig now owns (5):");
    expect(result.stdout).not.toContain("  mcpServers\n");
    // The policy file is not agent-writable, so the dry-run hands over the text.
    expect(result.stdout).toContain("not agent-writable by design");
    expect(result.stdout).toContain('"id": "permit-git-commit"');
  });

  test("MCP servers are a paste-able claude mcp add block, with the by-hand remove and the --write caveat", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [CLAUDE_PATHS.mcpServers]: JSON.stringify({
        schemaVersion: "jig.mcp.v1",
        servers: [
          {
            name: "serena",
            transport: "stdio",
            command: "uvx",
            args: ["serena", "--context", "claude-code"],
            targets: { claude: true },
          },
          {
            name: "figma-remote",
            transport: "http",
            url: "https://mcp.figma.com/mcp",
            headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
            targets: { claude: true },
          },
          { name: "playwright", transport: "stdio", command: "npx", targets: { claude: false } },
        ],
      }),
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("mcp servers (claude mcp, user scope) (2):");
    expect(result.stdout).toContain(
      "\n  claude mcp add --transport stdio --scope user serena -- uvx serena --context claude-code\n",
    );
    expect(result.stdout).toContain(
      "\n  claude mcp add --transport http --scope user figma-remote https://mcp.figma.com/mcp -H 'Authorization: Bearer ${FIGMA_TOKEN}'\n",
    );
    expect(result.stdout).not.toContain("playwright");
    expect(result.stdout).toContain("`claude mcp remove --scope user <name>`");
    expect(result.stdout).toContain("jig does not read ~/.claude.json, so it cannot");
    expect(result.stdout).toContain("--write does not run these lines");
    expect(result.stdout).toContain("re-run them after editing mcp/servers.json");
  });

  test("a leftover mcpServers key is listed under REMOVE with its reason", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [CLAUDE_PATHS.settings]: JSON.stringify({
        mcpServers: { serena: { type: "stdio" }, "figma-desktop": { type: "http" } },
      }),
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain(
      "  mcpServers (2) — settings.json is not an MCP source (docs: mcp.md); delivered through `claude mcp add` instead:\n    - serena\n    - figma-desktop\n",
    );
  });

  test("names permissions.deny a backstop and the PreToolUse hook the enforcement", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());
    expect(result.stdout).toContain("permissions.deny is a backstop only");
  });

  test("excludedCommands and its provenance are reported when policy/sandbox.json exists", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [CLAUDE_PATHS.sandbox]: JSON.stringify({ excludedCommands: ["gh", "docker", "open"] }),
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain(
      "excludedCommands copied from /repo/llm/harness/policy/sandbox.json: gh, docker, open",
    );
    expect(result.stdout).toContain("still goes through jig's guard");
  });

  test("without that file the report says the empty list was a default, not a choice", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());
    expect(result.stdout).toContain("NO policy/sandbox.json");
  });

  test("an accepted note with no rule line is a WARNING, not a silent omission", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${CLAUDE_PATHS.decisions}/b.md`]: "# 題\n\nStatus: accepted — x\n",
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("WARNING: 1 accepted decision note(s) carry no `rule:` line");
    expect(result.stdout).toContain("- b.md");
  });

  test("AGENTS.md: its outcome, byte size and sources, and the generated text itself", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({ [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n" });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toMatch(
      /AGENTS\.md: write {2}\/home\/u\/\.claude\/AGENTS\.md {2}\(\d+ bytes\)/,
    );
    expect(result.stdout).toContain("rules/common rendered in (1): core.md");
    expect(result.stdout).toContain("--- AGENTS.md (generated) ---");
    expect(result.stdout).toContain("Be brief.");
    expect(result.stdout).not.toContain("PREVIEW ONLY");
  });

  test("past 32 KiB the size line carries a WARNING naming Codex, and the exit code stays 0", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${H}/rules/common/big.md`]: `# Big\n\n${"x".repeat(33 * 1024)}\n`,
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("WARNING: over 32768 bytes; Codex truncates AGENTS.md there");
  });

  test("one line per link destination, with the state and — for replace — the old target", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext(
      { [CLAUDE_PATHS.claudeMd]: "# merged by yoki-switch\n" },
      YOKI_SWITCH_LINKS,
    );
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("links (1):");
    expect(result.stdout).toMatch(
      /CLAUDE\.md +backup-then-create \(existing file\/directory → \/home\/u\/\.claude\/CLAUDE\.md\.pre-jig\.20260923-000000\) +→ AGENTS\.md/,
    );
    expect(result.stdout).toContain(
      "skills directory: replace (currently → /home/u/.claude/.skills-merged)  /home/u/.claude/skills",
    );
    expect(result.stdout).toContain(
      "agents directory: replace (currently → /home/u/.claude/.agents-merged)  /home/u/.claude/agents",
    );
    expect(result.stdout).toContain(
      "rules directory: replace (currently → /home/u/.claude/.rules-merged)  /home/u/.claude/rules",
    );
    expect(result.stdout).toContain(
      "commands: remove  /home/u/.claude/commands  (a symlink → /home/u/.claude/.commands-merged)",
    );
  });

  test("the rules directory lists each planned link, and says why common is not one of them", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${H}/rules/go/errors.md`]: "---\npaths:\n  - '**/*.go'\n---\n# Go\n",
      [`${CLAUDE_PATHS.rulesDir}/mine.md`]: "my rule",
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("1 conditional-rule directory to link");
    expect(result.stdout).toMatch(/go +create +→ \/repo\/llm\/harness\/rules\/go/);
    expect(result.stdout).toMatch(/mine\.md +left alone \(not jig's: a regular file\)/);
    expect(result.stdout).toMatch(
      /common +always-on rules, rendered into AGENTS\.md — never linked/,
    );
  });

  test("the skills directory lists each skill link with a count, and names Claude Code's synced tree as not jig's", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${H}/skills/README.md`]: "# skills\n",
      [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
      [`${H}/skills/eli5/SKILL.md`]: "---\nname: eli5\n---\n",
      [`${CLAUDE_PATHS.skills}/synced/bucket-1/x/SKILL.md`]: "synced",
      [`${CLAUDE_PATHS.skills}/.bucket-bucket-1`]: "",
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("skills directory: ok  /home/u/.claude/skills");
    expect(result.stdout).toContain("2 skill directories to link (each holds a SKILL.md):");
    expect(result.stdout).toMatch(/eli5 +create +→ \/repo\/llm\/harness\/skills\/eli5/);
    expect(result.stdout).toMatch(/writeup +create +→ \/repo\/llm\/harness\/skills\/writeup/);
    expect(result.stdout).toMatch(/synced +left alone \(not jig's: a directory\)/);
    expect(result.stdout).toMatch(/\.bucket-bucket-1 +left alone \(not jig's: a regular file\)/);
    expect(result.stdout).toContain("Claude Code writes its own entries here");
    expect(result.stdout).toMatch(/README\.md +a file, not a skill directory/);
  });

  test("the agents directory lists each *.md link with a count", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${H}/agents/research.md`]: "# research\n",
      [`${H}/agents/notes.txt`]: "x",
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("agents directory: create  /home/u/.claude/agents");
    expect(result.stdout).toContain("1 agent definition to link (*.md files):");
    expect(result.stdout).toMatch(
      /research\.md +create +→ \/repo\/llm\/harness\/agents\/research\.md/,
    );
    expect(result.stdout).toMatch(/notes\.txt +not a \*\.md file/);
  });

  test("a commands directory holding real files is a CONFLICT line and exit 1", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({ [`${CLAUDE_PATHS.commands}/mine.md`]: "my command" });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("outcome: conflict");
    expect(result.stdout).toContain("commands: CONFLICT");
    expect(result.stdout).toContain("(mine.md)");
  });

  test("--target codex with no codex context is refused rather than silently doing nothing", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "codex"], ports, paths, claudeContext());
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("--target codex is not wired");
  });

  test("dry-run writes nothing even with a real destination path", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    await applyCli(["--target", "pi"], ports, paths);
    expect(files[PI_PATH]).toBeUndefined();
  });

  test("--write actually writes pi", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "pi", "--write"], ports, paths);
    expect(result.code).toBe(0);
    expect(files[PI_PATH]).toContain('"id": "main"');
  });

  test("litellm --write is refused but exits 0 (documented, correct behavior)", async () => {
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [LITELLM_PATH]: "model_list:\n",
    });
    const result = await applyCli(["--target", "litellm", "--write"], ports, paths);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/deferred/);
    expect(files[LITELLM_PATH]).toBe("model_list:\n");
  });

  test("pi --write with a hand-edit conflict exits nonzero", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    await applyCli(["--target", "pi", "--write"], ports, paths);
    files[PI_PATH] = "hand edited";

    const result = await applyCli(["--target", "pi", "--write"], ports, paths);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/conflict/);
  });

  test("dsh --write with markers missing exits nonzero (the write was requested but couldn't happen)", async () => {
    const { ports } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [DSH_PATH]: "llm-pi-ai:\n  providers:\n    local-proxy:\n      displayName: x\n",
    });
    const result = await applyCli(["--target", "dsh", "--write"], ports, paths);
    expect(result.code).toBe(1);
  });
});

/**
 * The codex dry-run's report, exercised through the CLI for the same reason
 * the claude one is: the sections — two skill directories, the generated
 * files, the block and its conflicts, the leftovers — are what a reader
 * agrees to before `--write`.
 */
describe("applyCli --target codex", () => {
  const H = "/repo/llm/harness";
  const OLD = "/repo/config/claude-profiles";
  const CODEX = "/home/u/.codex";
  const CODEX_PATHS = {
    harnessRoot: H,
    mcpServers: `${H}/mcp/servers.json`,
    decisions: `${H}/rules/decisions`,
    formerSkillRoots: [OLD],
    agentsSkills: "/home/u/.agents/skills",
    codexSkills: `${CODEX}/skills`,
    agentsMd: `${CODEX}/AGENTS.md`,
    agentsDir: `${CODEX}/agents`,
    configToml: `${CODEX}/config.toml`,
    hooksJson: `${CODEX}/hooks.json`,
    home: "/home/u",
  };

  const SOURCES: Record<string, string> = {
    [CODEX_PATHS.mcpServers]: JSON.stringify({
      schemaVersion: "jig.mcp.v1",
      servers: [
        {
          name: "serena",
          transport: "stdio",
          command: "uvx",
          args: ["serena"],
          targets: { codex: true },
        },
        {
          name: "notion-mcp",
          transport: "http",
          url: "https://mcp.notion.com/mcp",
          targets: { codex: true },
        },
      ],
    }),
    [`${CODEX_PATHS.decisions}/a.md`]: "# 題\n\nStatus: accepted — x\n\nrule: Do the thing.\n",
    [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
    [`${H}/skills/README.md`]: "# skills\n",
    [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
    [`${H}/skills/grilling/SKILL.md`]: "---\nname: grilling\n---\n",
    [`${H}/skills/grilling/codex/SKILL.md`]: "---\nname: grilling\n---\n",
    [`${H}/agents/research.md`]:
      '---\nname: research\ndescription: Survey.\ntools: ["Read"]\nmodel: sonnet\n---\nSurvey.\n',
  };

  function codexContext(extra: Record<string, string> = {}, links: Record<string, string> = {}) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return {
      ports: fake.ports,
      paths: CODEX_PATHS,
      options: {
        codexModels: {},
        validateToml: (text: string) => {
          Bun.TOML.parse(text);
        },
      },
    };
  }

  const tiers = () => fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) }).ports;

  test("both skill directories, with counts, the port's target, and why the rest are not ported", async () => {
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, codexContext());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("== codex ==");
    expect(result.stdout).toContain("dest: /home/u/.codex");
    expect(result.stdout).toContain(
      "skills (cross-harness) directory: create  /home/u/.agents/skills",
    );
    expect(result.stdout).toContain(
      "2 skill directories to link (each holds a SKILL.md; Codex, pi and omp read this directory):",
    );
    expect(result.stdout).toContain("codex skills directory: create  /home/u/.codex/skills");
    expect(result.stdout).toContain("1 Codex port to link");
    expect(result.stdout).toMatch(
      /grilling +create +→ \/repo\/llm\/harness\/skills\/grilling\/codex/,
    );
    // The skills without a port are the expected case: counted, not listed one by one.
    expect(result.stdout).toContain("not linked (2):");
    expect(result.stdout).toMatch(/README\.md +a file, not a skill directory/);
    expect(result.stdout).toContain(
      "    (1 entry) no codex/SKILL.md — reaches Codex through ~/.agents/skills",
    );
    expect(result.stdout).not.toMatch(/writeup +no codex/);
    expect(result.stdout).toContain("listed twice in Codex");
  });

  test("on the machine yoki-switch left: stale links named with why, cmd-* under a yoki heading, .system not jig's", async () => {
    const context = codexContext(
      {
        [`${CODEX_PATHS.codexSkills}/cmd-aside/SKILL.md`]: "x",
        [`${CODEX_PATHS.codexSkills}/.system/imagegen/SKILL.md`]: "x",
      },
      {
        [`${CODEX_PATHS.agentsSkills}/writeup`]: `${OLD}/core/skills/writeup`,
        [`${CODEX_PATHS.agentsSkills}/gone`]: `${OLD}/packs/go/skills/gone`,
        [`${CODEX_PATHS.agentsSkills}/nowhere`]: "/nowhere/at/all",
      },
    );
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, context);

    expect(result.stdout).toMatch(
      /writeup +replace \(currently → \/repo\/config\/claude-profiles\/core\/skills\/writeup\)/,
    );
    expect(result.stdout).toMatch(
      /gone +remove \(link into the retired tree → \/repo\/config\/claude-profiles\/packs\/go\/skills\/gone\)/,
    );
    expect(result.stdout).toMatch(/nowhere +remove \(dangling link → \/nowhere\/at\/all\)/);
    expect(result.stdout).toContain(
      "yoki leftovers (1) — real directories from yoki's command→skill conversion",
    );
    expect(result.stdout).toMatch(/\n {4}cmd-aside\n/);
    expect(result.stdout).toMatch(/\.system +left alone \(not jig's: a directory\)/);
    expect(result.stdout).toContain("Codex keeps its bundled skills in `.system/`");
  });

  test("AGENTS.md is named as the Claude target's content, the agent files list the model gap per tier, hooks.json is only named", async () => {
    const context = codexContext({
      [`${CODEX_PATHS.agentsDir}/mine.toml`]: 'name = "mine"\n',
    });
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, context);

    expect(result.stdout).toMatch(
      /AGENTS\.md: write {2}\/home\/u\/\.codex\/AGENTS\.md {2}\(\d+ bytes\)/,
    );
    expect(result.stdout).toContain("the same generated content as ~/.claude/AGENTS.md");
    expect(result.stdout).toContain("rules/common rendered in (1): core.md");
    expect(result.stdout).toContain("agents (generated files): /home/u/.codex/agents");
    expect(result.stdout).toContain("1 agent definition → <name>.toml");
    expect(result.stdout).toMatch(
      /research\.toml +write +model: \(none: no Codex id for "sonnet"\)/,
    );
    expect(result.stdout).toContain("model tiers with no Codex id (sonnet: 1)");
    expect(result.stdout).toMatch(/not jig's \(1\), left alone:\n +mine\.toml +a regular file/);
    expect(result.stdout).toContain(
      "hooks.json: not touched  /home/u/.codex/hooks.json  (jig codex register's",
    );
  });

  test("config.toml: the servers in jig's block, a CONFLICT line per table declared outside it, yoki's leftovers, exit 1", async () => {
    const context = codexContext({
      [CODEX_PATHS.configToml]:
        '# yoki:begin\n[permissions.yoki]\nextends = ":workspace"\n\n[mcp_servers.notion-mcp]\nurl = "u"\n# yoki:end\n\n[projects."/r"]\ntrust_level = "trusted"\n',
    });
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, context);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("outcome: conflict");
    expect(result.stdout).toContain("config.toml: write  /home/u/.codex/config.toml");
    expect(result.stdout).toContain("mcp servers in jig's block (2): serena, notion-mcp");
    expect(result.stdout).toContain("CONFLICT: 1 of them already declared outside jig's block");
    expect(result.stdout).toContain("[mcp_servers.notion-mcp]  line 5");
    expect(result.stdout).toContain("yoki leftovers (2), left alone until milestone 4:");
    expect(result.stdout).toContain("    [permissions.yoki]");
    expect(result.stdout).toContain("--- diff (current vs generated) ---");
    expect(result.stdout).toContain("+# jig:begin mcp");
  });

  test("--target all never reaches codex either", async () => {
    const result = await applyCli([], tiers(), paths, undefined, codexContext());
    expect(result.stdout).not.toContain("== codex ==");
  });
});
