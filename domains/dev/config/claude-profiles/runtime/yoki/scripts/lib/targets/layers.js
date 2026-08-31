'use strict';

/**
 * Filesystem discovery over one `claude-profiles` layer root (`core/`, a
 * `packs/<name>/`, or `personal/`) — the shared shape every per-target
 * generator (codex.js, and eventually omp.js) walks. No merge/precedence
 * logic here; callers combine layers in the order `--sources` gave them
 * (core, then packs, then personal — same order yoki-switch composes).
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILENAMES = ['settings.layer.json', 'settings.personal.json', 'settings.json'];
const CLAUDE_MD_FILENAMES = ['CLAUDE.layer.md', 'CLAUDE.personal.md'];

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`${filePath}: ${err.message}`);
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** First existing settings file in a layer root, or null. */
function findSettingsFile(layerRoot) {
  for (const name of SETTINGS_FILENAMES) {
    const candidate = path.join(layerRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** `CLAUDE.layer.md` / `CLAUDE.personal.md` in a layer root, or null. */
function findClaudeMdFile(layerRoot) {
  for (const name of CLAUDE_MD_FILENAMES) {
    const candidate = path.join(layerRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** All `*.md` files under `dir`, recursively, as paths relative to `dir`
 * (posix separators normalized to the platform's `path.sep` for joining,
 * but `relPath` itself always uses `/`). Missing `dir` yields `[]`. */
function listMarkdownFilesRecursive(dir) {
  const results = [];
  function walk(current, relPrefix) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({ relPath: rel, absPath: abs });
      }
    }
  }
  walk(dir, '');
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Immediate `*.md` files directly inside `dir` (non-recursive — used for
 * `agents/*.md`, which the spec does not nest). */
function listMarkdownFilesFlat(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => ({ relPath: e.name, absPath: path.join(dir, e.name) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Immediate subdirectories of `skills/` — one per skill. */
function listSkillDirs(layerRoot) {
  const skillsDir = path.join(layerRoot, 'skills');
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, absPath: path.join(skillsDir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  readJsonIfExists,
  readTextIfExists,
  findSettingsFile,
  findClaudeMdFile,
  listMarkdownFilesRecursive,
  listMarkdownFilesFlat,
  listSkillDirs,
};
