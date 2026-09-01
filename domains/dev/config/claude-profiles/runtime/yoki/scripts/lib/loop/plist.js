'use strict';

/**
 * launchd plist generation for `yoki-loop install` (task T19).
 *
 * `install` only ever writes the plist and prints the `launchctl bootstrap`
 * command — it never runs launchctl itself (same "never mutates the running
 * system" posture the harness's own doctor/apply split follows elsewhere).
 */

const path = require('path');

const LABEL_PREFIX = 'dev.yoki.loop.';

function label(name) {
  return `${LABEL_PREFIX}${name}`;
}

function plistPath(name, homeDir) {
  return path.join(homeDir, 'Library', 'LaunchAgents', `${label(name)}.plist`);
}

/**
 * `30m` / `1h` / `2d` / `45s` -> seconds. A single `<number><unit>` token —
 * the spec's own examples (`30m|1h|…`) never compose units, so composing
 * isn't supported.
 */
function parseInterval(spec) {
  const match = /^(\d+)(s|m|h|d)$/.exec(String(spec || '').trim());
  if (!match) {
    throw new Error(`yoki-loop: invalid --every "${spec}" (expected e.g. 30m, 1h, 2d, 45s)`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const secondsPerUnit = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * secondsPerUnit[unit];
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stringArrayXml(values) {
  return values.map((v) => `        <string>${xmlEscape(v)}</string>`).join('\n');
}

function envDictXml(envVars) {
  const keys = Object.keys(envVars);
  if (keys.length === 0) return '';
  const entries = keys
    .map((key) => `        <key>${xmlEscape(key)}</key>\n        <string>${xmlEscape(envVars[key])}</string>`)
    .join('\n');
  return `    <key>EnvironmentVariables</key>\n    <dict>\n${entries}\n    </dict>\n`;
}

/**
 * @param {object} opts
 * @param {string} opts.name loop name
 * @param {string[]} opts.programArguments full argv, argv[0] the executable
 * @param {number} opts.intervalSeconds `StartInterval`
 * @param {string} opts.stdoutPath
 * @param {string} opts.stderrPath
 * @param {{PATH: string, HOME: string, YOKI_UNATTENDED?: string}} opts.env
 *   `EnvironmentVariables` — cli.js always includes `YOKI_UNATTENDED=1`, see
 *   its comment at the buildPlistXml call site.
 * @returns {string} the complete plist XML document
 */
function buildPlistXml({ name, programArguments, intervalSeconds, stdoutPath, stderrPath, env }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(label(name))}</string>
    <key>ProgramArguments</key>
    <array>
${stringArrayXml(programArguments)}
    </array>
    <key>StartInterval</key>
    <integer>${intervalSeconds}</integer>
    <key>StandardOutPath</key>
    <string>${xmlEscape(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(stderrPath)}</string>
${envDictXml(env || {})}    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`;
}

/** Naive `<key>StartInterval</key>\n<integer>N</integer>` extraction — good
 *  enough for `status`'s "next fire time" estimate, since this runner is
 *  also the only writer of the file it reads back. */
function readStartIntervalSeconds(xmlText) {
  const match = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(String(xmlText || ''));
  return match ? Number(match[1]) : null;
}

function bootstrapCommand(uid, plistFilePath) {
  return `launchctl bootstrap gui/${uid} ${plistFilePath}`;
}

function bootoutCommand(uid, plistFilePath) {
  return `launchctl bootout gui/${uid} ${plistFilePath}`;
}

module.exports = {
  label,
  plistPath,
  parseInterval,
  buildPlistXml,
  readStartIntervalSeconds,
  bootstrapCommand,
  bootoutCommand,
};
