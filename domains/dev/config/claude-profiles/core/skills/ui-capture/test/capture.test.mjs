// ui-capture の capture.mjs を hermetic に検証する。
//
// playwright はこのスキル自身に依存として持たない(SKILL.md の
// zero-dependency rule)。テストは環境変数 UI_CAPTURE_PLAYWRIGHT で
// 既存プロジェクトの node_modules/playwright を指す前提で走る:
//
//   UI_CAPTURE_PLAYWRIGHT=/Users/esh2n/go/github.com/esh2n/arekore/apps/viewer/node_modules/playwright \
//     node --test test/capture.test.mjs
//
// この変数が指すパスに playwright が無い(require できない)場合、全テストを
// 1件の "skip" として報告して正常終了する — playwright が無い環境で赤くなる
// のは zero-dependency rule への違反になるため。
// ネットワークは使わない(HTTP サーバは 127.0.0.1 の使い捨てポートのみ)。

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_BIN = path.join(HERE, "..", "bin", "capture.mjs");
const PLAYWRIGHT_PATH =
  process.env.UI_CAPTURE_PLAYWRIGHT ??
  "/Users/esh2n/go/github.com/esh2n/arekore/apps/viewer/node_modules/playwright";

function playwrightResolvable() {
  try {
    execFileSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(PLAYWRIGHT_PATH)})`],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ui-capture fixture</title>
<style>
  #panel { max-height: 0; overflow: hidden; transition: max-height 300ms ease; background: #eef; }
  #panel.open { max-height: 200px; }
</style>
</head>
<body>
  <button id="toggle">toggle</button>
  <div id="panel"><p>panel content</p></div>
  <script>
    document.getElementById("toggle").addEventListener("click", () => {
      document.getElementById("panel").classList.toggle("open");
    });
  </script>
</body>
</html>`;

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

