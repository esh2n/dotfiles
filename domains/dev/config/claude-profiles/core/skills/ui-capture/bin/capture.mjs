#!/usr/bin/env node
// ui-capture の実行体。web UI を headless Chromium で操作し、PNG / GIF を
// 書き出す。プロジェクト側がアプリを起動して URL を渡す — このスクリプト
// 自身はサーバや daemon を一切起動しない(分業の境界。SKILL.md 参照)。
//
// 依存は node 単体 + 解決した playwright のみ(zero-dependency rule)。
// GIF 化には PATH 上の ffmpeg を使う。無ければ GIF はスキップし理由を出す。

import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Node バージョンガード ---------------------------------------------------
// Playwright の npm パッケージは純 JS で Node の版に依存しないが、実際に
// 効くのはこの capture.mjs を実行する Node の版。mise は cwd で Node を
// 切り替えるため、古い Node を pin した repo の中で直接 `node bin/
// capture.mjs` すると撮影側もその Node で走ってしまう。bin/ui-capture
// (薄いランチャ) はこれを避けて harness の Node で再実行するが、直接
// `node capture.mjs` された場合の保険として、ここでも版を検査する。

const MIN_NODE_MAJOR = 22;

export function nodeMajorVersion(version = process.version) {
  const match = /^v(\d+)\./.exec(version);
  return match ? Number(match[1]) : NaN;
}

export function nodeVersionOk(version = process.version) {
  const major = nodeMajorVersion(version);
  return Number.isFinite(major) && major >= MIN_NODE_MAJOR;
}

export function nodeVersionGuardMessage(version = process.version) {
  return (
    `ui-capture requires Node ${MIN_NODE_MAJOR}+ (running under ${version}). ` +
    "Run via bin/ui-capture (it resolves the Node recorded by bin/setup.mjs " +
    `in ~/.local/share/ui-capture/meta.json), or set $UI_CAPTURE_NODE to a ` +
    `Node ${MIN_NODE_MAJOR}+ binary.`
  );
}

// --- CLI 引数 -------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    url: null,
    project: null,
    scenario: null,
    out: null,
    width: 1280,
    height: 800,
    scale: 2,
    gifFps: 10,
    gifWidth: 800,
    theme: null,
    dryRun: false,
    keepVideo: false,
    timeout: 5000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    switch (flag) {
      case "--url":
        args.url = next();
        break;
      case "--project":
        args.project = next();
        break;
      case "--scenario":
        args.scenario = next();
        break;
      case "--out":
        args.out = next();
        break;
      case "--width":
        args.width = Number(next());
        break;
      case "--height":
        args.height = Number(next());
        break;
      case "--scale":
        args.scale = Number(next());
        break;
      case "--gif-fps":
        args.gifFps = Number(next());
        break;
      case "--gif-width":
        args.gifWidth = Number(next());
        break;
      case "--theme":
        args.theme = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--keep-video":
        args.keepVideo = true;
        break;
      case "--timeout":
        args.timeout = Number(next());
        break;
      default:
        throw new UsageError(`unknown flag: ${flag}`);
    }
  }
  if (!args.scenario) throw new UsageError("--scenario is required");
  if (!args.out) throw new UsageError("--out is required");
  if (args.theme !== null && args.theme !== "light" && args.theme !== "dark") {
    throw new UsageError(`--theme must be light or dark, got: ${args.theme}`);
  }
  return args;
}

class UsageError extends Error {}
class ScenarioError extends Error {}
class PlaywrightNotFoundError extends Error {}
class LaunchError extends Error {}
class StepError extends Error {
  constructor(message, stepIndex, step) {
    super(message);
    this.stepIndex = stepIndex;
    this.step = step;
  }
}

// --- playwright の解決 -----------------------------------------------------
// このスキル自身は playwright を持たない(zero-dependency rule)。解決順は
// 3段階(ADR相当の裁定 — ui-capture の設計 決定点2):
//   1. 呼び出し元プロジェクトの node_modules — プロジェクトが自分の版を
//      固定しているなら、それを常に優先する
//   2. $UI_CAPTURE_PLAYWRIGHT — 明示指定(テストや、node_modules から
//      辿れない配置向け)
//   3. 共有インストール(~/.local/share/ui-capture/node_modules/playwright、
//      bin/setup.mjs が一度だけ用意する)— Node でないプロダクト向けの
//      最後の手段。使うときは PLAYWRIGHT_BROWSERS_PATH を同ディレクトリ内の
//      browsers/ に固定してから import する(npm 本体と Chromium の版を
//      一致させるため — setup.mjs が両方をそこに揃えている)。
// どれも解決できなければ、bin/setup.mjs を指す明示エラーで exit 3。

