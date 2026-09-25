/**
 * jig's block inside a DSH profile's `cordis.patch.yml`, as pure text
 * transforms over a file jig does not own.
 *
 * The file is "the user's own patch layer, applied after every bundle
 * layer" (dsh-app-boot `profile.d.ts`): "a top-level YAML array of loader
 * patch entries (id-targeted config overrides, disables, and insert lists;
 * `!!js` expressions allowed)" — the comment DSH itself writes into the
 * file it scaffolds. `applyEntryPatches(data, patches)` applies "the patch
 * list ... in order" (cordis-plugin-include), each row either naming an
 * existing entry by `id` (its whole `config` replaced — "an id-targeted
 * patch does not deep-merge", dsh-app-boot README) or carrying `insert:
 * EntryOptions[]` (new entries appended). Rows are therefore mergeable: jig
 * adds one `- insert:` row of its own and every other row — the repo's
 * `agent-default-model` override and `jig-guard` insert that manager.sh
 * installs, anything added by hand — is carried through byte for byte,
 * comments included, because the file is spliced as text and never
 * re-serialised.
 *
 * The block sits between `# jig:begin mcp` and `# jig:end mcp` at the end
 * of the file (YAML comments are legal between sequence items), and
 * hand-edit detection compares the block, not the file, so manager.sh's
 * next `install_expanded` of the repo copy — which drops the block — reads
 * as "write again", not as a conflict.
 *
 * Two DSH facts shape the edge cases:
 * - "an empty or comments-only file fails boot — disable the layer with
 *   `[]` instead" (dsh-app-boot README). The scaffold ships `[]` under a
 *   comment; when jig's block is the file's first row that `[]` has to go
 *   (a flow-style empty sequence cannot take block-style items after it),
 *   and when the block is removed from a file that then holds nothing but
 *   comments, `[]` has to come back.
 * - a second entry of one id fails boot ("duplicate loader entry id",
 *   cordis-plugin-loader) and a second row of one `serverName` fails to
 *   load ("the later one fails to load", dsh-mcp-client README), so a jig id
 *   or server name declared outside the block is a conflict the generator
 *   names and refuses to write over — the one-time manual reconciliation
 *   `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` keeps
 *   out of the generator, as with `~/.claude.json` and Codex's tables.
 */

import type { DshMcpRow } from "./mcp";
import { MCP_BLOCK_BEGIN, MCP_BLOCK_END } from "./mcp";

export interface CordisPatchPlan {
  /** The file as it should read afterwards. */
  readonly text: string;
  readonly changed: boolean;
  /** The block as it stands in the file today, markers included; absent when there is none. */
  readonly currentBlock: string | undefined;
  /** The scaffold's `[]` (an empty layer) stands alone in the file and gives way to the block. */
  readonly replacesEmptyLayer: boolean;
  /** Set when the file has a begin marker and no end marker: nothing can be carried through, so nothing is written. */
  readonly invalid?: string;
}

/** The file with jig's block removed; `undefined` when a begin marker has no end. */
function removeBlock(text: string): string | undefined {
  const begin = text.indexOf(MCP_BLOCK_BEGIN);
  if (begin === -1) return text;
  const endAt = text.indexOf(MCP_BLOCK_END, begin);
  if (endAt === -1) return undefined;
  const end = endAt + MCP_BLOCK_END.length;
  return text.slice(0, begin) + text.slice(end).replace(/^\n/, "");
}

/** The block as written today, markers included, or nothing. */
export function currentCordisBlock(text: string): string | undefined {
  const begin = text.indexOf(MCP_BLOCK_BEGIN);
  if (begin === -1) return undefined;
  const endAt = text.indexOf(MCP_BLOCK_END, begin);
  if (endAt === -1) return undefined;
  return text.slice(begin, endAt + MCP_BLOCK_END.length + 1);
}

function isContentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

/**
 * Upsert the block at the end of the file. A previous block is removed
 * wholesale first, so a server dropped from the source leaves no row
 * behind; `block` empty means "no block" and only removes.
 */
