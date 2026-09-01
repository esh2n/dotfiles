// yoki-artifact CLI tests.
//
// Every case runs the real `bin/yoki-artifact` launcher as a child process, so
// what is under test is the whole path a caller actually takes: sh launcher ->
// entrypoint guard -> dispatch -> exit code. The API is a local http server on
// 127.0.0.1 (test/fixtures/api-server.mjs); nothing here touches the network,
// the user's ~/.config, or a real Cloudflare deployment.
//
// The child process must be spawned asynchronously, never with spawnSync: the
// fake API lives in this same process, and a synchronous child would block the
// event loop that has to answer its requests.
//
// Fixture credentials are assembled at runtime from harmless fragments rather
// than written out as literals, so this repository never contains a string
// shaped like a real key — including in the file that tests the key scanner.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { CLIENT_ID, CLIENT_SECRET, makeComment, startApiServer } from "./fixtures/api-server.mjs";
import { tokenizeCommand } from "../bin/lib/tokenize.mjs";
import { scanExternalRefs, scanSecrets } from "../bin/lib/scan.mjs";
import { nodeVersionOk } from "../bin/lib/node-version.mjs";
import { FALLBACK_HINTS, HINT_LINE_LIMIT, setupHints } from "../bin/lib/cmd-doctor.mjs";
import { openUrl } from "../bin/lib/open-url.mjs";
import { cmdWatch, isFatalWatchError } from "../bin/lib/cmd-watch.mjs";
import { networkError } from "../bin/lib/errors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(HERE, "..", "bin", "yoki-artifact");

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>demo</title></head>
<body><h1>hello</h1></body></html>
`;

// Obviously synthetic: "sk-" plus a run of FAKE. Matches sk-[A-Za-z0-9]{20,}.
const FAKE_API_KEY = `sk-${"FAKE".repeat(8)}`;
const WATCH_CHANNEL = "demo-watch";

let home;
let server;

function env(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    // Point the writeup-kit hook at a path that does not exist, so a real
    // installation on the developer's machine cannot influence the tests.
    YOKI_ARTIFACT_SELF_CHECK: path.join(home, "no-such-self-check.mjs"),
    ...extra,
  };
}

function credentials(extra = {}) {
  return env({
    YOKI_ARTIFACT_URL: server.baseUrl,
    YOKI_ARTIFACT_CLIENT_ID: CLIENT_ID,
    YOKI_ARTIFACT_CLIENT_SECRET: CLIENT_SECRET,
    ...extra,
  });
}

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(LAUNCHER, args, {
      env: options.env ?? credentials(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function writePage(name, body) {
  const file = path.join(home, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function writeConfig(contents) {
  const file = path.join(home, ".config", "yoki-artifact", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contents, null, 2), "utf8");
  return file;
}

before(async () => {
  // The `comments` suite mutates its rows (resolve/seen), so `watch` gets its
  // own channel: one unseen agent comment, one already picked up, one written
  // to a human. Sharing rows would make the watch assertions depend on the
  // order the suites happen to run in.
  server = await startApiServer({
    comments: [
      makeComment({ id: "c-new", body: "the chart is unreadable" }),
      makeComment({ id: "c-seen", agent_seen_at: "2026-08-30T11:00:00.000Z" }),
      makeComment({ id: "c-human", to_agent: false }),
      makeComment({ id: "w-new", channel: WATCH_CHANNEL, body: "the legend overlaps" }),
      makeComment({ id: "w-seen", channel: WATCH_CHANNEL, agent_seen_at: "2026-08-30T11:00:00.000Z" }),
      makeComment({ id: "w-human", channel: WATCH_CHANNEL, to_agent: false }),
    ],
  });
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "yoki-artifact-test-"));
});

describe("usage", () => {
  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["--help"], { env: env() });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^yoki-artifact — publish and manage yoki artifacts\./);
    assert.match(result.stdout, /yoki-artifact publish <file\.html> --channel <c>/);
    assert.match(result.stdout, /0 ok {3}1 usage {3}2 network\/auth {3}3 external refs/);
  });

  test("no command exits 1", async () => {
    const result = await runCli([], { env: env() });
    assert.equal(result.code, 1);
  });

  test("an unknown command exits 1 without calling the API", async () => {
    const before = server.requests.length;
    const result = await runCli(["frobnicate"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unknown command "frobnicate"/);
    assert.equal(server.requests.length, before);
  });

  test("an unknown flag exits 1", async () => {
    const result = await runCli(["list", "--allow-externals"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unknown option "--allow-externals"/);
  });
});

describe("publish", () => {
  test("happy path: uploads, sends the Access headers, prints the viewer URL", async () => {
    const file = writePage("page.html", PAGE);
    const result = await runCli(["publish", file, "--channel", "demo-happy", "--title", "Demo ページ"]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published version 1/);
    assert.ok(result.stdout.includes(`${server.baseUrl}/a/demo-happy`), result.stdout);

    const put = server.requests.findLast((entry) => entry.method === "PUT");
    assert.equal(put.path, "/api/artifacts/demo-happy");
    assert.equal(put.headers["cf-access-client-id"], CLIENT_ID);
    assert.equal(put.headers["cf-access-client-secret"], CLIENT_SECRET);
    assert.match(put.headers["content-type"], /^text\/html/);
    // Non-ASCII header text is percent-encoded for the latin-1 wire format.
    assert.equal(decodeURIComponent(put.headers["x-yoki-title"]), "Demo ページ");
  });

  test("--json prints one JSON object and nothing else", async () => {
    const file = writePage("page.html", PAGE);
    const result = await runCli(["publish", file, "--channel", "demo-json", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.channel, "demo-json");
    assert.equal(payload.version, 1);
    assert.equal(payload.unchanged, false);
    assert.equal(payload.url, `${server.baseUrl}/a/demo-json`);
  });

  test("republishing identical bytes reports the deduped version", async () => {
    const file = writePage("page.html", PAGE);
    const first = await runCli(["publish", file, "--channel", "demo-dedupe", "--json"]);
    const second = await runCli(["publish", file, "--channel", "demo-dedupe", "--json"]);

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    const payload = JSON.parse(second.stdout);
    assert.equal(payload.unchanged, true);
    assert.equal(payload.version, JSON.parse(first.stdout).version);

    const text = await runCli(["publish", file, "--channel", "demo-dedupe"]);
    assert.match(text.stdout, /unchanged — already published as version 1/);
  });

  test("a missing file exits 1 before any request", async () => {
    const before = server.requests.length;
    const result = await runCli(["publish", path.join(home, "nope.html"), "--channel", "demo"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No such file/);
    assert.equal(server.requests.length, before);
  });

  test("a non-HTML file exits 1", async () => {
    const file = path.join(home, "notes.txt");
    fs.writeFileSync(file, PAGE, "utf8");
    const result = await runCli(["publish", file, "--channel", "demo"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is not an HTML file/);
  });

  test("a bad channel exits 1", async () => {
    const file = writePage("page.html", PAGE);
    const result = await runCli(["publish", file, "--channel", "Not A Channel"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--channel must be 2-63 characters/);
  });

  test("over 16 MiB exits 5 before any request", async () => {
    const file = path.join(home, "huge.html");
    fs.writeFileSync(file, "x".repeat(16 * 1024 * 1024 + 1), "utf8");
    const before = server.requests.length;
    const result = await runCli(["publish", file, "--channel", "demo"]);
    assert.equal(result.code, 5);
    assert.match(result.stderr, /the limit is 16 MiB/);
    assert.equal(server.requests.length, before);
  });
});

describe("publish safety gates", () => {
  test("a credential-looking string exits 4 and uploads nothing", async () => {
    const file = writePage("leaky.html", PAGE.replace("<h1>hello</h1>", `<code>${FAKE_API_KEY}</code>`));
    const before = server.requests.length;
    const result = await runCli(["publish", file, "--channel", "demo-secret"]);

    assert.equal(result.code, 4);
    assert.match(result.stderr, /looks like it contains a credential/);
    assert.match(result.stderr, /OpenAI-style API key/);
    assert.equal(server.requests.length, before, "nothing may be sent once a secret is found");
    // The refusal names the pattern and the line, never the matched value.
    assert.ok(!result.stderr.includes(FAKE_API_KEY), "the refusal must not echo the secret");
  });

  test("--allow-external does not downgrade the secret gate", async () => {
    const file = writePage("leaky.html", PAGE.replace("<h1>hello</h1>", `<code>${FAKE_API_KEY}</code>`));
    const result = await runCli(["publish", file, "--channel", "demo-secret", "--allow-external"]);
    assert.equal(result.code, 4);
  });

  test("a private key block exits 4", async () => {
    const block = `-----BEGIN ${"OPENSSH "}PRIVATE KEY-----`;
    const file = writePage("key.html", PAGE.replace("<h1>hello</h1>", `<pre>${block}</pre>`));
    const result = await runCli(["publish", file, "--channel", "demo-secret"]);
    assert.equal(result.code, 4);
    assert.match(result.stderr, /private key block/);
  });

  test("a password in a query string exits 4", async () => {
    const file = writePage("qs.html", PAGE.replace("<h1>hello</h1>", '<a href="/x?password=hunter2">x</a>'));
    const result = await runCli(["publish", file, "--channel", "demo-secret"]);
    assert.equal(result.code, 4);
    assert.match(result.stderr, /credential in a query string/);
  });

  test("an off-allowlist reference exits 3 and uploads nothing", async () => {
    const file = writePage(
      "external.html",
      PAGE.replace("<h1>hello</h1>", '<script src="https://unpkg.com/thing@1/dist/thing.js"></script>'),
    );
    const before = server.requests.length;
    const result = await runCli(["publish", file, "--channel", "demo-external"]);

    assert.equal(result.code, 3);
    assert.match(result.stderr, /outside the artifact CSP allowlist/);
    assert.match(result.stderr, /unpkg\.com/);
    assert.equal(server.requests.length, before);
  });

  test("--allow-external downgrades that to a warning and publishes", async () => {
    const file = writePage(
      "external.html",
      PAGE.replace("<h1>hello</h1>", '<script src="https://unpkg.com/thing@1/dist/thing.js"></script>'),
    );
    const result = await runCli(["publish", file, "--channel", "demo-external", "--allow-external"]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /warning: external references will be blocked/);
    assert.match(result.stdout, /published version 1/);
  });

  test("allowlisted CDNs publish without --allow-external", async () => {
    const allowed = [
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/thing@1/dist/thing.js"></script>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
    ].join("\n");
    const file = writePage("cdn.html", PAGE.replace("<h1>hello</h1>", allowed));
    const result = await runCli(["publish", file, "--channel", "demo-cdn"]);
    assert.equal(result.code, 0, result.stderr);
  });

  test("jsdelivr outside /npm/ is still refused", async () => {
    const file = writePage("gh.html", PAGE.replace("<h1>hello</h1>", '<script src="https://cdn.jsdelivr.net/gh/u/r/x.js"></script>'));
    const result = await runCli(["publish", file, "--channel", "demo-external"]);
    assert.equal(result.code, 3);
  });
});

describe("writeup-kit self-check", () => {
  // A stub standing in for ~/.claude/skills/writeup-kit/bin/self-check.mjs:
  // same contract (argv[2] is the page, exit 0 means clean), no writeup-kit
  // installation required to run these tests.
  function stubSelfCheck(exitCode) {
    const script = path.join(home, `self-check-${exitCode}.mjs`);
    fs.writeFileSync(
      script,
      `process.stdout.write("stub self-check: " + process.argv[2] + "\\n");\nprocess.exit(${exitCode});\n`,
      "utf8",
    );
    return script;
  }

  const kitPage = PAGE.replace("<h1>hello</h1>", '<section class="wu-prose"><h1>hello</h1></section>');

  test("a writeup-kit page that passes self-check is published", async () => {
    const file = writePage("kit.html", kitPage);
    const result = await runCli(["publish", file, "--channel", "demo-kit"], {
      env: credentials({ YOKI_ARTIFACT_SELF_CHECK: stubSelfCheck(0) }),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /published version 1/);
  });

  test("a failing self-check blocks the publish", async () => {
    const file = writePage("kit.html", kitPage);
    const before = server.requests.length;
    const result = await runCli(["publish", file, "--channel", "demo-kit-bad"], {
      env: credentials({ YOKI_ARTIFACT_SELF_CHECK: stubSelfCheck(1) }),
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /writeup-kit self-check failed \(exit 1\)/);
    assert.equal(server.requests.length, before, "a page that fails self-check must not be uploaded");
  });

  test("a page that is not writeup-kit skips self-check entirely", async () => {
    const file = writePage("plain.html", PAGE);
    const result = await runCli(["publish", file, "--channel", "demo-plain"], {
      env: credentials({ YOKI_ARTIFACT_SELF_CHECK: stubSelfCheck(1) }),
    });
    assert.equal(result.code, 0, result.stderr);
  });

  test("self-check is skipped when writeup-kit is not installed", async () => {
    const file = writePage("kit.html", kitPage);
    const result = await runCli(["publish", file, "--channel", "demo-kit-absent"], {
      env: credentials({ YOKI_ARTIFACT_SELF_CHECK: path.join(home, "absent.mjs") }),
    });
    assert.equal(result.code, 0, result.stderr);
  });
});

describe("scan (unit)", () => {
  test("reports the line and the rule, never the match", () => {
    const findings = scanSecrets(`line one\nline two ${FAKE_API_KEY}\n`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "openai-key");
    assert.equal(findings[0].line, 2);
    assert.ok(!JSON.stringify(findings).includes(FAKE_API_KEY));
  });

  test("a clean page has no findings", () => {
    assert.deepEqual(scanSecrets(PAGE), []);
    assert.deepEqual(scanExternalRefs(PAGE), []);
  });

  test("relative and data: references are not external", () => {
    const html = '<img src="./a.png"><img src="data:image/png;base64,AAAA"><a href="#x">x</a>';
    assert.deepEqual(scanExternalRefs(html), []);
  });
});

describe("config and env precedence", () => {
  test("the environment wins over the config file", async () => {
    writeConfig({ baseUrl: "https://wrong.invalid", clientId: "wrong-client-id" });
    const result = await runCli(["list", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });

  test("the config file is used when the environment is silent", async () => {
    writeConfig({ baseUrl: server.baseUrl, clientId: CLIENT_ID });
    const result = await runCli(["list", "--json"], {
      env: env({ YOKI_ARTIFACT_CLIENT_SECRET: CLIENT_SECRET }),
    });
    assert.equal(result.code, 0, result.stderr);
  });

  test("a trailing slash in baseUrl does not produce a doubled path", async () => {
    writeConfig({ baseUrl: `${server.baseUrl}/`, clientId: CLIENT_ID });
    const result = await runCli(["list"], { env: env({ YOKI_ARTIFACT_CLIENT_SECRET: CLIENT_SECRET }) });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.requests.at(-1).path, "/api/artifacts");
  });

  test("no configuration at all exits 1 and names the file", async () => {
    const result = await runCli(["list"], { env: env() });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No base URL/);
    assert.match(result.stderr, /config\.json/);
  });

  test("a wrong secret is an auth failure, exit 2", async () => {
    const result = await runCli(["list"], { env: credentials({ YOKI_ARTIFACT_CLIENT_SECRET: "nope" }) });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Access rejected the request \(403\)/);
  });

  test("an unreachable base URL is exit 2", async () => {
    const result = await runCli(["list"], { env: credentials({ YOKI_ARTIFACT_URL: "http://127.0.0.1:1" }) });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Cannot reach/);
  });

  // Every request to the base URL carries the Access service-token pair, and
  // that token is a full owner credential on the Worker. Over plain http it
  // travels in the clear, so a non-loopback http URL is refused before any
  // request is built.
  test("a plain-http base URL is refused before anything is sent", async () => {
    const before = server.requests.length;
    const result = await runCli(["list"], { env: credentials({ YOKI_ARTIFACT_URL: "http://artifacts.example.test" }) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be an https URL/);
    assert.equal(server.requests.length, before, "nothing may reach the network");
  });

  test("a plain-http base URL in the config file is refused the same way", async () => {
    writeConfig({ baseUrl: "http://artifacts.example.test", clientId: CLIENT_ID });
    const result = await runCli(["list"], { env: env({ YOKI_ARTIFACT_CLIENT_SECRET: CLIENT_SECRET }) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be an https URL/);
  });

  test("http on loopback is still allowed, for wrangler dev", async () => {
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:/, "the fixture server is the loopback case");
    const result = await runCli(["list", "--json"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

describe("secretCommand", () => {
  test("tokenizer splits argv the way a shell would, without a shell", () => {
    assert.deepEqual(tokenizeCommand("op read op://Private/yoki-artifact/credential"), [
      "op",
      "read",
      "op://Private/yoki-artifact/credential",
    ]);
    assert.deepEqual(tokenizeCommand('  security  find-generic-password  -w  '), [
      "security",
      "find-generic-password",
      "-w",
    ]);
    assert.deepEqual(tokenizeCommand('op read "op://Private/my item/credential"'), [
      "op",
      "read",
      "op://Private/my item/credential",
    ]);
    assert.deepEqual(tokenizeCommand("echo 'single quoted value'"), ["echo", "single quoted value"]);
    assert.deepEqual(tokenizeCommand("echo a\\ b"), ["echo", "a b"]);
    assert.deepEqual(tokenizeCommand('echo ""'), ["echo", ""]);
    assert.deepEqual(tokenizeCommand(""), []);
  });

  test("an unterminated quote is rejected rather than guessed at", () => {
    assert.throws(() => tokenizeCommand('op read "op://Private/x'), /unterminated " quote/);
    assert.throws(() => tokenizeCommand("op read x\\"), /dangling backslash/);
  });

  test("the secret is read from the configured command, quoting included", async () => {
    // A path with a space proves the tokenizer's quote handling end to end.
    // The script is run through /bin/sh on purpose: exec-ing a freshly created
    // executable trips macOS's first-launch assessment, which can stall for
    // minutes inside sandboxed shells and blow the secretCommand timeout.
    const dir = path.join(home, "secret bin");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, "print-secret.sh");
    fs.writeFileSync(script, `printf '%s\\n' "$1"\n`, "utf8");
    writeConfig({
      baseUrl: server.baseUrl,
      clientId: CLIENT_ID,
      secretCommand: `/bin/sh "${script}" ${CLIENT_SECRET}`,
    });

    const result = await runCli(["list", "--json"], { env: env() });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes(CLIENT_SECRET), "the secret must never be printed");
  });

  test("a failing secret command exits 1 and does not reach the API", async () => {
    writeConfig({
      baseUrl: server.baseUrl,
      clientId: CLIENT_ID,
      secretCommand: path.join(home, "does-not-exist"),
    });
    const before = server.requests.length;
    const result = await runCli(["list"], { env: env() });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /secretCommand` failed/);
    assert.equal(server.requests.length, before);
  });
});

