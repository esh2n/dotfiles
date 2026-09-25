import { describe, expect, test } from "bun:test";
import type { ApplyPorts, ProvenanceInfo } from "../../src/app/apply/ports";
import { applyCli } from "../../src/cli/apply";
import { fakeClaudeFs } from "../app/apply/fake-claude-ports";

const TIERS_JSON_PATH = "/repo/policy/tiers.json";
const PI_PATH = "/repo/config/pi/models.json";
const DSH_PATH = "/repo/config/dsh/settings.yaml";
const OMP_PATH = "/repo/config/omp/models.yml";
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
  destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
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
    claudeJson: "/home/u/.claude.json",
    agentsMd: `${CLAUDE}/AGENTS.md`,
    claudeMd: `${CLAUDE}/CLAUDE.md`,
    skills: `${CLAUDE}/skills`,
    agents: `${CLAUDE}/agents`,
    rulesDir: `${CLAUDE}/rules`,
    commands: `${CLAUDE}/commands`,
    scripts: `${CLAUDE}/scripts`,
    workflows: `${CLAUDE}/workflows`,
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

  test("MCP servers are listed as the change to ~/.claude.json's mcpServers", async () => {
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

    expect(result.stdout).toContain("mcp servers (/home/u/.claude.json, mcpServers only): write");
    expect(result.stdout).toContain("\n  add: serena, figma-remote\n");
    expect(result.stdout).not.toContain("playwright");
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
      "  mcpServers (2) — settings.json is not an MCP source (docs: mcp.md); delivered into ~/.claude.json's mcpServers instead:\n    - serena\n    - figma-desktop\n",
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

  test("scripts and workflows: one report line each while their sources do not exist yet", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({}, { [CLAUDE_PATHS.scripts]: `${CLAUDE}/.scripts-merged` });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain(
      "scripts directory: not planned  (no /repo/llm/harness/scripts yet)\n  the destination is a symlink → /home/u/.claude/.scripts-merged and is left as found",
    );
    expect(result.stdout).toContain(
      "workflows directory: not planned  (no /repo/llm/harness/workflows yet)\n  the destination is absent and is left as found",
    );
    expect(result.stdout).toContain("milestone 4 prerequisite");
  });

  test("scripts and workflows: the managed-directory section once the sources exist", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext(
      {
        [`${H}/scripts/statusline.sh`]: "#!/bin/sh\n",
        [`${H}/workflows/review.js`]: "// review\n",
        [`${H}/workflows/lib/lanes.js`]: "// lanes\n",
        [`${H}/workflows/notes.md`]: "notes\n",
      },
      {
        [CLAUDE_PATHS.scripts]: `${CLAUDE}/.scripts-merged`,
        [CLAUDE_PATHS.workflows]: `${CLAUDE}/.workflows-merged`,
      },
    );
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain(
      "scripts directory: replace (currently → /home/u/.claude/.scripts-merged)  /home/u/.claude/scripts",
    );
    expect(result.stdout).toContain(
      "1 script to link (regular files; settings.json's statusLine.command",
    );
    expect(result.stdout).toMatch(
      /statusline\.sh +create +→ \/repo\/llm\/harness\/scripts\/statusline\.sh/,
    );
    expect(result.stdout).toContain(
      "workflows directory: replace (currently → /home/u/.claude/.workflows-merged)  /home/u/.claude/workflows",
    );
    expect(result.stdout).toContain(
      "2 workflow entries to link (*.js scripts for Claude Code's Workflow tool, plus lib/ when present)",
    );
    expect(result.stdout).toMatch(/lib +create +→ \/repo\/llm\/harness\/workflows\/lib/);
    expect(result.stdout).toMatch(
      /review\.js +create +→ \/repo\/llm\/harness\/workflows\/review\.js/,
    );
    expect(result.stdout).toMatch(/notes\.md +not a \*\.js workflow script/);
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
 * the claude one is: the sections — the skills mount, what `~/.codex/skills`
 * holds, the generated files with the model per tier, the block and its
 * conflicts, the leftovers — are what a reader agrees to before `--write`.
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
    [`${H}/agents/research.md`]:
      '---\nname: research\ndescription: Survey.\ntools: ["Read"]\nmodel: sonnet\n---\nSurvey.\n',
  };

  const RULED_MODELS = {
    sonnet: { model: "gpt-6-luna", reasoningEffort: "high" },
    haiku: { model: "gpt-6-luna", reasoningEffort: "medium" },
    opus: { model: "gpt-6-sol", reasoningEffort: "medium" },
  };

  function codexContext(
    extra: Record<string, string> = {},
    links: Record<string, string> = {},
    codexModels: Record<string, { model: string; reasoningEffort?: string }> = {},
  ) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return {
      ports: fake.ports,
      paths: CODEX_PATHS,
      options: {
        codexModels,
        modelsSource: `${H}/agents/models.json`,
        validateToml: (text: string) => {
          Bun.TOML.parse(text);
        },
      },
    };
  }

  const tiers = () => fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) }).ports;

  test("the skills mount with counts; ~/.codex/skills named as not managed, empty when absent", async () => {
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
    expect(result.stdout).toContain("codex skills: not managed by jig  /home/u/.codex/skills");
    expect(result.stdout).toContain("the codex/SKILL.md ports");
    expect(result.stdout).toContain("yoki leftovers (milestone 4) — not managed by jig: (missing)");
    expect(result.stdout).not.toContain("Codex port");
    expect(result.stdout).not.toContain("listed twice in Codex");
  });

  test("on the machine yoki-switch left: stale links named with why; every entry of ~/.codex/skills under the yoki heading with whose it is", async () => {
    const context = codexContext(
      {
        [`${CODEX_PATHS.codexSkills}/cmd-aside/SKILL.md`]: "x",
        [`${CODEX_PATHS.codexSkills}/.system/imagegen/SKILL.md`]: "x",
      },
      {
        [`${CODEX_PATHS.agentsSkills}/writeup`]: `${OLD}/core/skills/writeup`,
        [`${CODEX_PATHS.agentsSkills}/gone`]: `${OLD}/packs/go/skills/gone`,
        [`${CODEX_PATHS.agentsSkills}/nowhere`]: "/nowhere/at/all",
        [`${CODEX_PATHS.codexSkills}/grilling`]: `${OLD}/core/skills/grilling/codex`,
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
      "yoki leftovers (milestone 4) — not managed by jig (3), clean by hand:",
    );
    expect(result.stdout).toMatch(/\n {4}\.system +a directory {2}— Codex's bundled skills/);
    expect(result.stdout).toMatch(
      /\n {4}cmd-aside +a directory {2}— yoki's command→skill conversion/,
    );
    expect(result.stdout).toMatch(
      /\n {4}grilling +a symlink → \/repo\/config\/claude-profiles\/core\/skills\/grilling\/codex {2}— yoki's link to a codex\/SKILL\.md port/,
    );
    // Nothing under it is planned: no create, replace or remove line names the directory.
    expect(result.stdout).not.toMatch(/\/home\/u\/\.codex\/skills\/\S+ +(create|replace|remove)/);
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
    expect(result.stdout).toContain(
      "model tiers with no Codex id in /repo/llm/harness/agents/models.json (sonnet: 1)",
    );
    expect(result.stdout).not.toContain("model tiers mapped by");
    expect(result.stdout).toMatch(/not jig's \(1\), left alone:\n +mine\.toml +a regular file/);
    expect(result.stdout).toContain(
      "hooks.json: not touched  /home/u/.codex/hooks.json  (jig codex register's",
    );
  });

  test("with the ruled table: model and effort per file, the tier summary, no gap line", async () => {
    const context = codexContext(
      {
        [`${H}/agents/scout.md`]: "---\nname: scout\nmodel: haiku\n---\nLook.\n",
        [`${H}/agents/architect.md`]:
          "---\nname: architect\nmodel: opus\nmodels: { codex: { model: gpt-6-sol, reasoningEffort: xhigh } }\n---\nPlan.\n",
        [`${H}/agents/plain.md`]: "---\nname: plain\n---\nNo tier.\n",
      },
      {},
      RULED_MODELS,
    );
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, context);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /research\.toml +write +model: gpt-6-luna effort=high \(sonnet\)/,
    );
    expect(result.stdout).toMatch(/scout\.toml +write +model: gpt-6-luna effort=medium \(haiku\)/);
    expect(result.stdout).toMatch(
      /architect\.toml +write +model: gpt-6-sol effort=xhigh \(models: override, tier opus\)/,
    );
    expect(result.stdout).toMatch(/plain\.toml +write +model: \(none: inherits\)/);
    expect(result.stdout).toContain(
      "model tiers mapped by /repo/llm/harness/agents/models.json (sonnet → gpt-6-luna high: 1, haiku → gpt-6-luna medium: 1);",
    );
    expect(result.stdout).not.toContain("model tiers with no Codex id");
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

  test("the shared skills mount says which target planned it", async () => {
    const result = await applyCli(["--target", "codex"], tiers(), paths, undefined, codexContext());
    expect(result.stdout).toContain(
      "Delivered by --target codex, --target omp and --target pi alike, from one plan (this run: --target codex)",
    );
  });
});

/**
 * The omp dry-run's report, through the CLI for the same reason: the
 * sections — the shared mount, the generated files with both gaps, mcp.json
 * with what is carried through, the extension link, the leftovers, and what
 * reaches omp natively — are what a reader agrees to before `--write`.
 */
describe("applyCli --target omp", () => {
  const H = "/repo/llm/harness";
  const OLD = "/repo/config/claude-profiles";
  const OMP = "/home/u/.omp/agent";
  const OMP_PATHS = {
    harnessRoot: H,
    mcpServers: `${H}/mcp/servers.json`,
    formerSkillRoots: [OLD],
    agentsSkills: "/home/u/.agents/skills",
    agentDir: OMP,
    agentsDir: `${OMP}/agents`,
    mcpJson: `${OMP}/mcp.json`,
    extensionsDir: `${OMP}/extensions`,
    extensionTarget: `${H}/jig/adapters/omp/src/index.ts`,
    home: "/home/u",
  };

  const SOURCES: Record<string, string> = {
    [OMP_PATHS.mcpServers]: JSON.stringify({
      schemaVersion: "jig.mcp.v1",
      servers: [
        {
          name: "serena",
          transport: "stdio",
          command: "uvx",
          args: ["serena"],
          targets: { omp: true },
        },
        {
          name: "notion-mcp",
          transport: "http",
          url: "https://mcp.notion.com/mcp",
          targets: { omp: true },
        },
      ],
    }),
    [`${H}/skills/README.md`]: "# skills\n",
    [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
    [`${H}/agents/research.md`]:
      '---\nname: research\ndescription: Survey.\ntools: ["Read", "NotebookEdit"]\nmodel: sonnet\n---\nSurvey.\n',
    [OMP_PATHS.extensionTarget]: "export default function () {}\n",
  };

  function ompContext(extra: Record<string, string> = {}, links: Record<string, string> = {}) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return {
      ports: fake.ports,
      paths: OMP_PATHS,
      options: {
        ompModels: {},
        validateFrontmatter: (yaml: string) => {
          Bun.YAML.parse(yaml);
        },
      },
    };
  }

  const tiers = () => fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) }).ports;
  const cli = (context = ompContext()) =>
    applyCli(["--target", "omp"], tiers(), paths, undefined, undefined, context);

  test("the shared mount names this run's target; the agent files list model and tool gaps; native delivery and where language guidance travels are stated", async () => {
    const result = await cli();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("== omp ==");
    expect(result.stdout).toContain("dest: /home/u/.omp/agent");
    expect(result.stdout).toContain(
      "skills (cross-harness) directory: create  /home/u/.agents/skills",
    );
    expect(result.stdout).toContain("(this run: --target omp)");
    expect(result.stdout).toContain("agents (generated files): /home/u/.omp/agent/agents");
    expect(result.stdout).toContain("1 agent definition → <name>.md");
    expect(result.stdout).toMatch(
      /research\.md +write +model: \(none: no omp selector for "sonnet"\) +tools: \[read\] +dropped: NotebookEdit/,
    );
    expect(result.stdout).toContain("model tiers with no omp selector (sonnet: 1)");
    expect(result.stdout).toContain("Claude tools with no omp tool (NotebookEdit: 1)");
    expect(result.stdout).toContain("reaches omp natively, nothing to deliver:");
    expect(result.stdout).toContain("/home/u/.claude/CLAUDE.md → AGENTS.md");
    expect(result.stdout).toContain(
      "language guidance: inside the language skills (skills/<lang>-*)",
    );
  });

  test("mcp.json: jig's entries, the carried-through entries and keys, and the diff", async () => {
    const context = ompContext({
      [OMP_PATHS.mcpJson]: JSON.stringify({
        mcpServers: { mine: { type: "stdio", command: "mine" } },
        disabledServers: ["mine"],
      }),
    });
    const result = await cli(context);

    expect(result.stdout).toContain("mcp.json: write  /home/u/.omp/agent/mcp.json");
    expect(result.stdout).toContain("jig's mcpServers entries (2): serena, notion-mcp");
    expect(result.stdout).toContain(
      "entries no source produces (1), carried through as they are: mine",
    );
    expect(result.stdout).toContain("other top-level keys carried through: disabledServers");
    expect(result.stdout).toContain("--- diff (current vs generated) ---");
    expect(result.stdout).toContain('+    "serena": {');
  });

  test("an unreadable mcp.json is a CONFLICT line and exit 1", async () => {
    const result = await cli(ompContext({ [OMP_PATHS.mcpJson]: "{ nope" }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("outcome: conflict");
    expect(result.stdout).toContain("CONFLICT: the file could not be read as a JSON object");
  });

  test("the extension link, yoki's links under their own heading, the rest not jig's; the leftovers section", async () => {
    const context = ompContext(
      {
        [`${OMP}/extensions/orca-prefill.ts`]: "x",
        [`${OMP}/yoki-hooks.json`]: "{}",
        [`${OMP}/config.yml`]: "# GENERATED by yoki\n",
      },
      { [`${OMP}/extensions/yoki-guard.ts`]: "/repo/config/omp/extensions/yoki-guard.ts" },
    );
    const result = await cli(context);

    expect(result.stdout).toContain("extensions: /home/u/.omp/agent/extensions");
    expect(result.stdout).toMatch(
      /jig\.ts +create +→ \/repo\/llm\/harness\/jig\/adapters\/omp\/src\/index\.ts/,
    );
    expect(result.stdout).toContain("extension-module:jig");
    expect(result.stdout).toMatch(
      /yoki leftovers \(milestone 4\) \(1\), left alone:\n +yoki-guard\.ts +a symlink → /,
    );
    expect(result.stdout).toMatch(
      /not jig's \(1\), left alone:\n +orca-prefill\.ts +a regular file/,
    );
    expect(result.stdout).toContain("yoki leftovers (milestone 4) (2), left alone:");
    expect(result.stdout).toMatch(
      /config\.yml +a regular file +omp's settings, generated by yoki; jig does not own config\.yml/,
    );
    expect(result.stdout).toMatch(/yoki-hooks\.json +a regular file +yoki's hook registry/);
  });

  test("a clean agent directory says the extensions directory is created and no leftovers were found", async () => {
    const result = await cli();
    expect(result.stdout).toContain(
      "extensions: /home/u/.omp/agent/extensions  (created on --write)",
    );
    expect(result.stdout).toContain(
      "yoki leftovers (milestone 4): (none found under the agent directory)",
    );
  });

  test("--target omp with no omp context runs the tiers half alone and says so; --target all reaches omp's tiers half, never its agent directory", async () => {
    const alone = await applyCli(["--target", "omp"], tiers(), paths);
    expect(alone.code).toBe(0);
    expect(alone.stdout).toContain("== omp ==");
    expect(alone.stdout).toContain("not wired in this context: only omp/models.yml");
    const all = await applyCli([], tiers(), paths, undefined, undefined, ompContext());
    expect(all.stdout).toContain("== omp ==");
    expect(all.stdout).not.toContain("== omp (agent directory) ==");
  });
});

/**
 * The pi dry-run's report, through the CLI: `--target pi` runs the tiers
 * half (pi/models.json) and then the agent-directory half, and the sections
 * of the latter — the shared mount, AGENTS.md over the symlink with the
 * source-side cleanup, the adapter's config, the packages check with its
 * paste-able lines, the extensions as manager.sh leaves them, the two gaps —
 * are what a reader agrees to before `--write`.
 */
describe("applyCli --target pi", () => {
  const H = "/repo/llm/harness";
  const OLD = "/repo/config/claude-profiles";
  const REPO_PI = "/repo/config/pi";
  const PI = "/home/u/.pi/agent";
  const PI_PATHS = {
    harnessRoot: H,
    mcpServers: `${H}/mcp/servers.json`,
    decisions: `${H}/rules/decisions`,
    formerSkillRoots: [OLD],
    agentsSkills: "/home/u/.agents/skills",
    agentDir: PI,
    agentsMd: `${PI}/AGENTS.md`,
    mcpJson: "/home/u/.config/mcp/mcp.json",
    adapterOverride: `${PI}/mcp.json`,
    extensionsDir: `${PI}/extensions`,
    repoExtensionsDir: `${REPO_PI}/extensions`,
    repoSettings: `${REPO_PI}/settings.json`,
    retiredAgentsMd: `${REPO_PI}/AGENTS.md`,
    home: "/home/u",
  };

  const SOURCES: Record<string, string> = {
    [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
    [PI_PATHS.mcpServers]: JSON.stringify({
      schemaVersion: "jig.mcp.v1",
      servers: [
        {
          name: "serena",
          transport: "stdio",
          command: "uvx",
          args: ["serena"],
          targets: { pi: true },
        },
        {
          name: "notion-mcp",
          transport: "http",
          url: "https://mcp.notion.com/mcp",
          targets: { pi: true },
        },
      ],
    }),
    [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
    [`${H}/rules/decisions/a.md`]:
      "# A\n\nStatus: accepted — because\n\nrule: Do the thing.\n\n## Problem\n\nx\n",
    [`${H}/skills/README.md`]: "# skills\n",
    [`${H}/skills/writeup/SKILL.md`]: "---\nname: writeup\n---\n",
    [PI_PATHS.repoSettings]: JSON.stringify({ packages: ["npm:pi-web-access"] }),
  };

  function piContext(extra: Record<string, string> = {}, links: Record<string, string> = {}) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return { ports: fake.ports, paths: PI_PATHS, fake };
  }

  const cli = (context = piContext(), args = ["--target", "pi"]) =>
    applyCli(args, context.ports, paths, undefined, undefined, undefined, context);

  test("both halves in one run: the tiers section first, then the agent directory with the mount, the gaps and the packages lines", async () => {
    const result = await cli();

    expect(result.code).toBe(0);
    expect(result.stdout.indexOf("== pi ==")).toBeLessThan(
      result.stdout.indexOf("== pi (agent directory) =="),
    );
    expect(result.stdout).toContain("dest: /home/u/.pi/agent");
    expect(result.stdout).toContain(
      "skills (cross-harness) directory: create  /home/u/.agents/skills",
    );
    expect(result.stdout).toContain("(this run: --target pi)");
    expect(result.stdout).toContain("no /home/u/.pi/agent/skills is created");
    expect(result.stdout).toContain("AGENTS.md: write  /home/u/.pi/agent/AGENTS.md");
    expect(result.stdout).toContain("one file for all five harnesses");
    expect(result.stdout).toContain("mcp (pi-mcp-adapter): write  /home/u/.config/mcp/mcp.json");
    expect(result.stdout).toContain("jig's mcpServers entries (2): serena, notion-mcp");
    expect(result.stdout).toContain(
      "/home/u/.pi/agent/mcp.json: absent — the adapter's own override file",
    );
    expect(result.stdout).toContain("packages (report only): /repo/config/pi/settings.json");
    expect(result.stdout).toMatch(/pi-mcp-adapter +MISSING/);
    expect(result.stdout).toContain("run once:               pi install npm:pi-mcp-adapter");
    expect(result.stdout).toContain('or add to "packages":   "npm:pi-mcp-adapter"');
    expect(result.stdout).toMatch(/@tintinweb\/pi-subagents +MISSING/);
    expect(result.stdout).toContain("subagents: GAP — pi has none natively");
    expect(result.stdout).toContain("rules: language guidance is not a separate delivery");
  });

  test("the symlink standing at AGENTS.md today, the retiring repo file, and manager.sh's extension links", async () => {
    const context = piContext(
      {
        [`${REPO_PI}/AGENTS.md`]: "# Working rules (all pi tiers)\n",
        [`${REPO_PI}/extensions/guard.ts`]: "x",
        [`${PI}/extensions/orca-prefill.ts`]: "x",
        [PI_PATHS.repoSettings]: JSON.stringify({
          packages: ["npm:pi-mcp-adapter@1.0.0", "npm:@tintinweb/pi-subagents"],
        }),
      },
      {
        [`${PI}/AGENTS.md`]: `${REPO_PI}/AGENTS.md`,
        [`${PI}/extensions/guard.ts`]: `${REPO_PI}/extensions/guard.ts`,
      },
    );
    const result = await cli(context);

    expect(result.stdout).toContain(
      "a symlink stands there today (→ /repo/config/pi/AGENTS.md); on --write the link is replaced by the",
    );
    expect(result.stdout).toContain("-# Working rules (all pi tiers)");
    expect(result.stdout).toContain(
      "source-side cleanup (yours, not jig's): /repo/config/pi/AGENTS.md is a regular file",
    );
    expect(result.stdout).toContain("drop AGENTS.md from core/config/manager.sh link_pi_resources");
    expect(result.stdout).toMatch(/pi-mcp-adapter +present \(npm:pi-mcp-adapter@1\.0\.0\)/);
    expect(result.stdout).toMatch(
      /@tintinweb\/pi-subagents +present \(npm:@tintinweb\/pi-subagents\)/,
    );
    expect(result.stdout).not.toContain("run once:");
    expect(result.stdout).toContain(
      "delivered by core/config/manager.sh link_pi_resources until milestone 4 (1), links into next/home/shared/harness/pi/extensions/:",
    );
    expect(result.stdout).toMatch(
      /guard\.ts +a symlink → \/repo\/config\/pi\/extensions\/guard\.ts/,
    );
    expect(result.stdout).toMatch(
      /not jig's \(1\), left alone:\n +orca-prefill\.ts +a regular file/,
    );
    expect(result.stdout).toContain("Nothing here is linked or unlinked by this milestone.");
  });

  test("the adapter config: carried-through entries and keys, and the diff", async () => {
    const context = piContext({
      [PI_PATHS.mcpJson]: JSON.stringify({
        settings: { hostConfigDiscovery: "off" },
        mcpServers: { mine: { command: "mine" } },
      }),
    });
    const result = await cli(context);
    expect(result.stdout).toContain(
      "entries no source produces (1), carried through as they are: mine",
    );
    expect(result.stdout).toContain("other top-level keys carried through: settings");
    expect(result.stdout).toContain('+    "serena": {');
    expect(result.stdout).not.toContain('"type"');
  });

  test("an unreadable adapter config is a CONFLICT line and exit 1, while the tiers half still reports", async () => {
    const result = await cli(piContext({ [PI_PATHS.mcpJson]: "{ nope" }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("== pi ==\noutcome: write");
    expect(result.stdout).toContain("== pi (agent directory) ==\noutcome: conflict");
    expect(result.stdout).toContain("CONFLICT: the file could not be read as a JSON object");
  });

  test("--write does both halves; --target pi with no pi context runs the tiers half alone and says so; --target all never reaches the agent directory", async () => {
    const context = piContext();
    const written = await cli(context, ["--target", "pi", "--write"]);
    expect(written.code).toBe(0);
    expect(context.fake.files[PI_PATH]).toContain('"id": "main"');
    expect(context.fake.files[PI_PATHS.mcpJson]).toContain('"serena"');
    expect(context.fake.files[`${PI}/AGENTS.md`]).toContain("# Core");

    const alone = await applyCli(["--target", "pi"], piContext().ports, paths);
    expect(alone.code).toBe(0);
    expect(alone.stdout).toContain("== pi ==");
    expect(alone.stdout).toContain("not wired in this context: only pi/models.json");

    const all = await cli(piContext(), []);
    expect(all.stdout).toContain("== pi ==");
    expect(all.stdout).not.toContain("== pi (agent directory) ==");
  });
});

/**
 * The DSH dry-run's report, through the CLI: `--target dsh` runs the tiers
 * half (dsh/settings.yaml) and then the harness-home half, and the sections
 * of the latter — the profiles found against the repo's, the rows and the
 * block per profile, the home-level layer, AGENTS.md against DSH's budget,
 * what reaches DSH natively or through manager.sh, the [unverified] list —
 * are what a reader agrees to before `--write`.
 */
describe("applyCli --target dsh", () => {
  const H = "/repo/llm/harness";
  const REPO_DSH = "/repo/config/dsh";
  const DSH = "/home/u/.dsh";
  const PROFILES = `${DSH}/profiles`;
  const DSH_PATHS = {
    harnessRoot: H,
    mcpServers: `${H}/mcp/servers.json`,
    decisions: `${H}/rules/decisions`,
    dshHome: DSH,
    dshHomeVia: "default" as const,
    profilesDir: PROFILES,
    repoProfilesDir: `${REPO_DSH}/profiles`,
    agentsMd: `${DSH}/AGENTS.md`,
    homePatch: `${DSH}/cordis.patch.yml`,
    agentsSkills: "/home/u/.agents/skills",
    agentsSkillsVia: "default" as const,
    settingsYaml: `${DSH}/settings.yaml`,
    hooksClaudeJson: `${DSH}/hooks.claude.json`,
    pluginDir: `${H}/jig/adapters/dsh`,
    home: "/home/u",
  };

  const REPO_PATCH =
    "- id: agent-default-model\n  config:\n    provider: local-proxy\n- insert:\n    - id: jig-guard\n      name: '@esh2n/jig-dsh-guard'\n";

  const SOURCES: Record<string, string> = {
    [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
    [DSH_PATH]:
      "llm-pi-ai:\n  providers:\n    # BEGIN jig:tiers (generated — edit policy/tiers.json, then jig apply)\n    local-proxy:\n      displayName: x\n    # END jig:tiers\n",
    [DSH_PATHS.mcpServers]: JSON.stringify({
      schemaVersion: "jig.mcp.v1",
      servers: [
        {
          name: "serena",
          transport: "stdio",
          command: "uvx",
          args: ["serena"],
          targets: { dsh: true },
        },
        {
          name: "notion-mcp",
          transport: "http",
          url: "https://mcp.notion.com/mcp",
          targets: { pi: true, dsh: false },
        },
      ],
    }),
    [`${H}/rules/common/core.md`]: "# Core\n\nBe brief.\n",
    [`${H}/rules/decisions/a.md`]:
      "# A\n\nStatus: accepted — because\n\nrule: Do the thing.\n\n## Problem\n\nx\n",
    [`${REPO_DSH}/profiles/proxy/cordis.patch.yml`]: REPO_PATCH,
    [`${REPO_DSH}/profiles/headless/cordis.patch.yml`]: REPO_PATCH,
  };

  function dshContext(extra: Record<string, string> = {}, links: Record<string, string> = {}) {
    const fake = fakeClaudeFs({ files: { ...SOURCES, ...extra }, links });
    return { ports: fake.ports, paths: DSH_PATHS, fake };
  }

  const cli = (context = dshContext(), args = ["--target", "dsh"]) =>
    applyCli(args, context.ports, paths, undefined, undefined, undefined, undefined, context);

  test("both halves in one run: the tiers section first, then the harness home with the profiles, the rows, AGENTS.md against the budget, the report-only lines and the [unverified] list", async () => {
    const context = dshContext(
      {
        [`${PROFILES}/proxy/cordis.patch.yml`]: REPO_PATCH,
        [`${PROFILES}/web/package.json`]: "{}",
        [`${DSH}/hooks.claude.json`]: "{}",
      },
      {
        [`${PROFILES}/proxy/node_modules/@esh2n/jig-dsh-guard`]: `${H}/jig/adapters/dsh`,
        [`${DSH}/settings.yaml`]: `${REPO_DSH}/settings.yaml`,
      },
    );
    const result = await cli(context);

    expect(result.code).toBe(0);
    expect(result.stdout.indexOf("== dsh ==")).toBeLessThan(
      result.stdout.indexOf("== dsh (harness home) =="),
    );
    expect(result.stdout).toContain("dest: /home/u/.dsh  (default ~/.dsh; DSH_HOME overrides)");
    expect(result.stdout).toContain("profiles: /home/u/.dsh/profiles");
    expect(result.stdout).toMatch(
      /delivered to \(1\):\n +proxy +write +\/home\/u\/\.dsh\/profiles\/proxy\/cordis\.patch\.yml/,
    );
    expect(result.stdout).toContain(
      "in the repo, not scaffolded on this machine (1): headless — nothing delivered there",
    );
    expect(result.stdout).toContain("scaffolded, not the repo's (1), left alone: web");
    expect(result.stdout).toContain("jig's rows (1): mcp-serena");
    expect(result.stdout).toContain("proxy: write  /home/u/.dsh/profiles/proxy/cordis.patch.yml");
    expect(result.stdout).toContain("guard plugin (report only): linked (a symlink →");
    expect(result.stdout).toContain("+# jig:begin mcp");
    expect(result.stdout).toContain("+        serverName: 'serena'");
    expect(result.stdout).not.toContain("notion");
    expect(result.stdout).toContain(
      "/home/u/.dsh/cordis.patch.yml: absent — the home-level patch layer",
    );
    expect(result.stdout).toMatch(
      /AGENTS\.md: write {2}\/home\/u\/\.dsh\/AGENTS\.md {2}\(\d+ bytes of dsh-base's 65536-byte budget/,
    );
    expect(result.stdout).toContain("one file for all five harnesses");
    expect(result.stdout).toContain("skills (report only): /home/u/.agents/skills: absent");
    expect(result.stdout).toContain("DSH reads ~/.agents/skills natively");
    expect(result.stdout).toMatch(
      /settings\.yaml +\/home\/u\/\.dsh\/settings\.yaml: a symlink → \/repo\/config\/dsh\/settings\.yaml {2}\(/,
    );
    expect(result.stdout).toMatch(
      /hooks\.claude\.json +\/home\/u\/\.dsh\/hooks\.claude\.json: a regular file {2}\(/,
    );
    expect(result.stdout).toMatch(
      /jig-guard plugin +\/repo\/llm\/harness\/jig\/adapters\/dsh: build \+ link {2}\(/,
    );
    expect(result.stdout).toContain(
      "language guidance: inside the language skills (skills/<lang>-*)",
    );
    expect(result.stdout).toContain("[unverified] — facts the delivery rests on");
  });

  test("DSH not scaffolded: the dry-run says so, AGENTS.md is not delivered, and --write writes nothing under the home", async () => {
    const context = dshContext();
    const result = await cli(context, ["--target", "dsh", "--write"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("== dsh (harness home) ==\noutcome: noop");
    expect(result.stdout).toContain("message: DSH not scaffolded");
    expect(result.stdout).toContain(
      "DSH NOT SCAFFOLDED: no profile matches, so nothing is delivered",
    );
    expect(result.stdout).toContain(
      "AGENTS.md: not delivered  /home/u/.dsh/AGENTS.md  (DSH not scaffolded",
    );
    expect(Object.keys(context.fake.files).some((path) => path.startsWith(DSH))).toBe(false);
    // The tiers half still wrote the repo file.
    expect(context.fake.files[DSH_PATH]).toContain("LiteLLM (local)");
  });

  test("the scaffold's `[]`, a conflict outside the block (exit 1), and the unverified transport note", async () => {
    const empty = await cli(
      dshContext({ [`${PROFILES}/proxy/cordis.patch.yml`]: "# scaffold\n[]\n" }),
    );
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("the file holds only the scaffold's `[]`");
    expect(empty.stdout).toContain("-[]");

    const byHand = await cli(
      dshContext({
        [`${PROFILES}/proxy/cordis.patch.yml`]: `${REPO_PATCH}- id: mcp-serena\n  config:\n    serverName: serena\n`,
      }),
    );
    expect(byHand.code).toBe(1);
    expect(byHand.stdout).toContain("== dsh ==\noutcome: write");
    expect(byHand.stdout).toContain("== dsh (harness home) ==\noutcome: conflict");
    expect(byHand.stdout).toContain("CONFLICT: 2 of jig's rows already declared outside the block");
    expect(byHand.stdout).toMatch(/id mcp-serena {2}line 7/);
    expect(byHand.stdout).toMatch(/serverName serena {2}line 9/);
    expect(byHand.stdout).toContain("streamable-http");
  });

  test("--write does both halves; --target dsh with no dsh context runs the tiers half alone and says so; --target all never reaches the home", async () => {
    const context = dshContext({ [`${PROFILES}/proxy/cordis.patch.yml`]: REPO_PATCH });
    const written = await cli(context, ["--target", "dsh", "--write"]);
    expect(written.code).toBe(0);
    expect(context.fake.files[DSH_PATH]).toContain("LiteLLM (local)");
    expect(context.fake.files[`${PROFILES}/proxy/cordis.patch.yml`]).toContain("mcp-serena");
    expect(context.fake.files[`${DSH}/AGENTS.md`]).toContain("# Core");

    const alone = await applyCli(["--target", "dsh"], dshContext().ports, paths);
    expect(alone.code).toBe(0);
    expect(alone.stdout).toContain("== dsh ==");
    expect(alone.stdout).toContain("not wired in this context: only dsh/settings.yaml");

    const all = await cli(dshContext(), []);
    expect(all.stdout).toContain("== dsh ==");
    expect(all.stdout).not.toContain("== dsh (harness home) ==");
  });
});