export function planCordisPatch(existing: string | undefined, block: string): CordisPatchPlan {
  const before = existing ?? "";
  const stripped = removeBlock(before);
  if (stripped === undefined) {
    return {
      text: before,
      changed: false,
      currentBlock: undefined,
      replacesEmptyLayer: false,
      invalid: `"${MCP_BLOCK_BEGIN}" without "${MCP_BLOCK_END}"`,
    };
  }
  const lines = stripped.split("\n");
  const content = lines.filter(isContentLine);
  const onlyEmptyLayer = content.length === 1 && content[0]?.trim() === "[]";

  let kept = lines;
  if (block !== "" && onlyEmptyLayer) kept = lines.filter((line) => line.trim() !== "[]");
  let text = kept.join("\n").replace(/\s+$/, "");
  if (block !== "") {
    text = text === "" ? block : `${text}\n\n${block}`;
  } else {
    // Nothing of jig's goes in; a file left with comments only would fail boot.
    if (content.length === 0 && before !== "") text = text === "" ? "[]\n" : `${text}\n[]\n`;
    else if (text !== "") text = `${text}\n`;
  }
  return {
    text,
    changed: text !== before,
    currentBlock: currentCordisBlock(before),
    replacesEmptyLayer: block !== "" && onlyEmptyLayer,
  };
}

/** A jig row's id or server name declared outside the block, with the line it is on (1-based). */
export interface DeclaredOutside {
  readonly kind: "id" | "serverName";
  readonly value: string;
  readonly line: number;
}

const ID_LINE_RE = /^\s*-?\s*id:\s*(?:'((?:[^']|'')*)'|"([^"\\]*)"|([^\s#'"][^\s#]*))\s*(?:#.*)?$/;
const SERVER_NAME_LINE_RE =
  /^\s*serverName:\s*(?:'((?:[^']|'')*)'|"([^"\\]*)"|([^\s#'"][^\s#]*))\s*(?:#.*)?$/;

/** The 0-based line span of jig's block, markers included; nothing when the file has none. */
function blockLineRange(
  lines: readonly string[],
): { readonly first: number; readonly last: number } | undefined {
  const first = lines.findIndex((line) => line.startsWith(MCP_BLOCK_BEGIN));
  if (first === -1) return undefined;
  const rest = lines.slice(first).findIndex((line) => line.startsWith(MCP_BLOCK_END));
  return { first, last: rest === -1 ? lines.length - 1 : first + rest };
}

function scalarOf(match: RegExpExecArray): string | undefined {
  if (match[1] !== undefined) return match[1].replace(/''/g, "'");
  return match[2] ?? match[3];
}

/**
 * Rows jig would write that are already declared somewhere else in the
 * text — by hand, or by another generator — by id or by server name. Each
 * is a conflict: a duplicate id fails boot, a duplicate server name loses
 * the later row, which would be jig's.
 */
export function declaredOutsideBlock(
  text: string,
  rows: readonly DshMcpRow[],
): readonly DeclaredOutside[] {
  const ids = new Set(rows.map((row) => row.id));
  const names = new Set(rows.map((row) => row.config.serverName));
  const seen = new Set<string>();
  const found: DeclaredOutside[] = [];
  const lines = text.split("\n");
  const block = blockLineRange(lines);
  lines.forEach((line, index) => {
    if (block !== undefined && index >= block.first && index <= block.last) return;
    const id = ID_LINE_RE.exec(line);
    const idValue = id === null ? undefined : scalarOf(id);
    if (idValue !== undefined && ids.has(idValue) && !seen.has(`id:${idValue}`)) {
      seen.add(`id:${idValue}`);
      found.push({ kind: "id", value: idValue, line: index + 1 });
      return;
    }
    const name = SERVER_NAME_LINE_RE.exec(line);
    const nameValue = name === null ? undefined : scalarOf(name);
    if (nameValue !== undefined && names.has(nameValue) && !seen.has(`serverName:${nameValue}`)) {
      seen.add(`serverName:${nameValue}`);
      found.push({ kind: "serverName", value: nameValue, line: index + 1 });
    }
  });
  return found;
}
