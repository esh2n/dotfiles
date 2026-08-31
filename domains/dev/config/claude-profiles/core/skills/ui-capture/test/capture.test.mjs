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
const LAUNCHER_BIN = path.join(HERE, "..", "bin", "ui-capture");
const PLAYWRIGHT_PATH =
  process.env.UI_CAPTURE_PLAYWRIGHT ??
  "/Users/esh2n/go/github.com/esh2n/arekore/apps/viewer/node_modules/playwright";

// capture.mjs 自身がエクスポートする純関数(Node バージョンガード)を単体で
// 検証する。プロセスの process.version は non-writable なので、子プロセス
// を実際に古い Node で spawn してガードを踏ませることはできない(このマシン
// に入っている mise 管理の 20.x は bin/ が空 — 実体を持たない placeholder)。
// そのため純関数レベルでの検証にとどめる。capture.mjs は import 時に
// main() を自動実行しない(entrypoint ガード付き)ので import は安全。
import { nodeMajorVersion, nodeVersionOk, nodeVersionGuardMessage } from "../bin/capture.mjs";

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
function runCapture(args, env = {}, spawnOptions = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CAPTURE_BIN, ...args], {
      env: { ...process.env, UI_CAPTURE_PLAYWRIGHT: PLAYWRIGHT_PATH, ...env },
      ...spawnOptions,
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

  // ~/.claude/skills/ui-capture -> このリポジトリ という symlink 越しに
  // 実運用で呼ばれる経路を再現する回帰テスト。以前は entrypoint ガードが
  // process.argv[1] を symlink 解決せずに比較していたため isMain が false
  // のまま main() が一切走らず、stdout が空・exit 0 で黙って何もしなかった
  // (最悪の壊れ方: silent success)。bin/ 全体への symlink を張り、その
  // symlink 越しの capture.mjs を直接 spawn して main() が実際に走ることを
  // 確認する。playwright は解決不要(dry-run はそこへ到達する前に return
  // する)なので resolvable ガードは要らない。
  test("runs main when invoked through a symlinked bin dir", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-symlink-"));
    const realBinDir = path.dirname(CAPTURE_BIN);
    const linkDir = path.join(tmp, "bin-link");
    fs.symlinkSync(realBinDir, linkDir);
    const scenarioPath = path.join(tmp, "scenario.json");
    fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [{ goto: "/" }] }));
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          path.join(linkDir, "capture.mjs"),
          "--dry-run",
          "--url",
          "http://127.0.0.1:9",
          "--scenario",
          scenarioPath,
          "--out",
          path.join(tmp, "out"),
        ],
        { env: { ...process.env, UI_CAPTURE_PLAYWRIGHT: PLAYWRIGHT_PATH } },
      );
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
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"dryRun": true/);
    fs.rmSync(tmp, { recursive: true, force: true });
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
      // gif + shot with ffmpeg available: the recording is split from the
      // screenshot pass to keep the video clean (see capture.mjs's twoPass).
      assert.equal(summary.passes, 2, JSON.stringify(summary));
    } else {
      assert.equal(summary.gif.status, "skipped");
      // no ffmpeg means no recording is attempted at all — single pass.
      assert.equal(summary.passes, 1, JSON.stringify(summary));
      t.diagnostic("ffmpeg not on PATH — gif assertions skipped");
    }

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test("gif-only scenario (no shot steps) runs a single pass", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const gifOnlyOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-gifonly-"));
    const scenarioPath = path.join(gifOnlyOut, "scenario.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({
        steps: [{ goto: "/" }, { click: "#toggle" }, { wait: 200 }],
        gif: { name: "toggle-only" },
      }),
    );
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      gifOnlyOut,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.passes, 1, JSON.stringify(summary));
    if (hasFfmpeg()) {
      assert.equal(summary.gif.status, "ok", JSON.stringify(summary.gif));
    }
    fs.rmSync(gifOnlyOut, { recursive: true, force: true });
  });

  test("shot-only scenario (no gif) runs a single pass", async (t) => {
    if (!resolvable) {
      t.skip("playwright not resolvable");
      return;
    }
    const shotOnlyOut = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-shotonly-"));
    const scenarioPath = path.join(shotOnlyOut, "scenario.json");
    fs.writeFileSync(
      scenarioPath,
      JSON.stringify({ steps: [{ goto: "/" }, { shot: "only" }] }),
    );
    const result = await runCapture([
      "--url",
      site.url,
      "--scenario",
      scenarioPath,
      "--out",
      shotOnlyOut,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.passes, 1, JSON.stringify(summary));
    assert.equal(summary.gif, null);
    const pngPath = path.join(shotOnlyOut, "only.png");
    assert.ok(fs.existsSync(pngPath), "only.png should exist");
    assert.ok(isPng(pngPath), "only.png should have PNG magic bytes");
    fs.rmSync(shotOnlyOut, { recursive: true, force: true });
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

  // --- Node バージョンガード(ui-capture の設計 決定点2「Node の版が repo
  // ごとに違う場合」)------------------------------------------------------
  // process.version は non-writable なので、実際に古い Node で子プロセスを
  // spawn してガードを踏ませることができない(このマシンの mise 管理下の
  // 20.x は bin/ が空の placeholder — ダウンロード済みの実体を持たない)。
  // 純関数を単体で検証する。
  describe("node version guard (unit)", () => {
    test("nodeMajorVersion parses the major from a v-prefixed version", () => {
      assert.equal(nodeMajorVersion("v22.20.0"), 22);
      assert.equal(nodeMajorVersion("v26.6.0"), 26);
      assert.equal(nodeMajorVersion("v9.0.0"), 9);
      assert.ok(Number.isNaN(nodeMajorVersion("not-a-version")));
    });

    test("nodeVersionOk rejects below 22, accepts 22+", () => {
      assert.equal(nodeVersionOk("v21.7.3"), false);
      assert.equal(nodeVersionOk("v18.20.4"), false);
      assert.equal(nodeVersionOk("v22.0.0"), true);
      assert.equal(nodeVersionOk("v26.6.0"), true);
    });

    test("nodeVersionGuardMessage names bin/ui-capture and $UI_CAPTURE_NODE", () => {
      const message = nodeVersionGuardMessage("v18.20.4");
      assert.match(message, /v18\.20\.4/);
      assert.match(message, /bin\/ui-capture/);
      assert.match(message, /UI_CAPTURE_NODE/);
    });

    test("main() returns exit 6 under a version below 22 (process.version is real, so this only runs the guard-adjacent assertion)", () => {
      // We cannot force this process's own process.version, so this is a
      // documentation-level assertion that the running test process itself
      // (Node 22+, per SKILL.md's stated floor) passes the guard — the real
      // rejection path is covered by the unit tests above.
      assert.equal(nodeVersionOk(), true, `test runner itself must be Node 22+, got ${process.version}`);
    });
  });

  // --- 共有 Playwright の解決順(project → env → shared)-------------------
  describe("shared playwright resolution", () => {
    test("resolves via the shared install when project has no node_modules and no env override", async (t) => {
      if (!resolvable) {
        t.skip(`playwright not resolvable at ${PLAYWRIGHT_PATH} — set UI_CAPTURE_PLAYWRIGHT`);
        return;
      }
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-fakehome-"));
      const sharedNodeModules = path.join(fakeHome, ".local", "share", "ui-capture", "node_modules");
      fs.mkdirSync(sharedNodeModules, { recursive: true });
      fs.symlinkSync(PLAYWRIGHT_PATH, path.join(sharedNodeModules, "playwright"), "dir");

      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-noshare-project-"));
      const scenarioPath = path.join(projectDir, "scenario.json");
      fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [] }));

      const result = await runCapture(
        ["--url", "http://127.0.0.1:1", "--scenario", scenarioPath, "--out", path.join(projectDir, "out"), "--dry-run"],
        { HOME: fakeHome, UI_CAPTURE_PLAYWRIGHT: "" },
        { cwd: projectDir },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.playwright, "shared", result.stdout);

      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    test("dry-run reports playwright: null when nothing resolves", async () => {
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-fakehome-empty-"));
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-noresolve-project-"));
      const scenarioPath = path.join(projectDir, "scenario.json");
      fs.writeFileSync(scenarioPath, JSON.stringify({ steps: [] }));

      const result = await runCapture(
        ["--url", "http://127.0.0.1:1", "--scenario", scenarioPath, "--out", path.join(projectDir, "out"), "--dry-run"],
        { HOME: fakeHome, UI_CAPTURE_PLAYWRIGHT: "" },
        { cwd: projectDir },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.playwright, null, result.stdout);

      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    });
  });

  // --- 薄いランチャ(bin/ui-capture)の node 解決 ---------------------------
  describe("bin/ui-capture launcher", () => {
    test("resolves node from meta.json in $HOME/.local/share/ui-capture and execs capture.mjs", () => {
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-launcher-home-"));
      const shareDir = path.join(fakeHome, ".local", "share", "ui-capture");
      fs.mkdirSync(shareDir, { recursive: true });
      fs.writeFileSync(
        path.join(shareDir, "meta.json"),
        JSON.stringify(
          {
            node: process.execPath,
            nodeVersion: process.version,
            playwright: "1.61.1",
            installedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const result = spawnSync(LAUNCHER_BIN, ["--help"], {
        env: { ...process.env, HOME: fakeHome },
        encoding: "utf8",
      });
      // "--help" is not a recognized capture.mjs flag — reaching its
      // UsageError (rather than a shell "command not found" or the version
      // guard's exit 6) proves the launcher resolved meta.json's node and
      // exec'd capture.mjs with it.
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /unknown flag: --help/);

      fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    test("falls back to PATH's node when meta.json is absent", () => {
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-launcher-nohome-"));
      const result = spawnSync(LAUNCHER_BIN, ["--help"], {
        env: { ...process.env, HOME: fakeHome },
        encoding: "utf8",
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /unknown flag: --help/);
      fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    test("$UI_CAPTURE_NODE overrides meta.json", () => {
      const result = spawnSync(LAUNCHER_BIN, ["--help"], {
        env: { ...process.env, UI_CAPTURE_NODE: process.execPath, HOME: "/nonexistent-home" },
        encoding: "utf8",
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /unknown flag: --help/);
    });
  });

  // --- init サブコマンド ----------------------------------------------------
  describe("capture.mjs init", () => {
    test("writes a manifest template with the best dev/start/serve candidate", () => {
      // realpathSync: on macOS os.tmpdir() lives under /var, itself a
      // symlink to /private/var. A child process's own process.cwd() (used
      // internally by findRepoRoot) reports the resolved /private/var/...
      // path, so build the expected path the same way to compare strings.
      const repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-init-repo-")));
      fs.mkdirSync(path.join(repoDir, ".git"));
      fs.writeFileSync(
        path.join(repoDir, "package.json"),
        JSON.stringify({ name: "root", scripts: { dev: "vite", build: "vite build" } }),
      );

      const result = spawnSync(process.execPath, [CAPTURE_BIN, "init"], {
        cwd: repoDir,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);

      const manifestPath = path.join(repoDir, ".ui-capture.json");
      assert.ok(fs.existsSync(manifestPath));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(manifest.launch, "npm run dev");
      assert.equal(manifest.url, "http://127.0.0.1:PORT");
      assert.equal(typeof manifest.ready, "string");

      const summary = JSON.parse(result.stdout);
      assert.equal(summary.wrote, manifestPath);
      assert.ok(Array.isArray(summary.candidates));
      assert.equal(summary.chosen.command, "npm run dev");

      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    test("refuses to overwrite an existing manifest without --force", () => {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-init-exists-"));
      fs.mkdirSync(path.join(repoDir, ".git"));
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ scripts: {} }));
      fs.writeFileSync(path.join(repoDir, ".ui-capture.json"), JSON.stringify({ sentinel: true }));

      const result = spawnSync(process.execPath, [CAPTURE_BIN, "init"], {
        cwd: repoDir,
        encoding: "utf8",
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /already exists/);
      const untouched = JSON.parse(fs.readFileSync(path.join(repoDir, ".ui-capture.json"), "utf8"));
      assert.deepEqual(untouched, { sentinel: true });

      const forced = spawnSync(process.execPath, [CAPTURE_BIN, "init", "--force"], {
        cwd: repoDir,
        encoding: "utf8",
      });
      assert.equal(forced.status, 0, forced.stdout + forced.stderr);
      const overwritten = JSON.parse(fs.readFileSync(path.join(repoDir, ".ui-capture.json"), "utf8"));
      assert.equal(overwritten.sentinel, undefined);

      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    test("errors when run outside a git repo", () => {
      // os.tmpdir() (and its ancestors) are assumed to hold no .git — the
      // same assumption the pre-existing "no --url and no .ui-capture.json"
      // test above already relies on for findManifest's upward walk.
      const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-init-nogit-"));
      const result = spawnSync(process.execPath, [CAPTURE_BIN, "init"], {
        cwd: noGitDir,
        encoding: "utf8",
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /no \.git found/);
      assert.deepEqual(fs.readdirSync(noGitDir), []);
      fs.rmSync(noGitDir, { recursive: true, force: true });
    });
  });
});
