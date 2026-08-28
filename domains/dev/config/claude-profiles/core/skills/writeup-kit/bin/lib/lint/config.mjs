// config.mjs — loads and validates `.writeup.toml`'s `[lint]` and
// `[[allow]]` sections (contract §6: "設定は store/.writeup.toml。[[allow]]
// は category + text + reason 必須").
//
// The store's `.writeup.toml` is a SHARED file (contract §6, §8): besides
// `[lint]`/`[[allow]]` it also carries `[private]` (publish's word list)
// and `[cloudflare]` (publish's project/access settings). This loader only
// owns the lint-relevant sections, so any top-level section other than
// `lint`/`allow` is a foreign section owned by another tool and is ignored
// silently — it is neither validated nor rejected. Within the sections this
// loader does own, it stays strict: an unknown key inside `[lint]`, an
// unknown key inside an `[[allow]]` entry, a missing required `[[allow]]`
// field, or a wrong value type is a config error and the caller exits(2),
// same as an unparseable TOML file. A store's `.writeup.toml` is small and
// hand-edited, so silently ignoring a typo'd key *within a section this
// tool owns* is worse than refusing to run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToml, TomlParseError } from "../toml-lite.mjs";

const LINT_TABLE_KEYS = new Set(["disabled_rules", "fail_on"]);
const ALLOW_ENTRY_KEYS = new Set(["category", "text", "reason"]);
const KNOWN_FAIL_ON_VALUES = new Set(["info", "warn", "error", "critical"]);
const CONFIG_FILE_NAME = ".writeup.toml";

/**
 * Finds the `.writeup.toml` that applies to a page when `--config` was not
 * given. Search order:
 *   1. `startDir` itself, then each ancestor directory, up to and including
 *      `$HOME` (or the filesystem root, if `startDir` isn't under `$HOME`).
 *   2. `$WRITEUP_STORE/.writeup.toml`, if the `WRITEUP_STORE` env var is set.
 * Returns the first path that exists, or `null` if none does.
 */
export function discoverConfigPath(startDir) {
  const home = os.homedir();
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === home) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  if (process.env.WRITEUP_STORE) {
    const storeCandidate = path.join(process.env.WRITEUP_STORE, CONFIG_FILE_NAME);
    if (fs.existsSync(storeCandidate)) return storeCandidate;
  }

  return null;
}

/**
 * Loads `configPath` if it exists. Returns `{ config, errors }`:
 *   - `errors` is a non-empty array of Japanese error messages when the
 *     file is malformed (parse error, unknown key, invalid allow entry) —
 *     the caller should print them and exit(2).
 *   - When `configPath` doesn't exist at all, returns the default empty
 *     config with no errors (a store without `.writeup.toml` just runs
 *     with no disabled rules / no allowlist).
 */
export function loadWriteupConfig(configPath) {
  const empty = { disabledRules: [], allowList: [], failOn: null };
  if (!configPath || !fs.existsSync(configPath)) {
    return { config: empty, errors: [] };
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (exc) {
    return { config: empty, errors: [`エラー: 設定ファイルを読み込めません: ${configPath} (${exc.message})`] };
  }

  let parsed;
  try {
    parsed = parseToml(raw);
  } catch (exc) {
    if (exc instanceof TomlParseError) {
      return { config: empty, errors: [`エラー: 設定ファイルの構文が不正です: ${configPath} (${exc.message})`] };
    }
    throw exc;
  }

  const errors = [];

  // Top-level sections other than `lint`/`allow` (e.g. publish's `[private]`
  // and `[cloudflare]`) belong to another tool sharing this same file —
  // ignore them silently rather than treating them as errors.

  let disabledRules = [];
  let failOn = null;
  const lintTable = parsed.lint;
  if (lintTable && typeof lintTable === "object" && !Array.isArray(lintTable)) {
    for (const key of Object.keys(lintTable)) {
      if (!LINT_TABLE_KEYS.has(key)) {
        errors.push(`エラー: [lint] に未知のキー "${key}" があります（${configPath}）`);
      }
    }
    if (lintTable.disabled_rules !== undefined) {
      if (!Array.isArray(lintTable.disabled_rules) || !lintTable.disabled_rules.every((v) => typeof v === "string")) {
        errors.push(`エラー: [lint].disabled_rules は文字列の配列である必要があります（${configPath}）`);
      } else {
        disabledRules = lintTable.disabled_rules;
      }
    }
    if (lintTable.fail_on !== undefined) {
      if (typeof lintTable.fail_on !== "string" || !KNOWN_FAIL_ON_VALUES.has(lintTable.fail_on)) {
        errors.push(
          `エラー: [lint].fail_on は ${[...KNOWN_FAIL_ON_VALUES].join("/")} のいずれかである必要があります（${configPath}）`
        );
      } else {
        failOn = lintTable.fail_on;
      }
    }
  }

  const allowList = [];
  const allowEntries = Array.isArray(parsed.allow) ? parsed.allow : [];
  for (const [idx, entry] of allowEntries.entries()) {
    for (const key of Object.keys(entry)) {
      if (!ALLOW_ENTRY_KEYS.has(key)) {
        errors.push(`エラー: [[allow]] #${idx + 1} に未知のキー "${key}" があります（${configPath}）`);
      }
    }
    const missing = [...ALLOW_ENTRY_KEYS].filter((k) => typeof entry[k] !== "string" || entry[k] === "");
    if (missing.length) {
      errors.push(
        `エラー: [[allow]] #${idx + 1} に必須項目（${missing.join(", ")}）がありません。` +
          `category・text・reason はすべて必須です（${configPath}）`
      );
      continue;
    }
    allowList.push({ category: entry.category, text: entry.text, reason: entry.reason });
  }

  return { config: { disabledRules, allowList, failOn }, errors };
}

/** True when `finding` matches an `[[allow]]` entry (same category, and the
 * allow entry's `text` is a substring of the finding's excerpt). */
export function isAllowed(finding, allowList) {
  return allowList.some((a) => a.category === finding.category && finding.excerpt.includes(a.text));
}
