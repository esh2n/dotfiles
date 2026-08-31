'use strict';

/**
 * Converts `agents/*.md` (Claude subagent frontmatter: name, description,
 * model, tools) into Codex `agents/<name>.toml` files.
 *
 * Codex has no per-tool allow list for an agent, so `tools:` is folded into
 * `developer_instructions` as a plain sentence instead of being dropped
 * silently. `model:` (a Claude tier — haiku/sonnet/opus) is translated via
 * `core/harness-models.json`; an unrecognized or missing tier is left out
 * of the TOML rather than guessed at, so Codex falls back to its own default.
 */

const { parseFrontmatter } = require('./frontmatter');

function toTomlString(value) {
  return JSON.stringify(String(value));
}

function toolsSentence(tools) {
  const list = Array.isArray(tools) ? tools : (typeof tools === 'string' ? [tools] : []);
  if (list.length === 0) return '';
  return `\n\nTools available to you: ${list.join(', ')}.`;
}

/**
 * @param {string} name agent basename (frontmatter `name` or the filename)
 * @param {string} markdown raw agents/*.md content
 * @param {Record<string,string>} modelMap core/harness-models.json's `codex` tier map
 * @returns {string} the `<name>.toml` file content
 */
function agentMarkdownToToml(name, markdown, modelMap) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const agentName = typeof frontmatter.name === 'string' && frontmatter.name ? frontmatter.name : name;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const developerInstructions = `${body.trim()}${toolsSentence(frontmatter.tools)}`;

  const lines = [`name = ${toTomlString(agentName)}`, `description = ${toTomlString(description)}`];

  const tier = typeof frontmatter.model === 'string' ? frontmatter.model.trim().toLowerCase() : '';
  if (tier && modelMap && modelMap[tier]) {
    lines.push(`model = ${toTomlString(modelMap[tier])}`);
  }

  lines.push(`developer_instructions = ${toTomlString(developerInstructions)}`);

  return `${lines.join('\n')}\n`;
}

module.exports = { agentMarkdownToToml };
