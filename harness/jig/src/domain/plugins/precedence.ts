/**
 * A pack's precedence table: `harness/plugins/<name>/precedence.json`, one
 * row per line of the house's precedence table (`rules/common/80-pstack.md`),
 * each quoting, verbatim, the pack text the row overrides and the file it
 * sits in (`rules/decisions/2026-10-19-pstack-precedence-table.md`).
 *
 * When an upgrade of the pack rewrites or drops a quoted sentence, the row
 * that overrides it needs a fresh look; `missingQuotes` names those. When
 * the pack has moved past `verifiedAt`, `rowsTouchedBy` names the rows whose
 * quoted files changed in between, even where the quote survived.
 *
 * Pure. No IO.
 */

export interface PrecedenceQuote {
  /** Relative to the pack's checkout. */
  readonly file: string;
  readonly text: string;
}

export interface PrecedenceRow {
  readonly id: string;
  readonly quotes: readonly PrecedenceQuote[];
}

export interface Precedence {
  /** The upstream commit the quotes were last checked against. */
  readonly verifiedAt?: string;
  readonly rows: readonly PrecedenceRow[];
}

export interface MissingQuote {
  readonly id: string;
  readonly file: string;
  readonly text: string;
  /** The quoted file itself is gone from the pack. */
  readonly fileMissing: boolean;
}

export interface TouchedRow {
  readonly id: string;
  /** The row's quoted files that changed, each once. */
  readonly files: readonly string[];
}

const COMMIT_RE = /^[0-9a-f]{40}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsidePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function parseQuote(where: string, raw: unknown): PrecedenceQuote {
  if (!isObject(raw)) throw new Error(`${where}: each quote must be an object`);
  if (!isInsidePath(raw.file)) {
    throw new Error(`${where}: a quote's "file" must be a path inside the checkout`);
  }
  if (typeof raw.text !== "string" || raw.text === "") {
    throw new Error(`${where}: a quote's "text" must be a non-empty string`);
  }
  return { file: raw.file, text: raw.text };
}

function parseRow(name: string, raw: unknown): PrecedenceRow {
  const where = `plugin "${name}": precedence.json`;
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
    throw new Error(`${where}: each row needs a non-empty "id"`);
  }
  if (!Array.isArray(raw.quotes)) {
    throw new Error(`${where}: row "${raw.id}" needs a "quotes" array`);
  }
  const rowWhere = `${where}, row "${raw.id}"`;
  return { id: raw.id, quotes: raw.quotes.map((quote) => parseQuote(rowWhere, quote)) };
}

export function parsePrecedence(name: string, text: string): Precedence {
  const where = `plugin "${name}": precedence.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} is not JSON (${String(error)})`);
  }
  if (!isObject(raw)) throw new Error(`${where} must be an object`);
  if (raw.verifiedAt !== undefined) {
    if (typeof raw.verifiedAt !== "string" || !COMMIT_RE.test(raw.verifiedAt)) {
      throw new Error(`${where}: "verifiedAt" must be a 40 hex commit id`);
    }
  }
  if (!Array.isArray(raw.rows)) throw new Error(`${where}: "rows" must be an array`);
  const rows = raw.rows.map((row) => parseRow(name, row));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`${where}: row "${row.id}" appears twice`);
    seen.add(row.id);
  }
  return {
    ...(raw.verifiedAt === undefined ? {} : { verifiedAt: raw.verifiedAt as string }),
    rows,
  };
}

/** Every quoted file, in order, once each: what the checker has to read. */
export function precedenceFiles(precedence: Precedence): readonly string[] {
  return [...new Set(precedence.rows.flatMap((row) => row.quotes.map((quote) => quote.file)))];
}

/**
 * The quotes no longer in their file, verbatim (case and spacing count). A
 * file `contents` has no text for is gone, and every quote from it is missing.
 */
export function missingQuotes(
  precedence: Precedence,
  contents: ReadonlyMap<string, string | undefined>,
): readonly MissingQuote[] {
  return precedence.rows.flatMap((row) =>
    row.quotes.flatMap((quote) => {
      const content = contents.get(quote.file);
      if (content?.includes(quote.text)) return [];
      return [{ id: row.id, ...quote, fileMissing: content === undefined }];
    }),
  );
}

/** The rows that quote one of `changed`, with the changed files they quote. */
export function rowsTouchedBy(
  precedence: Precedence,
  changed: readonly string[],
): readonly TouchedRow[] {
  const changedSet = new Set(changed);
  return precedence.rows.flatMap((row) => {
    const files = [...new Set(row.quotes.map((quote) => quote.file))].filter((file) =>
      changedSet.has(file),
    );
    return files.length === 0 ? [] : [{ id: row.id, files }];
  });
}
