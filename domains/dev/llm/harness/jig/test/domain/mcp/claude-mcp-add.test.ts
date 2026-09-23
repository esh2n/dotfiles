/**
 * `mcp/servers.json` → `claude mcp add` lines. The selection, override and
 * templating are the milestone-1 logic unchanged; the rendered shape is the
 * CLI invocation, because settings.json is not an MCP source (mcp.md).
 */

import { describe, expect, test } from "bun:test";
import { renderClaudeMcpAdd } from "../../../src/domain/mcp/claude-mcp-add";
import { buildClaudeMcpServers } from "../../../src/domain/mcp/to-claude";
import type { McpServer } from "../../../src/domain/mcp/types";

const VARS = { HOME: "/home/u" };

const SERENA: McpServer = {
  name: "serena",
  transport: "stdio",
  command: "uvx",
  args: ["-p", "3.13", "serena-agent==1.5.3", "start-mcp-server", "--context", "claude-code"],
  env: {},
  targets: { claude: true, codex: true },
  targetOverrides: { codex: { args: ["--context", "codex"] } },
};

const render = (servers: readonly McpServer[]) =>
  buildClaudeMcpServers(servers, VARS).map(renderClaudeMcpAdd);

describe("buildClaudeMcpServers", () => {
  test("keeps only targets.claude: true, in source order", () => {
    const servers: McpServer[] = [
      SERENA,
      {
        name: "playwright",
        transport: "stdio",
        command: "npx",
        targets: { claude: false, codex: true },
      },
      { name: "no-targets", transport: "stdio", command: "x" },
      {
        name: "ctx7",
        transport: "stdio",
        command: "npx",
        args: ["-y", "ctx7"],
        targets: { claude: true },
      },
    ];
    expect(buildClaudeMcpServers(servers, VARS).map((add) => add.name)).toEqual(["serena", "ctx7"]);
  });

  test("targetOverrides.claude replaces fields; another harness's override does not", () => {
    const server: McpServer = {
      ...SERENA,
      targetOverrides: {
        claude: { args: ["--context", "claude-code", "--extra"] },
        codex: { args: ["--context", "codex"] },
      },
    };
    const [add] = buildClaudeMcpServers([server], VARS);
    expect(add?.args).toEqual(["--context", "claude-code", "--extra"]);
    expect(add?.command).toBe("uvx");
  });

  test("{{HOME}} is substituted in command, args, url, env and headers", () => {
    const servers: McpServer[] = [
      {
        name: "cmm",
        transport: "stdio",
        command: "{{HOME}}/bin/cmm",
        args: ["--root", "{{HOME}}/src"],
        env: { CACHE: "{{HOME}}/.cache" },
        targets: { claude: true },
      },
      {
        name: "local-http",
        transport: "http",
        url: "http://localhost/{{HOME}}",
        headers: { "X-Home": "{{HOME}}" },
        targets: { claude: true },
      },
    ];
    const [stdio, http] = buildClaudeMcpServers(servers, VARS);
    expect(stdio?.command).toBe("/home/u/bin/cmm");
    expect(stdio?.args).toEqual(["--root", "/home/u/src"]);
    expect(stdio?.env).toEqual({ CACHE: "/home/u/.cache" });
    expect(http?.url).toBe("http://localhost//home/u");
    expect(http?.headers).toEqual({ "X-Home": "/home/u" });
  });

  test("an unknown placeholder is left as-is so the typo shows in the printed line", () => {
    const [add] = buildClaudeMcpServers(
      [{ name: "s", transport: "stdio", command: "{{NOPE}}/x", targets: { claude: true } }],
      VARS,
    );
    expect(add?.command).toBe("{{NOPE}}/x");
  });
});

describe("renderClaudeMcpAdd", () => {
  test("stdio: --transport stdio --scope user <name> -- <command> <args…>", () => {
    expect(render([SERENA])).toEqual([
      "claude mcp add --transport stdio --scope user serena -- uvx -p 3.13 serena-agent==1.5.3 start-mcp-server --context claude-code",
    ]);
  });

  test("http: --transport http --scope user <name> <url>, headers as -H, env as -e", () => {
    const server: McpServer = {
      name: "figma-remote",
      transport: "http",
      url: "https://mcp.figma.com/mcp",
      headers: { Authorization: "Bearer ${FIGMA_TOKEN}" },
      env: { LOG_LEVEL: "debug" },
      targets: { claude: true },
    };
    expect(render([server])).toEqual([
      "claude mcp add --transport http --scope user figma-remote https://mcp.figma.com/mcp -H 'Authorization: Bearer ${FIGMA_TOKEN}' -e LOG_LEVEL=debug",
    ]);
  });

  test("sse is rendered like http, with its own --transport", () => {
    const server: McpServer = {
      name: "legacy",
      transport: "sse",
      url: "https://example.com/sse",
      targets: { claude: true },
    };
    expect(render([server])).toEqual([
      "claude mcp add --transport sse --scope user legacy https://example.com/sse",
    ]);
  });

  test("stdio env is -e KEY=value before the --, and a ${VAR} value is single-quoted", () => {
    const server: McpServer = {
      name: "s",
      transport: "stdio",
      command: "x",
      args: [],
      env: { API_KEY: "${MY_API_KEY}" },
      targets: { claude: true },
    };
    expect(render([server])).toEqual([
      "claude mcp add --transport stdio --scope user s -e 'API_KEY=${MY_API_KEY}' -- x",
    ]);
  });

  test("args with spaces and quotes survive quoting", () => {
    const server: McpServer = {
      name: "s",
      transport: "stdio",
      command: "/opt/my tools/server",
      args: ["--name", "it's here", "--flag"],
      targets: { claude: true },
    };
    expect(render([server])).toEqual([
      "claude mcp add --transport stdio --scope user s -- '/opt/my tools/server' --name 'it'\\''s here' --flag",
    ]);
  });

  test("an http server with no url still renders its name (the source is wrong; the line shows it)", () => {
    const server: McpServer = { name: "nourl", transport: "http", targets: { claude: true } };
    expect(render([server])).toEqual(["claude mcp add --transport http --scope user nourl"]);
  });
});
