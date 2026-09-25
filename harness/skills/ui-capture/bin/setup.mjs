#!/usr/bin/env node
// ui-capture の共有インストールを用意する(マシンごとに一度)。ui-capture
// の設計 決定点2(案a)の実装: Node でないプロダクト(Go・Swift 等)でも
// 撮れるよう、~/.local/share/ui-capture/ に playwright(版固定)と
// Chromium(同ディレクトリ内の browsers/)を揃える。
//
// npm 本体と Chromium は必ず版が一致していなければならない — この2つを
// 1ディレクトリに閉じ、setup.mjs だけが両方を書き換えることで一致を保証
// する(nix と npm の二重管理は事故の温床になるため対案 b は不採用)。
//
// 冪等: 既に同じ版が入っていれば npm install / chromium install を
// スキップする。--upgrade は再実行を強制する。--playwright <version> は
// --upgrade と一緒のときだけ版を上げる(それ単独では使えない)。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PLAYWRIGHT_VERSION = "1.61.1";
const MIN_NODE_MAJOR = 22;

const SHARED_DIR = path.join(os.homedir(), ".local", "share", "ui-capture");
const NODE_MODULES_DIR = path.join(SHARED_DIR, "node_modules");
const PLAYWRIGHT_MODULE_DIR = path.join(NODE_MODULES_DIR, "playwright");
const BROWSERS_DIR = path.join(SHARED_DIR, "browsers");
const PACKAGE_JSON_PATH = path.join(SHARED_DIR, "package.json");
const META_PATH = path.join(SHARED_DIR, "meta.json");

class SetupError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function nodeMajorVersion(version = process.version) {
  const match = /^v(\d+)\./.exec(version);
  return match ? Number(match[1]) : NaN;
}

function parseArgs(argv) {
  const args = { upgrade: false, playwright: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--upgrade") {
      args.upgrade = true;
    } else if (flag === "--playwright") {
      i += 1;
      args.playwright = argv[i];
    } else {
      throw new SetupError(`unknown flag: ${flag}`, 2);
    }
  }
  if (args.playwright && !args.upgrade) {
    throw new SetupError("--playwright requires --upgrade", 2);
  }
  return args;
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, "utf8"));
  } catch {
    return null;
  }
}

function hasCommand(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function npmInstallPlaywright(version) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
  if (!fs.existsSync(PACKAGE_JSON_PATH)) {
    fs.writeFileSync(
      PACKAGE_JSON_PATH,
      `${JSON.stringify({ name: "ui-capture-shared", private: true }, null, 2)}\n`,
    );
  }
  const result = spawnSync(
    "npm",
    ["install", `playwright@${version}`, "--no-audit", "--no-fund", "--save-exact"],
    { cwd: SHARED_DIR, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new SetupError(
      `npm install playwright@${version} failed in ${SHARED_DIR} (exit ${result.status})`,
      8,
    );
  }
}

function installChromium() {
  const playwrightCli = path.join(NODE_MODULES_DIR, ".bin", "playwright");
  fs.mkdirSync(BROWSERS_DIR, { recursive: true });
  const result = spawnSync(playwrightCli, ["install", "chromium"], {
    cwd: SHARED_DIR,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR },
  });
  if (result.status !== 0) {
    throw new SetupError(
      `playwright install chromium failed (exit ${result.status}, PLAYWRIGHT_BROWSERS_PATH=${BROWSERS_DIR})`,
      9,
    );
  }
}

function installedPlaywrightVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PLAYWRIGHT_MODULE_DIR, "package.json"), "utf8"),
    );
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function du(dirPath) {
  const result = spawnSync("du", ["-sk", dirPath]);
  if (result.status !== 0) return null;
  const kb = Number(result.stdout.toString().trim().split(/\s+/)[0]);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (nodeMajorVersion() < MIN_NODE_MAJOR) {
    throw new SetupError(
      `bin/setup.mjs requires Node ${MIN_NODE_MAJOR}+ (running under ${process.version}). ` +
        "Run it with a newer node, e.g. `corepack` or mise's global Node, before pinning " +
        "an older one in this shell.",
      6,
    );
  }

  if (!hasCommand("npm")) {
    throw new SetupError(
      "npm not found on PATH. ui-capture's shared install needs npm to fetch " +
        "playwright — install Node (which bundles npm) and retry.",
      7,
    );
  }

  const targetVersion = args.playwright ?? DEFAULT_PLAYWRIGHT_VERSION;
  const existingMeta = readMeta();
  const existingVersion = installedPlaywrightVersion();
  const alreadyInstalled =
    !args.upgrade &&
    existingVersion === targetVersion &&
    fs.existsSync(BROWSERS_DIR) &&
    fs.readdirSync(BROWSERS_DIR).length > 0;

  let action;
  if (alreadyInstalled) {
    action = "already-installed";
  } else {
    action = existingMeta ? "reinstalled" : "installed";
    npmInstallPlaywright(targetVersion);
    installChromium();
  }

  const finalVersion = installedPlaywrightVersion() ?? targetVersion;
  const meta = {
    node: process.execPath,
    nodeVersion: process.version,
    playwright: finalVersion,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);

  const summary = {
    action,
    sharedDir: SHARED_DIR,
    playwright: finalVersion,
    node: meta.node,
    nodeVersion: meta.nodeVersion,
    playwrightModuleBytes: du(PLAYWRIGHT_MODULE_DIR),
    browsersBytes: du(BROWSERS_DIR),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    if (error instanceof SetupError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