// spawn ではなく spawnSync だと、このテストプロセス自身のイベントループが
// 子プロセスの完了まで止まり、同じプロセス内で待ち受けているフィクスチャ
// HTTP サーバが接続を捌けなくなる(子の Chromium が goto でタイムアウトする
// 原因になった実際のバグ)。非同期 spawn + Promise で待つ。
function runCapture(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CAPTURE_BIN, ...args], {
      env: { ...process.env, UI_CAPTURE_PLAYWRIGHT: PLAYWRIGHT_PATH, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function isPng(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isGif(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.length > 6 && buf.subarray(0, 6).toString("ascii") === "GIF89a";
}

function hasFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

// テスト用に空きポート番号だけを取り出す(即座に閉じるので、manifest の
// launch が同じポートで listen し直すまでのごく短い競合はあるが、ローカル
// テストの範囲では十分安定する)。
function findFreePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

// 指定ポートが応答するかを TCP 接続だけで確かめる(HTTP モジュールに頼らず
// 「プロセスは本当に落ちたか」を見る)。
function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

describe("ui-capture bin/capture.mjs", () => {
  let site;
  let outDir;
  const resolvable = playwrightResolvable();

  before(async () => {
    if (!resolvable) return;
    site = await startFixtureServer();
  });

  after(() => {
    if (site) site.close();
  });

  test("playwright resolution", (t) => {
    if (!resolvable) {
      t.skip(`playwright not resolvable at ${PLAYWRIGHT_PATH} — set UI_CAPTURE_PLAYWRIGHT`);
      return;
    }
    assert.ok(true);
  });

  test("--dry-run writes nothing", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const dryOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-dry-"));
    const scenarioPath = path.join(dryOut, "scenario.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({ steps: [{ goto: "/" }, { shot: "home" }] }),
    );
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      dryOut,
      "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.steps, 2);
    assert.deepEqual(fs.readdirSync(dryOut), ["scenario.json"]);
    fs.rmSync(dryOut, { recursive: true, force: true });
  });

  test("shot + gif scenario produces valid files and a JSON summary", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-out-"));
    const scenarioPath = path.join(outDir, "scenario.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({
        steps: [
          { goto: "/" },
          { shot: "before" },
          { click: "#toggle" },
          { wait: 400 },
          { shot: "after", clip: "#panel" },
        ],
        gif: { name: "flow" },
      }),
    );
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      outDir,
      "--gif-fps",
      "10",
      "--gif-width",
      "400",
    ]);
    assert.equal(result.status, 0, result.stderr);

    const summary = JSON.parse(result.stdout);
    assert.equal(summary.url, site.url);
    assert.ok(Array.isArray(summary.files));
    assert.ok(Array.isArray(summary.warnings));
    assert.ok("gif" in summary);

    const beforePng = path.join(outDir, "before.png");
    const afterPng = path.join(outDir, "after.png");
    assert.ok(fs.existsSync(beforePng), "before.png should exist");
    assert.ok(fs.existsSync(afterPng), "after.png should exist");
    assert.ok(isPng(beforePng), "before.png should have PNG magic bytes");
    assert.ok(isPng(afterPng), "after.png should have PNG magic bytes");

    const gifPath = path.join(outDir, "flow.gif");
    if (hasFfmpeg()) {
      assert.equal(summary.gif.status, "ok", JSON.stringify(summary.gif));
      assert.ok(fs.existsSync(gifPath), "flow.gif should exist when ffmpeg is present");
      assert.ok(isGif(gifPath), "flow.gif should start with GIF89a");
      // webm should be cleaned up unless --keep-video was passed
      assert.deepEqual(
        fs.readdirSync(outDir).filter((f) => f.endsWith(".webm")),
        [],
      );
    } else {
      assert.equal(summary.gif.status, "skipped");
      t.diagnostic("ffmpeg not on PATH — gif assertions skipped");
    }

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test("invalid scenario exits 2", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const badOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-bad-"));
    const scenarioPath = path.join(badOut, "bad.json");
    fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [{ click: "a", fill: ["b", "c"] }] }));
    const result = await runCapture(["--url", site.url, "--scenario", scenarioPath, "--out", badOut]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    fs.rmSync(badOut, { recursive: true, force: true });
  });

  test("failing step exits 4 with step index in stderr", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const failOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-fail-"));
    const scenarioPath = path.join(failOut, "fail.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({ steps: [{ goto: "/" }, { click: "#does-not-exist", }] }),
    );
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      failOut,
    ]);
    assert.equal(result.status, 4, result.stdout + result.stderr);
    assert.match(result.stderr, /step 1/);
    fs.rmSync(failOut, { recursive: true, force: true });
  });

  test(".ui-capture.json manifest launches the app, captures, and cleans up the child", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-project-"));
    const manifestOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-manifest-out-"));
    const port = await findFreePort();
    const serverScript = path.join(HERE, "fixtures", "manifest-server.mjs");

    fs.writeFileSync(
      path.join(projectDir, ".ui-capture.json"),
      JSON.stringify({
        launch: `node ${JSON.stringify(serverScript)}`,
        url: `http://127.0.0.1:${port}`,
        ready: "ready on",
        env: { PORT: String(port) },
      }),
    );
    const scenarioPath = path.join(projectDir, "scenario.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({ steps: [{ goto: "/" }, { shot: "manifest-home" }] }),
    );

    const result = await runCapture([
      "--project",
      projectDir,
      "--scenario",
      scenarioPath,
      "--out",
      manifestOut,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const summary = JSON.parse(result.stdout);
    assert.equal(summary.launched, true);
    assert.equal(summary.url, `http://127.0.0.1:${port}`);
    const pngPath = path.join(manifestOut, "manifest-home.png");
    assert.ok(fs.existsSync(pngPath), "manifest-home.png should exist");
    assert.ok(isPng(pngPath), "manifest-home.png should have PNG magic bytes");

    // capture.mjs が起動した子プロセスは、撮影後に自分で片付ける契約
    // (SKILL.md の manifest 節)。ポートがもう開いていないことで確認する。
    const stillOpen = await portIsOpen(port);
    assert.equal(stillOpen, false, "the manifest-launched server should be stopped after capture");

    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(manifestOut, { recursive: true, force: true });
  });

  // findManifest はリポジトリ境界(.git を含むディレクトリ)で探索を止める
  // — .git のあるディレクトリ自身は調べるが、それより上(別リポジトリ)へは
  // 辿らない。--dry-run は playwright を呼ぶ前に return するので、この2件は
  // playwright の可否に関係なく走らせる。
  test("findManifest finds a manifest at a .git boundary directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-gitroot-"));
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(
      path.join(root, ".ui-capture.json"),
      JSON.stringify({ launch: "true", url: "http://example.invalid", ready: "x" }),
    );
    const startDir = path.join(root, "a", "b");
    fs.mkdirSync(startDir, { recursive: true });
    const scenarioPath = path.join(root, "scenario.json");
    fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [] }));

    const result = await runCapture([
      "--project",
      startDir,
      "--scenario",
      scenarioPath,
      "--out",
      path.join(root, "out"),
      "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.manifest, path.join(root, ".ui-capture.json"));

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("findManifest does not cross a .git boundary to a manifest above it", async () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-gitouter-"));
    fs.writeFileSync(
      path.join(outer, ".ui-capture.json"),
      JSON.stringify({ launch: "true", url: "http://example.invalid", ready: "x" }),
    );
    const repoDir = path.join(outer, "repo");
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    const startDir = path.join(repoDir, "x");
    fs.mkdirSync(startDir, { recursive: true });
    const scenarioPath = path.join(outer, "scenario.json");
    fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [] }));

    const result = await runCapture([
      "--project",
      startDir,
      "--scenario",
      scenarioPath,
      "--out",
      path.join(outer, "out"),
      "--dry-run",
    ]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /起動手段なし/);

    fs.rmSync(outer, { recursive: true, force: true });
  });

  test("--timeout applies to waitFor and fails fast with the step index", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const timeoutOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-timeout-"));
    const scenarioPath = path.join(timeoutOut, "timeout.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({ steps: [{ goto: "/" }, { waitFor: "#never-appears" }] }),
    );
    const startedAt = Date.now();
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      timeoutOut,
      // 1ms だと同じ既定タイムアウトを使う goto すら間に合わないことがある
      // (127.0.0.1 相手でも初回ナビゲーションはブラウザの初期化コストを
      // 引きずる)。goto は十分間に合うが waitFor の欠けたセレクタ待ちは
      // 確実に超える程度の値にして、失敗するのが step 1 であることを固定する。
      "--timeout",
      "300",
    ]);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.status, 4, result.stdout + result.stderr);
    assert.match(result.stderr, /step 1/);
    // 既定の5000msどころか、playwrightの既定30sより遥かに早く落ちることを
    // 確かめる(プロセス起動オーバーヘッドの余裕を見て3秒以内)。
    assert.ok(elapsedMs < 3000, `expected fast failure, took ${elapsedMs}ms`);
    fs.rmSync(timeoutOut, { recursive: true, force: true });
  });

  test("no --url and no .ui-capture.json exits 2 with a clear message", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    // filesystem root まで .ui-capture.json が無いことを保証するため、
    // os.tmpdir() 直下の使い捨てディレクトリを --project にする。
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-empty-"));
    const scenarioPath = path.join(emptyDir, "scenario.json");
    fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [{ goto: "/" }] }));
    const result = await runCapture([
      "--project",
      emptyDir,
      "--scenario",
      scenarioPath,
      "--out",
      path.join(emptyDir, "out"),
    ]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /起動手段なし/);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
