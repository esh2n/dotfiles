'use strict';

/**
 * `yoki-switch doctor --prepush [base]` (task T35) — scans this branch's
 * own diff against `base` (default `main`) for the stuff a push must never
 * carry: secrets, e-mail addresses, hardcoded home paths, and tracked
 * symlinks that fail the T35 relative/in-repo rule (see
 * core/validation/portability.sh's check_tracked_symlinks_safe for the
 * repo-wide version of that same rule).
 *
 * The TEXT scan is deliberately scoped to ADDED lines only (`git diff
 * --unified=0`, lines starting with a single `+`) — a pre-existing hit
 * already on `base` is not this push's problem to fix, and re-flagging it on
 * every branch would train people to ignore the tool.
 *
 * The SYMLINK check is scoped to every path this range touches but does not
 * delete, read as committed at HEAD (never from the worktree): adding a
 * symlink is `A`/`R`, but converting a tracked file into one is `T` and
 * repointing an existing one is `M`, and all of those are this push's own
 * doing.
 *
 * A text-extension file that is BINARY as committed at HEAD is also a
 * `[fail]` (`binary-text`): it produces no `+` hunks, so it would otherwise
 * slip through the text scan entirely. A range that REPAIRS such a file is
 * not flagged (see isBinaryAtHead).
 *
 * One line per hit: `[fail] <file>:<line> <category>` — never the matched
 * text itself (this is a scanner, not a leak of the very thing it caught).
 * Exit 1 iff any `[fail]` hit. `--json` prints the finding list instead.
 *
 * Allow markers — for a hit that is deliberate (a fixture that must stay
 * byte-exact, the scanner's own test data):
 *
 *   yoki-prepush: allow <category>[,<category>…]
 *     on the hit line itself or on the line immediately before it. Plain
 *     text inside any comment syntax (`//`, `#`, `*`, `--`, `<!--`).
 *   yoki-prepush: allow-file <category>[,<category>…]
 *     anywhere in the first 5 lines of the file; covers every hit of those
 *     categories in that file.
 *
 * An allowed hit is reported as `[allow] <file>:<line> <category>` and
 * never fails the scan. Markers are read from the file as committed at
 * HEAD (the same content the diff describes), so a marker on a line that
 * is not itself part of the diff still counts.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SECRET_PATTERNS_PATH = path.join(__dirname, 'secret-patterns.json');

// ---------------------------------------------------------------------------
// secret / email / home-path pattern matching
// ---------------------------------------------------------------------------

/** @returns {Array<{id:string, label:string, re:RegExp}>} */
function loadSecretRules(patternsPath = SECRET_PATTERNS_PATH) {
  const defs = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
  return defs.map(d => ({ id: d.id, label: d.label, re: new RegExp(d.source, d.flags) }));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NOREPLY_EMAIL_RE = /noreply|no-reply/i;

// RFC 2606 / RFC 6761 names reserved for documentation and testing: an
// address under one of these can never reach a real mailbox, so it is not
// personal data and not a hit.
const RESERVED_EMAIL_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);
const RESERVED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

/** @returns {boolean} true when `address` is a noreply/reserved-domain address (not a hit) */
function isReservedEmail(address) {
  if (NOREPLY_EMAIL_RE.test(address)) return true;
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (RESERVED_EMAIL_TLDS.has(tld)) return true;
  for (const reserved of RESERVED_EMAIL_DOMAINS) {
    if (domain === reserved || domain.endsWith(`.${reserved}`)) return true;
  }
  return false;
}

// /Users/<name>/ or /home/<name>/ — an allow-listed account name is not a
// real person's machine and is not a hit: `agent` is the sbx docs' generic
// sandbox home, `exampleperson` is this repo's designated fixture account
// (the home-path counterpart of example.com — use it wherever a test just
// needs some home directory).
const HOME_PATH_RE = /\/(?:Users|home)\/([A-Za-z0-9_.-]+)\//g;
const HOME_PATH_ALLOWLIST = new Set(['agent', 'exampleperson']);

/** @returns {string[]} category ids hit by this one added line, deduped */
function scanLine(line, secretRules) {
  const categories = new Set();

  for (const rule of secretRules) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    if (re.test(line)) categories.add(rule.id);
  }

  const emailRe = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
  let m;
  while ((m = emailRe.exec(line))) {
    if (!isReservedEmail(m[0])) categories.add('email');
  }

  const homeRe = new RegExp(HOME_PATH_RE.source, HOME_PATH_RE.flags);
  while ((m = homeRe.exec(line))) {
    if (!HOME_PATH_ALLOWLIST.has(m[1])) categories.add('home-path');
  }

  return [...categories];
}

