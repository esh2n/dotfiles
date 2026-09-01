'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  run,
  CORRECTION_REGEXP,
  sanitizeSessionId
} = require('../prompt-correction-detect');

// One phrase per alternative in the JP+EN correction pattern (copied
// verbatim from the retired correction-detect.sh) — every phrase below must
// independently trip the detector.
const CORRECTION_PHRASES = [
  '違う',
  'ちがう',
  'そうじゃなくて',
  'じゃなくてこっち',
  'なんでそうしたの',
  'なんでこうしたの',
  'なんでこれにしたの',
  '間違ってる',
  'まちがってるよ',
  'やめてください',
  '戻してください',
  '直してください',
  '修正してください',
  'しないでください',
  'するなと言った',
  'ルールを守って',
  '指示したはずです',
  '言ったのに',
  '覚えておいて',
  'してほしかった',
  'this is wrong',
  'not what I meant',
  'why did you do that',
  'I said stop',
  'undo that change',
  'revert that commit',
  "don't do that again"
];

const NON_CORRECTION_PHRASES = [
  'looks good, thanks',
  'please add a test for the login page',
  'implement the retry logic next',
  'ship it',
  'ありがとうございます、完璧です'
];

test('regex: every correction phrase matches', () => {
  for (const phrase of CORRECTION_PHRASES) {
    assert.equal(CORRECTION_REGEXP.test(phrase), true, `expected match: ${phrase}`);
  }
});

for (const phrase of CORRECTION_PHRASES) {
  test(`regex phrase: "${phrase}"`, () => {
    assert.equal(CORRECTION_REGEXP.test(phrase), true);
  });
}

test('regex: ordinary prompts do not match', () => {
  for (const phrase of NON_CORRECTION_PHRASES) {
    assert.equal(CORRECTION_REGEXP.test(phrase), false, `unexpected match: ${phrase}`);
  }
});

test('sanitizeSessionId strips everything but [a-zA-Z0-9_-]', () => {
  assert.equal(sanitizeSessionId('abc 123!@#_-XYZ'), 'abc123_-XYZ');
  assert.equal(sanitizeSessionId(undefined), '');
});

// ---------------------------------------------------------------------------
// run() integration tests — everything below isolates CLAUDE_DIR to a fresh
// tmpdir per test so state files never touch the real ~/.claude tree, and
// restores every mutated env var afterward.
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'CLAUDE_DIR',
  'CLV2_HOMUNCULUS_DIR',
  'YOKI_HARNESS',
  'CORRECTION_DETECT_DISABLED',
  'CORRECTION_DETECT_DAILY_CAP',
  'CORRECTION_DISTILL',
  'YOKI_SKIP_DISTILL'
];

function withFixture(fn) {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-correction-detect-'));
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.CLAUDE_DIR = claudeDir;
  for (const key of ENV_KEYS) {
    if (key !== 'CLAUDE_DIR') delete process.env[key];
  }

  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(claudeDir, { recursive: true, force: true });
  };

  return Promise.resolve()
    .then(() => fn(claudeDir))
    .then(
      result => {
        restore();
        return result;
      },
      err => {
        restore();
        throw err;
      }
    );
}

function payload(overrides) {
  return JSON.stringify(
    Object.assign(
      {
        session_id: 'session-0001',
        hook_event_name: 'UserPromptSubmit',
        cwd: '/repo/project',
        prompt: 'looks good, ship it'
      },
      overrides
    )
  );
}

function correctionsFile(claudeDir) {
  return path.join(claudeDir, 'homunculus', 'corrections.jsonl');
}

function readJsonlRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function stateDirFor(claudeDir) {
  return path.join(claudeDir, '.cache', 'correction-detect');
}

test('run(): detects a correction and appends a jsonl row', () => {
  return withFixture(claudeDir => {
    const raw = payload({ session_id: 'session-aaaa', prompt: '違う、それじゃなくて別のやつ' });
    const result = run(raw);

    assert.equal(typeof result, 'string');
    const parsed = JSON.parse(result);
    assert.match(parsed.systemMessage, /learn|retrospective-codify/);

    const rows = readJsonlRows(correctionsFile(claudeDir));
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['correction', 'cwd', 'harness', 'session', 'ts']);
    assert.equal(rows[0].session, 'session-aaaa');
    assert.equal(rows[0].cwd, '/repo/project');
    assert.equal(rows[0].correction, '違う、それじゃなくて別のやつ');
    assert.equal(rows[0].harness, 'claude');
    assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    assert.equal(fs.existsSync(path.join(stateDirFor(claudeDir), 'session-aaaa.done')), true);
  });
});