describe("artifact commands", () => {
  test("list, versions, revoke and share round-trip", async () => {
    const file = writePage("page.html", PAGE);
    await runCli(["publish", file, "--channel", "demo-crud", "--title", "CRUD"]);

    const list = await runCli(["list", "--json"]);
    assert.equal(list.code, 0, list.stderr);
    const channels = JSON.parse(list.stdout).artifacts.map((artifact) => artifact.channel);
    assert.ok(channels.includes("demo-crud"));

    const versions = await runCli(["versions", "demo-crud", "--json"]);
    assert.equal(versions.code, 0, versions.stderr);
    assert.equal(JSON.parse(versions.stdout).versions.length, 1);

    const share = await runCli(["share", "demo-crud", "--to", "a@b.test", "--to", "c@d.test", "--json"]);
    assert.equal(share.code, 0, share.stderr);
    assert.deepEqual(JSON.parse(share.stdout).viewers.sort(), ["a@b.test", "c@d.test"]);

    const unshare = await runCli(["unshare", "demo-crud", "--to", "a@b.test", "--json"]);
    assert.equal(unshare.code, 0, unshare.stderr);
    assert.deepEqual(JSON.parse(unshare.stdout).viewers, ["c@d.test"]);

    const revoke = await runCli(["revoke", "demo-crud", "--json"]);
    assert.equal(revoke.code, 0, revoke.stderr);
    assert.ok(JSON.parse(revoke.stdout).revoked_at);
  });

  test("share without --to exits 1", async () => {
    const result = await runCli(["share", "demo-crud"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /needs at least one --to/);
  });

  test("share with a non-address exits 1", async () => {
    const result = await runCli(["share", "demo-crud", "--to", "not-an-email"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is not an email address/);
  });

  test("versions on an unknown channel is exit 2", async () => {
    const result = await runCli(["versions", "no-such-channel"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no such artifact/);
  });
});

describe("comments", () => {
  test("comments --to-agent asks the API for agent comments only", async () => {
    const result = await runCli(["comments", "demo", "--to-agent", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const ids = JSON.parse(result.stdout).comments.map((comment) => comment.id);
    assert.deepEqual(ids.sort(), ["c-new", "c-seen"]);
    assert.equal(server.requests.at(-1).query.to_agent, "1");
  });

  test("--since is forwarded", async () => {
    const result = await runCli(["comments", "demo", "--since", "2026-08-30T09:00:00.000Z", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.requests.at(-1).query.since, "2026-08-30T09:00:00.000Z");
  });

  test("reply, resolve and seen address a comment by id", async () => {
    const reply = await runCli(["reply", "demo", "c-new", "fixed the chart", "--json"]);
    assert.equal(reply.code, 0, reply.stderr);
    assert.equal(JSON.parse(reply.stdout).comment.body, "fixed the chart");

    const resolve = await runCli(["resolve", "demo", "c-new", "--json"]);
    assert.equal(resolve.code, 0, resolve.stderr);
    assert.ok(JSON.parse(resolve.stdout).comment.resolved_at);

    const seen = await runCli(["seen", "demo", "c-new", "--json"]);
    assert.equal(seen.code, 0, seen.stderr);
    assert.ok(JSON.parse(seen.stdout).comment.agent_seen_at);
  });

  test("reply without text exits 1", async () => {
    const result = await runCli(["reply", "demo", "c-new"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /reply needs <text>/);
  });
});

describe("watch --once", () => {
  const inbox = () => path.join(home, ".local", "state", "yoki", "artifact", "inbox.jsonl");

  test("writes each unseen agent comment as one JSON line", async () => {
    const result = await runCli(["watch", WATCH_CHANNEL, "--once", "--json"]);
    assert.equal(result.code, 0, result.stderr);

    const lines = fs.readFileSync(inbox(), "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "only the unseen to_agent comment belongs in the inbox");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.channel, WATCH_CHANNEL);
    assert.equal(entry.comment.id, "w-new");
    assert.equal(entry.url, `${server.baseUrl}/a/${WATCH_CHANNEL}`);
    assert.ok(entry.recorded_at);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.inbox, inbox());
  });

  test("a second poll does not duplicate the entry", async () => {
    await runCli(["watch", WATCH_CHANNEL, "--once"]);
    const first = fs.readFileSync(inbox(), "utf8");
    const second = await runCli(["watch", WATCH_CHANNEL, "--once"]);

    assert.equal(second.code, 0, second.stderr);
    assert.equal(fs.readFileSync(inbox(), "utf8"), first, "the inbox must be idempotent across polls");
    assert.match(second.stdout, new RegExp(`no new agent comments on ${WATCH_CHANNEL}`));
  });

  test("--interval below the floor exits 1", async () => {
    const result = await runCli(["watch", WATCH_CHANNEL, "--once", "--interval", "1"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--interval must be at least 5 seconds/);
  });

  test("watch without a channel exits 1", async () => {
    const result = await runCli(["watch", "--once"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /watch needs at least one <channel>/);
  });
});

// The long-running mode is driven in-process: a child running forever cannot
// be asserted on, and the point of these cases is which failures end the loop.
describe("watch (long-running)", () => {
  /** Drives cmdWatch until `responses` is exhausted, then ends it with a
   *  non-CliError, which the loop always treats as fatal. */
  async function runLoop(responses) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "yoki-watch-"));
    const printed = [];
    const warned = [];
    let call = 0;

    const client = {
      viewerUrl: (channel) => `https://artifacts.example.test/a/${channel}`,
      async request() {
        const next = responses[call++];
        if (next === undefined) throw new Error("loop-end");
        if (next instanceof Error) throw next;
        return { status: 200, body: { comments: next } };
      },
    };

    const error = await cmdWatch({
      client,
      positionals: ["demo-loop"],
      flags: { interval: 5 },
      env: { XDG_STATE_HOME: state },
      now: () => new Date("2026-08-31T12:00:00.000Z"),
      print: (line) => printed.push(line),
      stderr: { write: (line) => warned.push(line) },
      sleep: async () => {},
    }).then(
      () => null,
      (err) => err,
    );

    return { error, printed, warned, calls: call };
  }

  const agentComment = (id) => ({
    id,
    channel: "demo-loop",
    author: "viewer@example.test",
    body: "please fix the legend",
    to_agent: true,
    agent_seen_at: null,
    resolved_at: null,
    parent_id: null,
    created_at: "2026-08-31T11:00:00.000Z",
  });

  test("a transient poll failure is reported and the loop keeps going", async () => {
    const { error, printed, warned, calls } = await runLoop([
      [],
      networkError("http_502", "artifacts.example.test is having a moment"),
      [agentComment("late-1")],
    ]);

    assert.equal(error.message, "loop-end", "only the injected fatal error ends the loop");
    assert.equal(calls, 4, "the poll after the failure still ran");
    assert.match(warned.join(""), /having a moment/);
    assert.equal(printed.length, 1);
    assert.equal(JSON.parse(printed[0]).comment.id, "late-1");
  });

  test("an Access rejection ends the watch instead of retrying forever", async () => {
    const forbidden = networkError("not_shared", "Access rejected the request (403): no");
    forbidden.status = 403;

    const { error, calls } = await runLoop([[], forbidden]);

    assert.equal(error, forbidden);
    assert.equal(calls, 2, "no further polls after a permanent refusal");
  });

  test("isFatalWatchError separates permanent refusals from blips", () => {
    assert.equal(isFatalWatchError(networkError("http_502", "bad gateway")), false);
    assert.equal(isFatalWatchError(networkError("unreachable", "timed out")), false);
    assert.equal(isFatalWatchError(networkError("access_redirect", "not authorised")), true);
    assert.equal(isFatalWatchError(Object.assign(networkError("nope", "x"), { status: 401 })), true);
    assert.equal(isFatalWatchError(new Error("something else entirely")), true);
  });
});

describe("doctor", () => {
  test("reports all three checks green against a reachable API", async () => {
    const result = await runCli(["doctor", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.checks.map((check) => check.name), ["config", "secret", "api"]);
    assert.ok(payload.checks.every((check) => check.ok));
  });

  test("a missing config fails the config check and prints setup hints", async () => {
    const result = await runCli(["doctor"], { env: env() });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /FAIL {2}config/);
    assert.match(result.stdout, /Cloudflare Access|Setup/);
  });

  test("hints come from worker/SETUP.md when it is there, capped in length", () => {
    const file = path.join(home, "SETUP.md");
    fs.writeFileSync(file, Array.from({ length: HINT_LINE_LIMIT + 5 }, (_, i) => `line ${i + 1}`).join("\n"), "utf8");
    const hints = setupHints(file);
    assert.equal(hints[0], `Setup notes (${file}):`);
    assert.equal(hints.length, HINT_LINE_LIMIT + 2, "header + capped body + the 'more lines' pointer");
    assert.match(hints.at(-1), /… 5 more lines in/);
  });

  test("hints fall back to the built-in checklist when SETUP.md is absent", () => {
    const hints = setupHints(path.join(home, "no-setup.md"));
    assert.equal(hints, FALLBACK_HINTS);
  });

  test("an unreachable API fails only the api check, exit 2", async () => {
    const result = await runCli(["doctor", "--json"], {
      env: credentials({ YOKI_ARTIFACT_URL: "http://127.0.0.1:1" }),
    });
    assert.equal(result.code, 2);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.checks.map((check) => check.ok), [true, true, false]);
    assert.ok(payload.hints.length > 0);
  });
});

describe("open", () => {
  test("spawns macOS `open` with the URL and no shell", () => {
    const calls = [];
    const url = openUrl("https://example.test/a/demo", {
      platform: "darwin",
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return { unref() {} };
      },
    });
    assert.equal(url, "https://example.test/a/demo");
    assert.deepEqual(calls, [
      {
        command: "open",
        args: ["https://example.test/a/demo"],
        options: { shell: false, stdio: "ignore", detached: true },
      },
    ]);
  });

  test("elsewhere it refuses and prints the URL instead of guessing at a browser", () => {
    assert.throws(
      () => openUrl("https://example.test/a/demo", { platform: "linux", spawnImpl: () => assert.fail("no spawn") }),
      /macOS-only; open it yourself: https:\/\/example\.test\/a\/demo/,
    );
  });
});

describe("node floor", () => {
  test("the guard accepts 22 and up", () => {
    assert.equal(nodeVersionOk("v22.20.0"), true);
    assert.equal(nodeVersionOk("v24.0.0"), true);
    assert.equal(nodeVersionOk("v20.11.0"), false);
    assert.equal(nodeVersionOk("nonsense"), false);
  });
});
