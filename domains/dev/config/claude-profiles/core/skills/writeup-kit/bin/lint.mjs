#!/usr/bin/env node
// lint.mjs — the writeup-kit prose gate CLI. Zero-dependency Node port of
// natural-japanese's scripts/lint.py; see bin/lib/lint/index.mjs for the
// detector orchestration and bin/lib/tokenize.mjs for the one place that
// touches the morphological analyzer.
//
// This is a lint, not a CI gate: exit code is 0 whenever it successfully
// analyzed the file, regardless of how many findings it reports. Judging
// findings (fix vs. keep-with-reason) is left to the caller. Exit 1 means
// the input itself couldn't be read; exit 2 means `.writeup.toml` is
// malformed.

import path from "node:path";
import fs from "node:fs";
import { readSourceFile, extractTextFromHtml } from "./lib/text.mjs";
import { loadWriteupConfig } from "./lib/lint/config.mjs";
import { runLint, validateBaselineData, computeBaselineDiff, GENRE_PROFILES } from "./lib/lint/index.mjs";

const SEVERITY_LABEL = { info: "情報", warn: "警告", error: "エラー", critical: "重大" };
const STATUS_LABEL = { new: "新規", persisting: "継続" };

function parseArgs(argv) {
  const args = { file: null, json: false, baseline: null, config: null, surfaceOnly: false, experimental: false, genre: null, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--json":
        args.json = true;
        break;
      case "--surface-only":
        args.surfaceOnly = true;
        break;
      case "--experimental":
        args.experimental = true;
        break;
      case "--baseline":
        args.baseline = argv[++i];
        break;
      case "--config":
        args.config = argv[++i];
        break;
      case "--genre":
        args.genre = argv[++i];
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        positional.push(a);
    }
  }
  args.file = positional[0] ?? null;
  return args;
}

function printUsage() {
  console.error(
    [
      "使い方: node bin/lint.mjs <file.md|.html|.txt> [options]",
      "",
      "options:",
      "  --json                機械可読な JSON で出力する",
      "  --baseline <prev.json> 前回の --json 出力と比較し resolved/new/persisting を判定する",
      "  --config <path>       .writeup.toml の場所を指定する（未指定時は cwd/.writeup.toml）",
      "  --surface-only        表層6検出器 + 文長/括弧カウンタのみ実行する（作業メモ用）",
      "  --experimental        まだ定量校正されていない検出器の finding も出力する",
      `  --genre <name>        ${Object.keys(GENRE_PROFILES).join("/")} のいずれか`,
      "",
      "終了コード: 0 = 実行成功（finding件数に関わらず）, 1 = 入力エラー, 2 = 設定エラー",
    ].join("\n")
  );
}

function printHumanReport(filePath, findings, stats, baselineSummary) {
  console.log(`=== lint: ${filePath} ===`);
  console.log(`検出件数: ${stats.totalFindings}`);
  const categories = Object.entries(stats.byCategory);
  if (categories.length) {
    console.log("カテゴリ別内訳:");
    for (const [cat, count] of categories.sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${cat}: ${count}`);
    }
  }
  if (baselineSummary) {
    console.log(`ベースライン比較: 解消: ${baselineSummary.resolved}件 / 新規: ${baselineSummary.new}件 / 継続: ${baselineSummary.persisting}件`);
  }
  console.log("");

  if (!findings.length) {
    console.log("検出なし。");
    return;
  }

  for (const f of findings) {
    const label = SEVERITY_LABEL[f.severity] ?? f.severity;
    const statusTag = f.status ? `[${STATUS_LABEL[f.status] ?? f.status}] ` : "";
    console.log(`${statusTag}[${label}] L${f.span.line} (${f.category})`);
    console.log(`    該当箇所: ${f.excerpt}`);
    if (f.message) console.log(`    詳細    : ${f.message}`);
    if (f.suggestion) console.log(`    提案    : ${f.suggestion}`);
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    printUsage();
    return args.help ? 0 : 1;
  }

  const filePath = path.resolve(args.file);
  const { text, error } = readSourceFile(filePath);
  if (error) {
    console.error(error);
    return 1;
  }

  const ext = path.extname(filePath).toLowerCase();
  const linted = ext === ".html" || ext === ".htm" ? extractTextFromHtml(text) : text;

  let configPath = null;
  if (args.config) {
    configPath = path.resolve(args.config);
    if (!fs.existsSync(configPath)) {
      console.error(`エラー: --config ファイルが見つかりません: ${args.config}`);
      return 1;
    }
  } else {
    const defaultPath = path.resolve(process.cwd(), ".writeup.toml");
    if (fs.existsSync(defaultPath)) configPath = defaultPath;
  }
  const { config, errors: configErrors } = loadWriteupConfig(configPath);
  if (configErrors.length) {
    for (const e of configErrors) console.error(e);
    return 2;
  }

  if (args.genre && !Object.prototype.hasOwnProperty.call(GENRE_PROFILES, args.genre)) {
    console.error(`エラー: --genre は ${Object.keys(GENRE_PROFILES).join("/")} のいずれかである必要があります`);
    return 2;
  }

  let baselineData = null;
  if (args.baseline) {
    const baselinePath = path.resolve(args.baseline);
    if (!fs.existsSync(baselinePath)) {
      console.error(`エラー: --baseline ファイルが見つかりません: ${args.baseline}`);
      return 1;
    }
    let loadedBaseline;
    try {
      loadedBaseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
    } catch (exc) {
      console.error(`エラー: --baseline ファイルを読み込めません: ${args.baseline} (${exc.message})`);
      return 1;
    }
    const { data, warnings } = validateBaselineData(loadedBaseline);
    for (const w of warnings) console.error(`警告: ${w}`);
    baselineData = data;
  }

  const { findings, stats } = await runLint(linted, {
    genre: args.genre || undefined,
    experimental: args.experimental,
    surfaceOnly: args.surfaceOnly,
    disabledRules: config.disabledRules,
    allowList: config.allowList,
  });

  let resolved = [];
  let baselineSummary = null;
  if (baselineData) {
    const diff = computeBaselineDiff(findings, baselineData);
    resolved = diff.resolved;
    baselineSummary = diff.summary;
  }

  if (args.json) {
    const output = { file: args.file, stats, findings };
    if (baselineSummary) {
      output.baseline = { file: args.baseline, summary: baselineSummary, resolved };
    }
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHumanReport(args.file, findings, stats, baselineSummary);
  }

  // lint であって CI ゲートではない: finding の件数に関わらず exit 0。
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