test('run(): correction text is truncated to 500 chars', () => {
  return withFixture(claudeDir => {
    const longSuffix = 'a'.repeat(600);
    const raw = payload({ session_id: 'session-long1', prompt: `違う ${longSuffix}` });
    run(raw);

    const rows = readJsonlRows(correctionsFile(claudeDir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].correction.length, 500);
  });
});

test('run(): harness field reflects YOKI_HARNESS', () => {
  return withFixture(claudeDir => {
    process.env.YOKI_HARNESS = 'codex';
    run(payload({ session_id: 'session-cdx1', prompt: '間違ってるよ' }));

    const rows = readJsonlRows(correctionsFile(claudeDir));
    assert.equal(rows[0].harness, 'codex');
  });
});

test('run(): passthrough (no detection) for a non-correction prompt', () => {
  return withFixture(claudeDir => {
    const raw = payload({ session_id: 'session-plain', prompt: 'looks good, ship it' });
    const result = run(raw);

    assert.equal(result, raw);
    assert.equal(fs.existsSync(correctionsFile(claudeDir)), false);
  });
});

test('run(): passthrough for empty/whitespace prompt', () => {
  return withFixture(() => {
    const raw = payload({ session_id: 'session-empty', prompt: '   ' });
    assert.equal(run(raw), raw);
  });
});

test('run(): passthrough for malformed JSON input', () => {
  return withFixture(() => {
    const raw = '{not json';
    assert.equal(run(raw), raw);
  });
});

test('run(): passthrough for a non-UserPromptSubmit event', () => {
  return withFixture(() => {
    const raw = payload({ hook_event_name: 'PreToolUse', prompt: '違う' });
    assert.equal(run(raw), raw);
  });
});

test('run(): passthrough when session id is too short', () => {
  return withFixture(claudeDir => {
    const raw = payload({ session_id: 'short', prompt: '違う' });
    assert.equal(run(raw), raw);
    assert.equal(fs.existsSync(correctionsFile(claudeDir)), false);
  });
});

test('run(): CORRECTION_DETECT_DISABLED=1 short-circuits even a matching prompt', () => {
  return withFixture(claudeDir => {
    process.env.CORRECTION_DETECT_DISABLED = '1';
    const raw = payload({ session_id: 'session-disab', prompt: '違う' });
    assert.equal(run(raw), raw);
    assert.equal(fs.existsSync(correctionsFile(claudeDir)), false);
  });
});

test('run(): debounce — a second prompt in the same session is not re-detected', () => {
  return withFixture(claudeDir => {
    const sessionId = 'session-debnc';
    run(payload({ session_id: sessionId, prompt: '違う、一回目' }));
    const second = payload({ session_id: sessionId, prompt: '間違ってる、二回目' });
    const result = run(second);

    assert.equal(result, second);
    const rows = readJsonlRows(correctionsFile(claudeDir));
    assert.equal(rows.length, 1); // only the first detection was recorded
  });
});

test('run(): a legacy marker file (written by the retired .sh) still counts', () => {
  return withFixture(claudeDir => {
    const sessionId = 'legacy-session-id';
    const stateDir = stateDirFor(claudeDir);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `${sessionId}.done`), '');

    const raw = payload({ session_id: sessionId, prompt: '違う' });
    assert.equal(run(raw), raw);
    assert.equal(fs.existsSync(correctionsFile(claudeDir)), false);
  });
});

test('run(): CORRECTION_DETECT_DAILY_CAP bounds detections across sessions', () => {
  return withFixture(claudeDir => {
    process.env.CORRECTION_DETECT_DAILY_CAP = '2';

    run(payload({ session_id: 'session-cap-1', prompt: '違う 1' }));
    run(payload({ session_id: 'session-cap-2', prompt: '違う 2' }));
    const thirdRaw = payload({ session_id: 'session-cap-3', prompt: '違う 3' });
    const thirdResult = run(thirdRaw);

    assert.equal(thirdResult, thirdRaw); // cap reached: passthrough, not detected
    const rows = readJsonlRows(correctionsFile(claudeDir));
    assert.equal(rows.length, 2);
  });
});

