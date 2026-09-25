/**
 * The MCP servers jig owns in a DSH profile's `cordis.patch.yml`, as pure
 * transforms: one Cordis plugin row per server, rendered as YAML inside
 * jig's own marked block.
 *
 * DSH has a native MCP client, `@deepseek-ai/dsh-mcp-client`, and no
 * `mcpServers` JSON at all: "One configuration entry per server is the
 * entire setup" (its README, 0.1.5-rc.2, "Minimal configuration"), each
 * entry a plugin row of the profile tree —
 *
 *   - id: mcp-github
 *     name: '@deepseek-ai/dsh-mcp-client'
 *     config:
 *       serverName: github
 *       transport: stdio
 *       command: npx
 *       args: ['-y', '@modelcontextprotocol/server-github']
 *       env:
 *         GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
 *
 * The README's field table: `transport` (required, `stdio` or
 * `streamable-http`), `serverName` (required, `[A-Za-z0-9_-]{1,32}`, "unique
 * inside one registration scope"), `command` / `args` / `env` / `cwd` for
 * stdio ("extra env merged over scrubbed ambient env"), `url` / `headers` for
 * streamable-http. The optional fields (`toolCallTimeoutMs`,
 * `failOnStartupError`, `reconnect.*`) have no counterpart in
 * `mcp/servers.json` and are not written. The same facts are recorded in
 * `rules/research/2026-09-22-mcp-pi-omp-and-usage-guidance.md` §Q2 (DSH).
 *
 * DSH loads eagerly: "The tool descriptions and input schemas enter every
 * request while the tools are registered" (README, "Model Experience"), so
 * per `rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md`
 * (届け方) only the servers with `targets.dsh: true` — serena,
 * codebase-memory-mcp, context7 — are delivered, and the source file, not
 * this module, is where that set is chosen.
 *
 * Transport: the source's `http` and `sse` both become `streamable-http`,
 * the only remote transport the README documents ("Streamable HTTP when it
 * runs as a service"); the research record notes Streamable HTTP carries
 * SSE streaming and DSH has no separate `sse` option. [unverified: whether
 * an SSE-only server answers a Streamable HTTP client; no source server
 * with `targets.dsh` uses either transport today.]
 *
 * `{{HOME}}` is jig's and substituted here: DSH reads paths literally
 * (`core/config/manager.sh install_expanded` exists for that reason). A
 * `${VAR}` reference is not something DSH expands either — its documented
 * form is a `!!js` expression evaluated at boot ("interpolate `!!js`
 * expressions at boot", dsh-app-boot README, "cordis.patch.yml"), so every
 * string carrying a reference is rendered as one: `${VAR}` alone becomes
 * `!!js process.env.VAR` and a mixed string the README's template form,
 * `!!js '`Bearer ${process.env.MCP_TOKEN}`'`.
 *
 * Row ids are `mcp-<name>`, the README's own convention, so a row jig owns
 * is recognisable by its id; the loader refuses a second entry of one id
 * ("duplicate loader entry id", cordis-plugin-loader) and the client a
 * second entry of one `serverName` ("the later one fails to load"), which
 * is why `./cordis-patch.ts` names either kind of duplicate outside the
 * block as a conflict.
 */

import { type TemplateVars, templateString } from "../compose/template";
import type { McpServer } from "../mcp/types";

/** The plugin every row names (dsh-mcp-client README). */
export const DSH_MCP_CLIENT = "@deepseek-ai/dsh-mcp-client";

/** Row ids are `mcp-<serverName>`, the README's convention. */
export const DSH_MCP_ID_PREFIX = "mcp-";

export const MCP_BLOCK_BEGIN = "# jig:begin mcp";
export const MCP_BLOCK_END = "# jig:end mcp";

/** DSH's two transports (README field table). */
export type DshMcpTransport = "stdio" | "streamable-http";

/** One `config:` map of a row, in the order the fields are written. */
export interface DshMcpConfig {
  readonly serverName: string;
  readonly transport: DshMcpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** One plugin row, ready to render under `- insert:`. */
export interface DshMcpRow {
  readonly id: string;
  readonly name: typeof DSH_MCP_CLIENT;
  readonly config: DshMcpConfig;
}

function applyDshOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.dsh;
  return override ? { ...server, ...override } : server;
}

function nonEmpty(
  record: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  return record && Object.keys(record).length > 0 ? { ...record } : undefined;
}

function templateRecord(
  record: Readonly<Record<string, string>>,
  vars: TemplateVars,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[key] = templateString(value, vars);
  return out;
}

