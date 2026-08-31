'use strict';

/**
 * Skill port decisions and commands→skills conversion for the Codex target.
 *
 * Skills: migrates `link_codex_ports` (domains/dev/bin/yoki-switch) — a
 * skill that ships a `codex/SKILL.md` port gets its `codex/` directory
 * symlinked into `~/.codex/skills/<name>` (Codex follows a symlinked skill
 * dir, so edits to the port stay live); every other skill is symlinked into
 * `~/.agents/skills/<name>`, the cross-harness skills convention Codex (and
 * other `@mention`/AGENTS.md-family tools) also reads. Never both for the
 * same skill.
 *
 * Commands: Codex has no slash-command file format of its own (Codex 0.117+
 * removed custom prompts in favor of skills — see yoki-switch's
 * link_codex_ports comment), so every `commands/**\/*.md` becomes a
 * `cmd-<name>` skill. Codex reads `$ARGUMENTS` the same way Claude does, so
 * the body is copied verbatim.
 */

const path = require('path');
const { parseFrontmatter, firstHeading } = require('./frontmatter');

/**
 * @param {string} skillDir absolute path of a `skills/<name>` directory
 * @param {boolean} hasCodexPort whether `<skillDir>/codex/SKILL.md` exists
 * @param {string} name skill name (directory basename)
 * @param {string} out `~/.codex`
 * @param {string} home user home directory
 * @returns {{kind: 'symlink', destinationPath: string, sourcePath: string, layer: string}}
 */
function decideSkillSymlink({ skillDir, hasCodexPort, name, out, home, layer }) {
  if (hasCodexPort) {
    return {
      kind: 'symlink',
      destinationPath: path.join(out, 'skills', name),
      sourcePath: path.join(skillDir, 'codex'),
      layer,
    };
  }
  return {
    kind: 'symlink',
    destinationPath: path.join(home, '.agents', 'skills', name),
    sourcePath: skillDir,
    layer,
  };
}

/** `commands/prompts/explain.md` -> `prompts-explain` — path segments
 * joined with `-` so nested commands never collide with a top-level one of
 * the same basename. */
function commandNameFromRelPath(relPath) {
  const withoutExt = relPath.replace(/\.md$/i, '');
  return withoutExt.split(path.sep).join('-');
}

/**
 * @param {string} relPath command path relative to its layer's `commands/` root
 * @param {string} markdown raw command markdown
 * @returns {{name: string, skillMarkdown: string}}
 */
function commandToSkill(relPath, markdown) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const name = commandNameFromRelPath(relPath);
  const skillName = `cmd-${name}`;
  const description = typeof frontmatter.description === 'string' && frontmatter.description
    ? frontmatter.description
    : firstHeading(body) || skillName;

  const fmLines = ['---', `name: ${skillName}`, `description: ${description}`];
  if (typeof frontmatter['argument-hint'] === 'string' && frontmatter['argument-hint']) {
    fmLines.push(`argument-hint: ${frontmatter['argument-hint']}`);
  }
  fmLines.push('---', '');

  return { name: skillName, skillMarkdown: `${fmLines.join('\n')}${body}` };
}

module.exports = { decideSkillSymlink, commandNameFromRelPath, commandToSkill };
