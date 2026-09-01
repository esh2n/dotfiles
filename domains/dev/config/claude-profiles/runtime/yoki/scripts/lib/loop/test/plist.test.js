'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const plist = require('../plist');

test('parseInterval: supports s/m/h/d suffixes', () => {
  assert.equal(plist.parseInterval('45s'), 45);
  assert.equal(plist.parseInterval('30m'), 1800);
  assert.equal(plist.parseInterval('1h'), 3600);
  assert.equal(plist.parseInterval('2d'), 172800);
});

test('parseInterval: rejects garbage', () => {
  assert.throws(() => plist.parseInterval('soon'), /invalid --every/);
  assert.throws(() => plist.parseInterval('1h30m'), /invalid --every/);
  assert.throws(() => plist.parseInterval(''), /invalid --every/);
});

test('label: dev.yoki.loop.<name>', () => {
  assert.equal(plist.label('demo'), 'dev.yoki.loop.demo');
});

test('plistPath: under ~/Library/LaunchAgents', () => {
  assert.equal(
    plist.plistPath('demo', '/Users/u'),
    path.join('/Users/u', 'Library', 'LaunchAgents', 'dev.yoki.loop.demo.plist')
  );
});

test('buildPlistXml: golden document for a simple loop', () => {
  const xml = plist.buildPlistXml({
    name: 'demo',
    programArguments: ['/usr/local/bin/node', '/repo/domains/dev/bin/yoki-loop', 'run', 'demo', '--harness', 'codex'],
    intervalSeconds: 1800,
    stdoutPath: '/home/u/.local/state/yoki/loop/demo/stdout.log',
    stderrPath: '/home/u/.local/state/yoki/loop/demo/stderr.log',
    env: { PATH: '/usr/bin:/bin', HOME: '/home/u' },
  });

  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.yoki.loop.demo</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/repo/domains/dev/bin/yoki-loop</string>
        <string>run</string>
        <string>demo</string>
        <string>--harness</string>
        <string>codex</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>/home/u/.local/state/yoki/loop/demo/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/home/u/.local/state/yoki/loop/demo/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/home/u</string>
    </dict>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`
  );
});

test('buildPlistXml: escapes XML-special characters in string values', () => {
  const xml = plist.buildPlistXml({
    name: 'demo',
    programArguments: ['node', 'yoki-loop', 'run', 'demo', '--prompt', 'fix <bug> & "quote" \'it\''],
    intervalSeconds: 60,
    stdoutPath: '/x',
    stderrPath: '/y',
    env: {},
  });
  assert.match(xml, /fix &lt;bug&gt; &amp; &quot;quote&quot; &apos;it&apos;/);
  assert.doesNotMatch(xml, /<string>fix <bug>/);
});

test('readStartIntervalSeconds: extracts the integer back out of a plist document', () => {
  const xml = plist.buildPlistXml({
    name: 'demo',
    programArguments: ['node'],
    intervalSeconds: 3600,
    stdoutPath: '/x',
    stderrPath: '/y',
    env: {},
  });
  assert.equal(plist.readStartIntervalSeconds(xml), 3600);
});

test('readStartIntervalSeconds: null for text with no StartInterval', () => {
  assert.equal(plist.readStartIntervalSeconds('<plist></plist>'), null);
});

test('bootstrapCommand / bootoutCommand: literal launchctl invocations, never run here', () => {
  assert.equal(plist.bootstrapCommand(501, '/x/dev.yoki.loop.demo.plist'), 'launchctl bootstrap gui/501 /x/dev.yoki.loop.demo.plist');
  assert.equal(plist.bootoutCommand(501, '/x/dev.yoki.loop.demo.plist'), 'launchctl bootout gui/501 /x/dev.yoki.loop.demo.plist');
});