test('run(): CLV2_HOMUNCULUS_DIR override redirects the corrections log', () => {
  return withFixture(claudeDir => {
    const altDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-correction-detect-alt-'));
    try {
      process.env.CLV2_HOMUNCULUS_DIR = altDir;
      run(payload({ session_id: 'session-alt01', prompt: '違う' }));

      assert.equal(fs.existsSync(correctionsFile(claudeDir)), false);
      assert.equal(fs.existsSync(path.join(altDir, 'corrections.jsonl')), true);
    } finally {
      fs.rmSync(altDir, { recursive: true, force: true });
    }
  });
});

test('run(): no distill spawn (no network) by default', () => {
  return withFixture(claudeDir => {
    run(payload({ session_id: 'session-nodis', prompt: '違う' }));
    // No CORRECTION_DISTILL=1, and no distill script installed in this
    // fixture: nothing beyond the jsonl row and marker should exist.
    assert.equal(fs.existsSync(path.join(claudeDir, 'homunculus', 'drafts')), false);
  });
});

test('run(): CORRECTION_DISTILL=1 with no distill script installed is a no-op', () => {
  return withFixture(claudeDir => {
    process.env.CORRECTION_DISTILL = '1';
    run(payload({ session_id: 'session-noscr', prompt: '違う' }));
    assert.equal(fs.existsSync(path.join(claudeDir, 'scripts', 'correction-distill.sh')), false);
    assert.equal(fs.existsSync(path.join(claudeDir, 'homunculus', 'drafts')), false);
  });
});

// Exercises the actual background spawn using a local stub in place of the
// real distiller (never invokes the network or a real `claude` process) —
// proves the opt-in path, the recursion-guard env, and the argv contract.
test('run(): CORRECTION_DISTILL=1 spawns the distill script with recursion-guard env', () => {
  return withFixture(async claudeDir => {
    const scriptsDir = path.join(claudeDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const sentinel = path.join(claudeDir, 'sentinel.txt');
    const distillScript = path.join(scriptsDir, 'correction-distill.sh');
    fs.writeFileSync(
      distillScript,
      ['#!/usr/bin/env bash', `printf 'args=%s CLAUDECODE=%s YOKI_SKIP_DISTILL=%s\\n' "$*" "$CLAUDECODE" "$YOKI_SKIP_DISTILL" > "${sentinel}"`, ''].join(
        '\n'
      )
    );
    fs.chmodSync(distillScript, 0o755);

    process.env.CORRECTION_DISTILL = '1';
    run(
      payload({
        session_id: 'session-spawn1',
        prompt: '違う',
        transcript_path: '/tmp/does-not-matter.jsonl'
      })
    );

    const deadline = Date.now() + 2000;
    while (!fs.existsSync(sentinel) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    assert.equal(fs.existsSync(sentinel), true, 'distill stub never ran');
    const content = fs.readFileSync(sentinel, 'utf8');
    assert.match(content, /session-spawn1/);
    assert.match(content, /CLAUDECODE=\s/); // emptied for the child
    assert.match(content, /YOKI_SKIP_DISTILL=1/);
  });
});

test('run(): YOKI_SKIP_DISTILL recursion guard prevents spawning even when opted in', () => {
  return withFixture(async claudeDir => {
    const scriptsDir = path.join(claudeDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const sentinel = path.join(claudeDir, 'sentinel.txt');
    const distillScript = path.join(scriptsDir, 'correction-distill.sh');
    fs.writeFileSync(distillScript, ['#!/usr/bin/env bash', `touch "${sentinel}"`, ''].join('\n'));
    fs.chmodSync(distillScript, 0o755);

    process.env.CORRECTION_DISTILL = '1';
    process.env.YOKI_SKIP_DISTILL = '1';
    run(payload({ session_id: 'session-guard1', prompt: '違う' }));

    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(fs.existsSync(sentinel), false);
  });
});