// ---------------------------------------------------------------------------
// allow markers
// ---------------------------------------------------------------------------

const ALLOW_MARKER_RE = /yoki-prepush:\s*allow(-file)?\s+([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)/g;
const ALLOW_FILE_HEAD_LINES = 5;

/**
 * Every `yoki-prepush: allow …` / `allow-file …` marker on one line.
 * @returns {Array<{scope:'line'|'file', categories:string[]}>}
 */
function parseAllowMarkers(text) {
  const markers = [];
  const re = new RegExp(ALLOW_MARKER_RE.source, ALLOW_MARKER_RE.flags);
  let m;
  while ((m = re.exec(text))) {
    markers.push({
      scope: m[1] ? 'file' : 'line',
      categories: m[2].split(',').map(c => c.trim().toLowerCase()).filter(Boolean),
    });
  }
  return markers;
}

/**
 * Categories allowed for a hit at 1-based `lineNo` of a file whose content
 * is `lines`: `allow-file` markers in the first 5 lines, plus `allow`
 * markers on the line itself or the line immediately before it.
 * @returns {Set<string>}
 */
function allowedCategoriesAt(lines, lineNo) {
  const allowed = new Set();
  const head = lines.slice(0, ALLOW_FILE_HEAD_LINES);
  for (const text of head) {
    for (const marker of parseAllowMarkers(text)) {
      if (marker.scope === 'file') marker.categories.forEach(c => allowed.add(c));
    }
  }
  for (const idx of [lineNo - 1, lineNo - 2]) {
    if (idx < 0 || idx >= lines.length) continue;
    for (const marker of parseAllowMarkers(lines[idx])) {
      if (marker.scope === 'line') marker.categories.forEach(c => allowed.add(c));
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// symlink safety (same rule as core/validation/portability.sh, in JS)
// ---------------------------------------------------------------------------

/**
 * @param {string} relPath the symlink's own path, repo-root-relative
 * @param {string} target its raw (unresolved) readlink() value
 * @returns {string|null} a category id, or null when the target is safe
 */
function symlinkTargetIssue(relPath, target) {
  // core/validation/fixtures/targets/expected encodes a fake absolute path
  // this way for the targets-golden suite — not a real repo hazard.
  if (target === '__FIXTURES_ROOT__' || target.startsWith('__FIXTURES_ROOT__/')) return null;

  if (target.startsWith('/')) return 'symlink-absolute';
  if (target.startsWith('~')) return 'symlink-home';

  const dir = path.posix.dirname(relPath.split(path.sep).join('/'));
  const joined = dir === '.' ? target : `${dir}/${target}`;
  const normalized = path.posix.normalize(joined);
  if (normalized === '..' || normalized.startsWith('../')) return 'symlink-escape';
  return null;
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

function runGit(repoRoot, args) {
  const proc = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(proc.stderr || '').trim() || `exit ${proc.status}`}`);
  }
  return proc.stdout;
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses `git diff <range> --unified=0` output into per-added-line records.
 * Only `+` lines are scanned; the new-file line number is tracked from each
 * hunk's `@@ -a,b +c,d @@` header and incremented once per `+` line (a `-`
 * line does not exist in the new file, so it does not advance the counter).
 *
 * `--- `/`+++ ` are file headers ONLY where git can emit one: between a
 * `diff --git` line and that file's first hunk, and only as a `--- ` then
 * `+++ ` pair. Inside a hunk they are content — an ADDED line whose text
 * starts with `++ ` is emitted as `+++ …`, and treating that as a header
 * both dropped the line from the scan and re-pointed every following hit at
 * a path that does not exist (`++ /dev/null` disabled the scan outright).
 *
 * @returns {Array<{file:string, line:number, text:string}>}
 */
function parseAddedLines(diffText) {
  const added = [];
  let currentFile = null;
  let lineNo = 0;
  let inHunk = false;
  let sawMinusHeader = false;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      currentFile = null;
      inHunk = false;
      sawMinusHeader = false;
      continue;
    }
    if (!inHunk && rawLine.startsWith('--- ')) {
      sawMinusHeader = true;
      continue;
    }
    if (!inHunk && sawMinusHeader && rawLine.startsWith('+++ ')) {
      const p = rawLine.slice(4).trim();
      currentFile = p === '/dev/null' ? null : p.replace(/^[ab]\//, '');
      sawMinusHeader = false;
      continue;
    }
    const hunk = HUNK_HEADER_RE.exec(rawLine);
    if (hunk) {
      inHunk = true;
      lineNo = Number(hunk[1]);
      continue;
    }
    if (currentFile === null) continue;
    if (rawLine.startsWith('+')) {
      added.push({ file: currentFile, line: lineNo, text: rawLine.slice(1) });
      lineNo++;
    }
    // '-' lines (removed) do not exist in the new file: no line-number bump.
  }

  return added;
}

/**
 * @returns {string[]} every repo-root-relative path this range touches
 * except the ones it deletes.
 *
 * The text scan stays scoped to ADDED lines (a pre-existing hit on base is
 * not this push's problem), but the symlink rule cannot be: converting a
 * tracked file into a symlink is a typechange (`T`) and repointing an
 * existing symlink is a modification (`M`), and both are entirely this
 * push's own doing. Non-symlinks cost nothing here — the caller's HEAD
 * lookup returns null for them.
 */
function parseTouchedFiles(nameStatusText) {
  const files = [];
  for (const rawLine of nameStatusText.split('\n')) {
    if (rawLine.trim() === '') continue;
    const fields = rawLine.split('\t');
    const status = fields[0];
    if (status.startsWith('D')) continue;
    // R<score>/C<score> carry <old>\t<new>; everything else carries one path.
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push(fields[2] ?? fields[1]);
    } else if (fields[1]) {
      files.push(fields[1]);
    }
  }
  return files;
}

// Extensions whose content must stay reviewable as text. Kept in sync with
// core/validation/portability.sh's check_no_nul_in_text_files (the repo-wide
// version of the same rule).
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.ts', '.sh', '.md', '.json', '.yaml', '.yml',
  '.toml', '.nix', '.html', '.css', '.txt', '.zsh',
]);

/** @returns {boolean} true when `relPath` carries a text-like extension */
function hasTextExtension(relPath) {
  return TEXT_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

// git's own heuristic: a blob is binary if a NUL byte appears in its first 8000.
const GIT_BINARY_SNIFF_BYTES = 8000;

/**
 * Is `relPath`, AS COMMITTED AT HEAD, a blob git will call binary?
 *
 * `git diff --numstat` reports `-\t-` when EITHER side of the range is
 * binary, so a commit that repairs a NUL-bearing file looks identical to one
 * that introduces it. Only the new side is this push's doing, so the finding
 * is gated on HEAD's blob — a range that fixes such a file is not flagged.
 */
function isBinaryAtHead(repoRoot, relPath) {
  const proc = spawnSync('git', ['-C', repoRoot, 'cat-file', 'blob', `HEAD:${relPath}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error || proc.status !== 0 || !proc.stdout) return false;
  return proc.stdout.subarray(0, GIT_BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Parses `git diff --numstat -z <range>`: one record per file, `-\t-` in
 * place of the counts where git classified the blob as BINARY.
 *
 * -z emits `<added>\t<deleted>\t<path>\0` normally, and
 * `<added>\t<deleted>\0<old>\0<new>\0` for a rename/copy.
 *
 * @returns {Array<{added:string, deleted:string, path:string}>}
 */
function parseNumstat(numstatText) {
  const chunks = numstatText.split('\0');
  const records = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === '') continue;
    const fields = chunk.split('\t');
    if (fields.length >= 3) {
      records.push({ added: fields[0], deleted: fields[1], path: fields.slice(2).join('\t') });
    } else if (fields.length === 2) {
      // rename/copy: the two following chunks are <old> then <new>
      const newPath = chunks[i + 2];
      if (newPath) records.push({ added: fields[0], deleted: fields[1], path: newPath });
      i += 2;
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

function result(status, file, line, category) {
  return { status, file, line, category };
}

/** Lines of `relPath` as committed at HEAD, or [] when it is not there (deleted, binary). */
function headFileLines(repoRoot, relPath) {
  const proc = spawnSync('git', ['-C', repoRoot, 'show', `HEAD:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error || proc.status !== 0) return [];
  return proc.stdout.split('\n');
}

/**
 * The symlink target `relPath` has AS COMMITTED AT HEAD, or null when HEAD
 * has no symlink there.
 *
 * Deliberately not `fs.lstatSync`/`fs.readlinkSync`: everything else in this
 * scanner reads git objects, because git objects are what `git push` sends.
 * Reading the worktree let an uncommitted `rm`/replace of a committed unsafe
 * symlink turn the scan into a false all-clear on the exact hazard class the
 * check exists for.
 *
 * @returns {string|null}
 */
function headSymlinkTarget(repoRoot, relPath) {
  const ls = spawnSync('git', ['-C', repoRoot, 'ls-tree', '-z', 'HEAD', '--', relPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ls.error || ls.status !== 0) return null;
  const record = ls.stdout.split('\0')[0] || '';
  if (!record.startsWith('120000 ')) return null;

  const target = spawnSync('git', ['-C', repoRoot, 'cat-file', '-p', `HEAD:${relPath}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (target.error || target.status !== 0) return null;
  return target.stdout;
}

/**
 * @param {{repoRoot:string, base?:string, secretPatternsPath?:string,
 *   readFileLines?: (repoRoot:string, relPath:string) => string[],
 *   readSymlinkTarget?: (repoRoot:string, relPath:string) => (string|null)}} options
 * @returns {Array<{status:'fail'|'allow', file:string, line:number, category:string}>}
 */
function runPrepushScan(options) {
  const repoRoot = options.repoRoot;
  const base = options.base || 'main';
  const range = `${base}...HEAD`;
  const secretRules = loadSecretRules(options.secretPatternsPath || SECRET_PATTERNS_PATH);
  const readFileLines = options.readFileLines || headFileLines;
  const readSymlinkTarget = options.readSymlinkTarget || headSymlinkTarget;

  const findings = [];
  const fileLinesCache = new Map();
  const linesOf = file => {
    if (!fileLinesCache.has(file)) fileLinesCache.set(file, readFileLines(repoRoot, file));
    return fileLinesCache.get(file);
  };

  const diffText = runGit(repoRoot, ['diff', range, '--unified=0', '--no-color']);
  for (const { file, line, text } of parseAddedLines(diffText)) {
    const categories = scanLine(text, secretRules);
    if (categories.length === 0) continue;
    const allowed = allowedCategoriesAt(linesOf(file), line);
    for (const category of categories) {
      findings.push(result(allowed.has(category) ? 'allow' : 'fail', file, line, category));
    }
  }

  const nameStatusText = runGit(repoRoot, ['diff', '--name-status', range]);
  for (const relPath of parseTouchedFiles(nameStatusText)) {
    const target = readSymlinkTarget(repoRoot, relPath);
    if (target === null) continue; // not a symlink at HEAD — nothing to check

    const category = symlinkTargetIssue(relPath, target);
    if (category) findings.push(result('fail', relPath, 0, category));
  }

  // A text-extension file git classifies as BINARY emits no `+` hunks at
  // all, so it silently bypasses the whole added-line scan above. That is
  // how a stray NUL byte in a committed .js file once hid its own diff from
  // review — flag the classification itself, not the byte.
  const numstatText = runGit(repoRoot, ['diff', '--numstat', '-z', range]);
  for (const record of parseNumstat(numstatText)) {
    if (record.added !== '-' || record.deleted !== '-') continue;
    if (!hasTextExtension(record.path)) continue;
    if (!isBinaryAtHead(repoRoot, record.path)) continue; // this range REPAIRS it
    findings.push(result('fail', record.path, 0, 'binary-text'));
  }

  return findings;
}

function formatLine(f) {
  return `[${f.status}] ${f.file}:${f.line} ${f.category}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { json: false, base: 'main' };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--json':
        options.json = true;
        break;
      case '--repo-root':
        options.repoRoot = argv[++i];
        break;
      case '--base':
        options.base = argv[++i];
        break;
      default:
        break;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.repoRoot) {
    process.stderr.write('Usage: node prepush-scan.js --repo-root <path> [--base main] [--json]\n');
    process.exit(1);
  }

  let findings;
  try {
    findings = runPrepushScan(options);
  } catch (err) {
    process.stderr.write(`prepush-scan.js: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const fails = findings.filter(f => f.status === 'fail');
  const allows = findings.filter(f => f.status === 'allow');

  if (options.json) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else {
    for (const f of allows) process.stdout.write(`${formatLine(f)}\n`);
    for (const f of fails) process.stdout.write(`${formatLine(f)}\n`);
    if (fails.length === 0) {
      const suffix = allows.length > 0 ? ` (${allows.length} allowed)` : '';
      process.stdout.write(`[ok] no hits in diff ${options.base}...HEAD${suffix}\n`);
    }
  }

  process.exit(fails.length > 0 ? 1 : 0);
}

module.exports = {
  loadSecretRules,
  scanLine,
  isReservedEmail,
  parseAllowMarkers,
  allowedCategoriesAt,
  symlinkTargetIssue,
  parseAddedLines,
  parseTouchedFiles,
  parseNumstat,
  hasTextExtension,
  isBinaryAtHead,
  headSymlinkTarget,
  runPrepushScan,
  formatLine,
  parseArgs,
};

if (require.main === module) {
  main();
}
