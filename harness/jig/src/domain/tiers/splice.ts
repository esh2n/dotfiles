/**
 * Splices a generated block into a hand-maintained text file between two
 * marker lines, leaving everything else — including the marker lines'
 * own indentation — byte-for-byte untouched. Used to write the managed
 * `local-proxy:` subtree into dsh's `settings.yaml` (a file the Web Models
 * page also writes) and the managed `model_list` entries into litellm's
 * `config.yaml`, without jig ever owning the whole file.
 *
 * Pure string manipulation — no IO, no YAML/JSON parsing of the surrounding
 * document, so it works identically for either target's file format.
 */

export interface SpliceMarkers {
  readonly begin: string;
  readonly end: string;
}

function findMarkerLineIndex(lines: readonly string[], marker: string): number {
  return lines.findIndex((line) => line.includes(marker));
}

/**
 * @param existingFileText the full current file content
 * @param blockText the freshly generated managed-block content (no marker lines, no leading/trailing blank lines expected)
 * @param markers the exact marker text to search for (matched as a substring of a line, so callers may indent it however they like)
 */
export function spliceManagedBlock(
  existingFileText: string,
  blockText: string,
  markers: SpliceMarkers,
): string {
  const lines = existingFileText.split("\n");

  const beginIndex = findMarkerLineIndex(lines, markers.begin);
  if (beginIndex === -1) {
    throw new Error(`spliceManagedBlock: missing BEGIN marker ${JSON.stringify(markers.begin)}`);
  }

  const endIndex = findMarkerLineIndex(lines, markers.end);
  if (endIndex === -1) {
    throw new Error(`spliceManagedBlock: missing END marker ${JSON.stringify(markers.end)}`);
  }

  if (endIndex < beginIndex) {
    throw new Error("spliceManagedBlock: END marker appears before BEGIN marker");
  }

  const before = lines.slice(0, beginIndex + 1);
  const after = lines.slice(endIndex);

  return [...before, ...blockText.split("\n"), ...after].join("\n");
}
