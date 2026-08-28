// config.mjs — loads and validates `.writeup.toml`'s `[lint]` and
// `[[allow]]` sections (contract §6: "設定は store/.writeup.toml。[[allow]]
// は category + text + reason 必須").
//
// Any structural problem (unknown top-level section, unknown key inside a
// known section, a missing required `[[allow]]` field, or a wrong value
// type) is a config error: the caller exits(2), same as an unparseable
// TOML file. This is stricter than most lint config loaders on purpose —
// a store's `.writeup.toml` is small and hand-edited, so silently ignoring
// a typo'd key is worse than refusing to run.

import fs from "node:fs";
import { parseToml, TomlParseError } from "../toml-lite.mjs";

const LINT_TABLE_KEYS = new Set(["disabled_rules", "fail_on"]);
const ALLOW_ENTRY_KEYS = new Set(["category", "text", "reason"]);
const KNOWN_TOP_LEVEL_SECTIONS = new Set(["lint", "allow"]);
const KNOWN_FAIL_ON_VALUES = new Set(["info", "warn", "error", "critical"]);

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

  for (const section of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL_SECTIONS.has(section)) {
      errors.push(`エラー: 未知の設定セクション [${section}]（${configPath}）`);
    }
  }

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