const SHARED_DIR = path.join(os.homedir(), ".local", "share", "ui-capture");
const SHARED_PLAYWRIGHT_MODULE = path.join(SHARED_DIR, "node_modules", "playwright");
const SHARED_BROWSERS_DIR = path.join(SHARED_DIR, "browsers");

function resolvePlaywright() {
  // 1. project node_modules
  try {
    const resolved = require.resolve("playwright", {
      paths: [process.cwd()],
    });
    return { module: require(resolved), source: "project" };
  } catch {
    // fall through to the next source
  }

  // 2. explicit override
  const override = process.env.UI_CAPTURE_PLAYWRIGHT;
  if (override) {
    const entry = path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
    try {
      return { module: require(entry), source: "env" };
    } catch (error) {
      throw new PlaywrightNotFoundError(
        `UI_CAPTURE_PLAYWRIGHT=${override} could not be required: ${error.message}`,
      );
    }
  }

  // 3. shared install (bin/setup.mjs)
  if (fs.existsSync(SHARED_PLAYWRIGHT_MODULE)) {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = SHARED_BROWSERS_DIR;
    }
    try {
      return { module: require(SHARED_PLAYWRIGHT_MODULE), source: "shared" };
    } catch (error) {
      throw new PlaywrightNotFoundError(
        `shared playwright at ${SHARED_PLAYWRIGHT_MODULE} could not be required: ${error.message}`,
      );
    }
  }

  throw new PlaywrightNotFoundError(
    "playwright not found in the project's node_modules, " +
      "UI_CAPTURE_PLAYWRIGHT is not set, and there is no shared install at " +
      `${SHARED_PLAYWRIGHT_MODULE}. Run node ${path.join(SKILL_DIR, "bin", "setup.mjs")} ` +
      "once per machine, or set UI_CAPTURE_PLAYWRIGHT=/path/to/node_modules/playwright.",
  );
}

// --- シナリオの読み込みと検証 -----------------------------------------------

const STEP_KEYS = ["goto", "click", "fill", "press", "wait", "waitFor", "shot", "hover"];