function configOf(server: McpServer, vars: TemplateVars): DshMcpConfig {
  if (server.transport !== "stdio") {
    const headers = nonEmpty(server.headers);
    return {
      serverName: server.name,
      transport: "streamable-http",
      ...(server.url === undefined ? {} : { url: templateString(server.url, vars) }),
      ...(headers === undefined ? {} : { headers: templateRecord(headers, vars) }),
    };
  }
  const env = nonEmpty(server.env);
  const args = server.args ?? [];
  return {
    serverName: server.name,
    transport: "stdio",
    ...(server.command === undefined ? {} : { command: templateString(server.command, vars) }),
    ...(args.length === 0 ? {} : { args: args.map((arg) => templateString(arg, vars)) }),
    ...(env === undefined ? {} : { env: templateRecord(env, vars) }),
  };
}

/**
 * One row per server with `targets.dsh: true`, the dsh override applied and
 * `{{HOME}}` substituted. Order is the source's.
 */
export function buildDshMcpRows(
  servers: readonly McpServer[],
  vars: TemplateVars,
): readonly DshMcpRow[] {
  const rows: DshMcpRow[] = [];
  for (const server of servers) {
    if (server.targets?.dsh !== true) continue;
    const effective = applyDshOverride(server);
    rows.push({
      id: `${DSH_MCP_ID_PREFIX}${effective.name}`,
      name: DSH_MCP_CLIENT,
      config: configOf(effective, vars),
    });
  }
  return rows;
}

// --- YAML rendering: the small subset a row needs, every string quoted ---

/** `${VAR}` or `${VAR:-default}` — the reference forms `mcp/servers.json` may carry (parse.ts). */
const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const ENV_REF_ALONE_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/;

/** A YAML single-quoted scalar: only `'` needs doubling. */
function yamlSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A JS single-quoted string literal, for a default value inside a `!!js` expression. */
function jsSingleQuoted(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Literal text inside a JS template literal. */
function jsTemplateText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function jsEnvAccess(name: string, fallback: string | undefined): string {
  return fallback === undefined
    ? `process.env.${name}`
    : `(process.env.${name} ?? ${jsSingleQuoted(fallback)})`;
}

/**
 * One scalar as DSH reads it: a quoted string, or — when it carries an
 * env-var reference — a `!!js` expression in the README's two forms.
 */
export function renderDshScalar(value: string): string {
  const alone = ENV_REF_ALONE_RE.exec(value);
  if (alone?.[1] !== undefined) return `!!js ${jsEnvAccess(alone[1], alone[2])}`;
  if (value.match(ENV_REF_RE) === null) return yamlSingleQuoted(value);
  let template = "";
  let last = 0;
  for (const match of value.matchAll(ENV_REF_RE)) {
    const name = match[1];
    if (name === undefined) continue;
    template += jsTemplateText(value.slice(last, match.index));
    template += `\${${jsEnvAccess(name, match[2])}}`;
    last = match.index + match[0].length;
  }
  template += jsTemplateText(value.slice(last));
  return `!!js ${yamlSingleQuoted(`\`${template}\``)}`;
}

/** A bare key where YAML plain scalars are unambiguous; quoted otherwise (an env name is user-supplied). */
function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : yamlSingleQuoted(key);
}

function renderRecord(
  label: string,
  record: Readonly<Record<string, string>>,
  indent: string,
): readonly string[] {
  return [
    `${indent}${label}:`,
    ...Object.entries(record).map(
      ([key, value]) => `${indent}  ${yamlKey(key)}: ${renderDshScalar(value)}`,
    ),
  ];
}

function renderConfig(config: DshMcpConfig, indent: string): readonly string[] {
  const lines = [
    `${indent}serverName: ${renderDshScalar(config.serverName)}`,
    `${indent}transport: ${renderDshScalar(config.transport)}`,
  ];
  if (config.command !== undefined)
    lines.push(`${indent}command: ${renderDshScalar(config.command)}`);
  if (config.args !== undefined) {
    lines.push(
      `${indent}args:`,
      ...config.args.map((arg) => `${indent}  - ${renderDshScalar(arg)}`),
    );
  }
  if (config.env !== undefined) lines.push(...renderRecord("env", config.env, indent));
  if (config.url !== undefined) lines.push(`${indent}url: ${renderDshScalar(config.url)}`);
  if (config.headers !== undefined) lines.push(...renderRecord("headers", config.headers, indent));
  return lines;
}

/**
 * The managed block, markers included: one `- insert:` patch row holding
 * every plugin row (dsh-app-boot README, "cordis.patch.yml": "insert new
 * entries"; `PatchOptions.insert: EntryOptions[]`). Empty when there are no
 * rows — a block with an empty `insert` would be a patch that does nothing,
 * and the markers alone are not worth a write.
 */
export function renderDshMcpBlock(rows: readonly DshMcpRow[]): string {
  if (rows.length === 0) return "";
  const lines = [MCP_BLOCK_BEGIN, "- insert:"];
  for (const row of rows) {
    lines.push(
      `    - id: ${renderDshScalar(row.id)}`,
      `      name: ${renderDshScalar(row.name)}`,
      "      config:",
      ...renderConfig(row.config, "        "),
    );
  }
  lines.push(MCP_BLOCK_END);
  return `${lines.join("\n")}\n`;
}
