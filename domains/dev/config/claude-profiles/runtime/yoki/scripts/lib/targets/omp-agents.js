'use strict';

/**
 * Converts `agents/*.md` (Claude subagent frontmatter: name, description,
 * model, tools) into omp `agents/<name>.md` — unlike Codex (TOML,
 * codex-agents.js), omp's own agent-file format is the same
 * frontmatter+body markdown shape Claude uses (spike S4-S5 (a): `agents/
 * *.md`), so the body is copied through verbatim as the system prompt and
 * only the frontmatter needs translating.
 */

const { parseFrontmatter } = require('./frontmatter');
const { translateToolsList } = require('./omp-tool-names');

function yamlString(value) {
  return JSON.stringify(String(value));
}

/**
 * @param {string} name agent basename (frontmatter `name` or the filename)
 * @param {string} markdown raw agents/*.md content
 * @param {Record<string,string>} modelMap core/harness-models.json's `omp` tier map
 * @returns {string} the `<name>.md` file content
 */
function agentMarkdownToOmp(name, markdown, modelMap) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const agentName = typeof frontmatter.name === 'string' && frontmatter.name ? frontmatter.name : name;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';

  const fmLines = ['---', `name: ${agentName}`, `description: ${yamlString(description)}`];

  const tier = typeof frontmatter.model === 'string' ? frontmatter.model.trim().toLowerCase() : '';
  if (tier && modelMap && modelMap[tier]) {
    fmLines.push(`model: ${modelMap[tier]}`);
  }

  const tools = translateToolsList(frontmatter.tools);
  if (tools) {
    fmLines.push(`tools: [${tools.join(', ')}]`);
  }

  fmLines.push('---', '');
  return `${fmLines.join('\n')}${body}`;
}

module.exports = { agentMarkdownToOmp };