function loadScenario(scenarioPath) {
  let raw;
  try {
    raw = fs.readFileSync(scenarioPath, "utf8");
  } catch (error) {
    throw new ScenarioError(`cannot read scenario file: ${scenarioPath} (${error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScenarioError(`scenario is not valid JSON: ${error.message}`);
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.steps)) {
    throw new ScenarioError('scenario must be an object with a "steps" array');
  }
  parsed.steps.forEach((step, index) => {
    if (typeof step !== "object" || step === null) {
      throw new ScenarioError(`step ${index} is not an object`);
    }
    const keys = Object.keys(step).filter((k) => STEP_KEYS.includes(k));
    if (keys.length !== 1) {
      throw new ScenarioError(
        `step ${index} must have exactly one of: ${STEP_KEYS.join(", ")} (got: ${JSON.stringify(step)})`,
      );
    }
  });
  if (parsed.gif !== undefined) {
    if (typeof parsed.gif !== "object" || parsed.gif === null || typeof parsed.gif.name !== "string") {
      throw new ScenarioError('scenario.gif must be an object with a "name" string');
    }
  }
  return parsed;
}

// --- プロジェクトマニフェスト(.ui-capture.json)------------------------------
// --url が無いとき、capture.mjs 自身がプロジェクトのアプリを起動できる
// ようにする分業の抜け道。ただし起動手段はプロジェクトが明示した
// .ui-capture.json のみを使う — 推測で起動コマンドを組み立てない。

const MANIFEST_NAME = ".ui-capture.json";
const READY_TIMEOUT_MS = 60000;
const READY_POLL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// startDir から上へ辿って最初に見つかった .ui-capture.json のパスを返す。
// リポジトリ境界(.git を含むディレクトリ)より上へは辿らない — 別
// リポジトリのマニフェストを誤って拾わないため。.git のあるディレクトリ
// 自身は最後にもう一度だけ調べてから探索を止める。.git に一度も出会わ
// なければ、従来どおり filesystem root まで辿って諦める。
function findManifest(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, MANIFEST_NAME);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadManifest(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new ScenarioError(`cannot read ${MANIFEST_NAME}: ${manifestPath} (${error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScenarioError(`${MANIFEST_NAME} is not valid JSON: ${error.message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ScenarioError(`${MANIFEST_NAME} must be an object`);
  }
  if (typeof parsed.launch !== "string" || parsed.launch.trim() === "") {
    throw new ScenarioError(`${MANIFEST_NAME} "launch" must be a non-empty string`);
  }
  if (typeof parsed.url !== "string" || parsed.url.trim() === "") {
    throw new ScenarioError(`${MANIFEST_NAME} "url" must be a non-empty string`);
  }
  const readyIsString = typeof parsed.ready === "string";
  const readyIsHttp =
    typeof parsed.ready === "object" && parsed.ready !== null && typeof parsed.ready.http === "string";
  if (!readyIsString && !readyIsHttp) {
    throw new ScenarioError(`${MANIFEST_NAME} "ready" must be a string or { "http": "<path>" }`);
  }
  if (parsed.stop !== undefined && typeof parsed.stop !== "string") {
    throw new ScenarioError(`${MANIFEST_NAME} "stop" must be a string`);
  }
  if (parsed.env !== undefined && (typeof parsed.env !== "object" || parsed.env === null)) {
    throw new ScenarioError(`${MANIFEST_NAME} "env" must be an object`);
  }
  return parsed;
}

// manifest.launch を起動し、readiness を待ってから { stop } を返す。
// stop() はマニフェストの stop コマンド、無ければプロセスグループへ
// SIGTERM(detached: true で新しいプロセスグループのリーダーにしてある)。
async function launchFromManifest(manifestPath, manifest) {
  const manifestDir = path.dirname(manifestPath);
  const env = { ...process.env, ...(manifest.env ?? {}) };
  const child = spawn(manifest.launch, {
    shell: true,
    detached: true,
    cwd: manifestDir,
    env,
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  let spawnError = null;
  child.stdout?.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });
  child.on("error", (error) => {
    spawnError = error;
  });

  const stop = () => {
    if (manifest.stop) {
      spawnSync(manifest.stop, { shell: true, cwd: manifestDir, env });
      return;
    }
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  try {
    if (readyIsHttpTarget(manifest.ready)) {
      const target = `${manifest.url}${manifest.ready.http}`;
      let ok = false;
      while (Date.now() < deadline) {
        if (spawnError) {
          throw new LaunchError(`launch command failed to start: ${spawnError.message}`);
        }
        try {
          const res = await fetch(target);
          if (res.status === 200) {
            ok = true;
            break;
          }
        } catch {
          // not up yet — keep polling
        }
        await sleep(READY_POLL_MS);
      }
      if (!ok) {
        throw new LaunchError(`timed out waiting for HTTP 200 on ${target} (${READY_TIMEOUT_MS}ms)`);
      }
    } else {
      let ok = false;
      while (Date.now() < deadline) {
        if (spawnError) {
          throw new LaunchError(`launch command failed to start: ${spawnError.message}`);
        }
        if (stdoutBuf.includes(manifest.ready) || stderrBuf.includes(manifest.ready)) {
          ok = true;
          break;
        }
        await sleep(READY_POLL_MS);
      }
      if (!ok) {
        throw new LaunchError(
          `timed out waiting for ready substring ${JSON.stringify(manifest.ready)} from launch command (${READY_TIMEOUT_MS}ms)`,
        );
      }
    }
  } catch (error) {
    stop();
    throw error;
  }

  return { stop };
}

function readyIsHttpTarget(ready) {
  return typeof ready === "object" && ready !== null && typeof ready.http === "string";
}

// --- ffmpeg ----------------------------------------------------------------

function hasFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

function ffmpegToGif(webmPath, gifPath, { fps, width }) {
  const paletteDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-palette-"));
  const palettePath = path.join(paletteDir, "palette.png");
  const scaleFilter = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  try {
    const gen = spawnSync("ffmpeg", [
      "-y",
      "-i",
      webmPath,
      "-vf",
      `${scaleFilter},palettegen`,
      palettePath,
    ]);
    if (gen.status !== 0) {
      throw new Error(`ffmpeg palettegen failed: ${gen.stderr?.toString() ?? ""}`);
    }
    const use = spawnSync("ffmpeg", [
      "-y",
      "-i",
      webmPath,
      "-i",
      palettePath,
      "-filter_complex",
      `${scaleFilter}[x];[x][1:v]paletteuse`,
      gifPath,
    ]);
    if (use.status !== 0) {
      throw new Error(`ffmpeg paletteuse failed: ${use.stderr?.toString() ?? ""}`);
    }
  } finally {
    fs.rmSync(paletteDir, { recursive: true, force: true });
  }
}

function gifDurationSeconds(gifPath, fallbackSeconds) {
  const probe = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    gifPath,
  ]);
  if (probe.status === 0) {
    const parsed = Number(probe.stdout.toString().trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackSeconds;
}

// --- ステップ実行 -----------------------------------------------------------

async function runStep(page, step, index, baseUrl) {
  try {
    if ("goto" in step) {
      const target = /^https?:\/\//.test(step.goto) ? step.goto : `${baseUrl}${step.goto}`;
      await page.goto(target);
      return null;
    }
    if ("click" in step) {
      await page.locator(step.click).click();
      return null;
    }
    if ("hover" in step) {
      await page.locator(step.hover).hover();
      return null;
    }
    if ("fill" in step) {
      const [selector, text] = step.fill;
      await page.locator(selector).fill(text);
      return null;
    }
    if ("press" in step) {
      await page.keyboard.press(step.press);
      return null;
    }
    if ("wait" in step) {
      await page.waitForTimeout(step.wait);
      return null;
    }
    if ("waitFor" in step) {
      await page.locator(step.waitFor).first().waitFor({ state: "visible" });
      return null;
    }
    if ("shot" in step) {
      const options = {};
      if (step.clip) {
        const box = await page.locator(step.clip).boundingBox();
        if (!box) {
          throw new StepError(`clip selector matched no visible element: ${step.clip}`, index, step);
        }
        options.clip = box;
      }
      return { name: step.shot, options };
    }
    throw new StepError(`unrecognized step at index ${index}`, index, step);
  } catch (error) {
    if (error instanceof StepError) throw error;
    throw new StepError(error.message, index, step);
  }
}

// --- init サブコマンド -------------------------------------------------------
// `capture.mjs init` は .ui-capture.json の雛形を repo ルートに書く。
// launch は package.json の dev/start/serve スクリプトから最有力候補を
// 選んで埋めるが、url は環境依存で推測できないのでプレースホルダのまま
// 残し、ready も同様。**実行は一切しない** — 起動コマンドを実際に走らせて
// ポートを推測するようなことはしない(ui-capture の設計 進め方2)。

class ManifestExistsError extends Error {}

const CANDIDATE_SCRIPTS = ["dev", "start", "serve"];
const SCRIPT_RANK = { dev: 0, start: 1, serve: 2 };

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function scriptCommand(pm, scriptName, subdir) {
  if (subdir) {
    if (pm === "pnpm") return `pnpm --dir ${subdir} run ${scriptName}`;
    if (pm === "yarn") return `yarn --cwd ${subdir} run ${scriptName}`;
    return `npm run ${scriptName} --prefix ${subdir}`;
  }
  if (pm === "pnpm") return `pnpm run ${scriptName}`;
  if (pm === "yarn") return `yarn run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function readPackageScripts(pkgPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg && typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {};
  } catch {
    return {};
  }
}

// package.json の dev/start/serve スクリプトを repo ルートと apps/* から
// 集める。実行はしない — 候補として提示するだけ。
function findLaunchCandidates(root) {
  const pm = detectPackageManager(root);
  const candidates = [];
  const collect = (pkgPath, subdir) => {
    const scripts = readPackageScripts(pkgPath);
    for (const name of CANDIDATE_SCRIPTS) {
      if (typeof scripts[name] === "string") {
        candidates.push({
          location: subdir ? path.join(subdir, "package.json") : "package.json",
          script: name,
          command: scriptCommand(pm, name, subdir),
        });
      }
    }
  };
  collect(path.join(root, "package.json"), null);
  const appsDir = path.join(root, "apps");
  if (fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory()) {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      collect(path.join(appsDir, entry.name, "package.json"), path.join("apps", entry.name));
    }
  }
  return candidates;
}

// root package.json の dev を最有力とし、apps/* より優先する。
function pickBestCandidate(candidates) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aRoot = a.location === "package.json" ? 0 : 1;
    const bRoot = b.location === "package.json" ? 0 : 1;
    if (aRoot !== bRoot) return aRoot - bRoot;
    return SCRIPT_RANK[a.script] - SCRIPT_RANK[b.script];
  })[0];
}

function runInit(initArgv) {
  const force = initArgv.includes("--force");
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new UsageError("init: no .git found above cwd — run this inside a repo");
  }
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (fs.existsSync(manifestPath) && !force) {
    throw new ManifestExistsError(`${manifestPath} already exists — pass --force to overwrite`);
  }

  const candidates = findLaunchCandidates(root);
  const chosen = pickBestCandidate(candidates);
  const template = {
    launch: chosen ? chosen.command : "TODO: fill in the dev/start command",
    url: "http://127.0.0.1:PORT",
    ready: "TODO: a substring launch prints when ready, or { \"http\": \"/path\" }",
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(template, null, 2)}\n`);

  process.stdout.write(
    `${JSON.stringify({ wrote: manifestPath, candidates, chosen }, null, 2)}\n`,
  );
  process.stderr.write(
    `wrote ${manifestPath} — fill in "url" and "ready" before using it (see candidates above)\n`,
  );
  return 0;
}

// --- 本体 -------------------------------------------------------------------

async function main() {
  if (!nodeVersionOk()) {
    process.stderr.write(`${nodeVersionGuardMessage()}\n`);
    return 6;
  }

  const argv = process.argv.slice(2);
  if (argv[0] === "init") {
    return runInit(argv.slice(1));
  }

  const args = parseArgs(argv);
  const scenario = loadScenario(args.scenario);

  // URL の解決: --url があればそれを使う。無ければ .ui-capture.json を
  // (--project、無ければ cwd から)上へ辿って探す。どちらも無ければ
  // 起動手段が無いので exit 2(usage)。
  const manifestPath = args.url ? null : findManifest(args.project ?? process.cwd());
  let manifest = null;
  if (!args.url) {
    if (!manifestPath) {
      throw new UsageError("起動手段なし: --url か .ui-capture.json を用意する");
    }
    manifest = loadManifest(manifestPath);
  }
  const resolvedUrl = args.url ?? manifest.url;

  if (args.dryRun) {
    // dry-run はシナリオの妥当性だけを見る契約 — playwright が無い環境
    // でも使えるよう、解決を試みるが失敗しても dry-run 自体は落とさない。
    let playwrightSource = null;
    try {
      playwrightSource = resolvePlaywright().source;
    } catch {
      // playwright not resolvable — fine for a dry-run
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          url: resolvedUrl,
          manifest: manifestPath,
          steps: scenario.steps.length,
          gif: scenario.gif ? scenario.gif.name : null,
          playwright: playwrightSource,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  fs.mkdirSync(args.out, { recursive: true });

  let launched = false;
  let stopFn = null;
  if (manifest) {
    const handle = await launchFromManifest(manifestPath, manifest);
    stopFn = handle.stop;
    launched = true;
  }

  try {
    const resolvedPlaywright = resolvePlaywright();
    const { chromium } = resolvedPlaywright.module;
    const playwrightSource = resolvedPlaywright.source;
    const wantsGif = Boolean(scenario.gif);
    const ffmpegAvailable = wantsGif ? hasFfmpeg() : false;
    let videoDir = null;
    if (wantsGif && ffmpegAvailable) {
      videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-video-"));
    }

    // SAFETY: headless: false は絶対に渡さない — 画面を奪うウィンドウを開く。
    const browser = await chromium.launch();
    const contextOptions = {
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.scale,
    };
    if (args.theme) contextOptions.colorScheme = args.theme;
    if (videoDir) {
      contextOptions.recordVideo = { dir: videoDir, size: { width: args.width, height: args.height } };
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    // NOTE: セレクタが存在しない失敗ステップを Playwright の既定 30s より
    // 早く exit 4 にするため、既定タイムアウトを短くしておく(scenario.json
    // の "wait" ステップはこれとは別の明示待ちなので影響を受けない)。
    // --timeout で上書き可能(goto や waitFor など timeout を明示しない
    // 呼び出しはすべてこの既定値に従う — Playwright の仕様)。
    page.setDefaultTimeout(args.timeout);

    const files = [];
    const startedAt = Date.now();
    try {
      for (let index = 0; index < scenario.steps.length; index += 1) {
        const step = scenario.steps[index];
        const shotRequest = await runStep(page, step, index, resolvedUrl);
        if (shotRequest) {
          const filePath = path.join(args.out, `${shotRequest.name}.png`);
          await page.screenshot({ path: filePath, ...shotRequest.options });
          files.push({ kind: "png", path: filePath, bytes: fs.statSync(filePath).size });
        }
      }
    } catch (error) {
      await context.close();
      await browser.close();
      if (error instanceof StepError) {
        process.stderr.write(
          `step ${error.stepIndex} failed (${JSON.stringify(error.step)}): ${error.message}\n`,
        );
        return 4;
      }
      throw error;
    }

    const measuredSeconds = (Date.now() - startedAt) / 1000;
    await context.close();

    let gifResult = null;
    if (wantsGif) {
      if (!ffmpegAvailable) {
        gifResult = { name: scenario.gif.name, status: "skipped", reason: "ffmpeg not found on PATH" };
      } else {
        const webmFiles = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
        if (webmFiles.length === 0) {
          gifResult = { name: scenario.gif.name, status: "skipped", reason: "no video recorded" };
        } else {
          const webmPath = path.join(videoDir, webmFiles[0]);
          const gifPath = path.join(args.out, `${scenario.gif.name}.gif`);
          ffmpegToGif(webmPath, gifPath, { fps: args.gifFps, width: args.gifWidth });
          const seconds = gifDurationSeconds(gifPath, measuredSeconds);
          const bytes = fs.statSync(gifPath).size;
          gifResult = {
            name: scenario.gif.name,
            status: "ok",
            path: gifPath,
            bytes,
            seconds,
            fps: args.gifFps,
            width: args.gifWidth,
          };
          files.push({ kind: "gif", path: gifPath, bytes });
          if (!args.keepVideo) {
            fs.rmSync(webmPath, { force: true });
          }
        }
      }
      if (videoDir) fs.rmSync(videoDir, { recursive: true, force: true });
    }

    await browser.close();

    const warnings = [];
    for (const file of files) {
      if (file.bytes > 8 * 1024 * 1024) {
        warnings.push(`${path.basename(file.path)} is ${file.bytes} bytes, over the 8MB .wu-shot budget`);
      }
    }
    if (gifResult && gifResult.status === "ok" && gifResult.seconds > 8) {
      warnings.push(`${scenario.gif.name}.gif is ${gifResult.seconds.toFixed(1)}s, over the 8s GIF budget`);
    }

    const summary = {
      url: resolvedUrl,
      launched,
      playwright: playwrightSource,
      out: args.out,
      files: files.map((f) => ({ kind: f.kind, path: f.path, bytes: f.bytes })),
      gif: gifResult,
      warnings,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } finally {
    // capture.mjs が自分で起動したプロジェクトは自分で片付ける — 撮影後に
    // 常駐プロセスを残さない(成功・ステップ失敗・例外のどの経路でも通す)。
    if (launched && stopFn) stopFn();
  }
}

// import 時に main() を自動実行しない — テストが nodeVersionOk 等の純関数
// だけを import できるようにするためのエントリポイントガード。
// `node bin/capture.mjs ...` でも `bin/ui-capture`(node capture.mjs を
// exec するだけ)でも process.argv[1] はこのファイル自身のパスになるので
// isMain は true のまま。
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error) => {
      if (
        error instanceof UsageError ||
        error instanceof ScenarioError ||
        error instanceof ManifestExistsError
      ) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      if (error instanceof PlaywrightNotFoundError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 3;
        return;
      }
      if (error instanceof LaunchError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 5;
        return;
      }
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
