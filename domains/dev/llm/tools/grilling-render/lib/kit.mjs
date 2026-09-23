// writeup-kit の在り処を解決する。
// grilling は writeup-kit がサイドにあればページ意匠と図の検証をそこに委譲し、
// 無ければ自前のフォールバック（../template/style.css・./diagram.mjs）を使う。
// kit の bin/lib/*.mjs は別エージェントが同時に編集している可能性があるため、
// コピーはせず実行時にパスから動的 import する（import() は URL ごとに
// キャッシュされるので、失敗した import だけは再試行できるよう明示的に外す）。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url)) // .../grilling/render/lib
const SKILL_DIR = join(HERE, '..', '..') // .../grilling
// grilling skill dir のきょうだいに置かれた writeup-kit（core/skills/writeup-kit）。
const SIBLING_CANDIDATE = join(SKILL_DIR, '..', 'writeup-kit')
const HOME_CANDIDATE = join(homedir(), '.claude', 'skills', 'writeup-kit')

function isValidKitDir(dir) {
  return Boolean(dir) && existsSync(join(dir, 'kit', 'writeup.css'))
}

/**
 * writeup-kit の在り処を解決する。解決順は「grilling のきょうだいディレクトリ
 * (sibling) → ~/.claude/skills/writeup-kit → null（無し）」。
 *
 * @param {string|null} [override] テスト・呼び出し元からの明示指定。
 *   `null` は「無いものとして扱え」の明示指定（フォールバック経路のテスト用）。
 *   文字列ならそのパスをそのまま検証して使う。省略時のみ自動判定する。
 */
export function kitDir(override) {
  if (override === null) return null
  if (typeof override === 'string') return isValidKitDir(override) ? override : null
  if (isValidKitDir(SIBLING_CANDIDATE)) return SIBLING_CANDIDATE
  if (isValidKitDir(HOME_CANDIDATE)) return HOME_CANDIDATE
  return null
}

/** kit の `kit/writeup.css` を読む。kit が無ければ null。 */
export async function kitCss(override) {
  const dir = kitDir(override)
  if (!dir) return null
  return await readFile(join(dir, 'kit', 'writeup.css'), 'utf8')
}

// url -> Promise<module>。失敗した import はキャッシュに残さず、次回また試みる
// （他エージェントの編集が一時的に構文エラーを作っていても、直れば復帰する）。
const moduleCache = new Map()

async function importFromKit(override, relPath) {
  const dir = kitDir(override)
  if (!dir) return null
  const url = pathToFileURL(join(dir, relPath)).href
  if (!moduleCache.has(url)) moduleCache.set(url, import(url))
  try {
    return await moduleCache.get(url)
  } catch (e) {
    moduleCache.delete(url)
    throw e
  }
}

/**
 * kit の `bin/lib/verify-diagram.mjs` から `renderFigureHtmlChecked` を取る。
 * kit が無い、または import に失敗したら null（呼び出し側はフォールバックする）。
 */
export async function loadKitRenderFigureHtmlChecked(override) {
  try {
    const mod = await importFromKit(override, join('bin', 'lib', 'verify-diagram.mjs'))
    return mod ? mod.renderFigureHtmlChecked : null
  } catch {
    return null
  }
}

/**
 * kit の `bin/lib/yaml-lite.mjs` から `parse` を取る。
 * kit が無い、または import に失敗したら null。
 */
export async function loadKitYamlParse(override) {
  try {
    const mod = await importFromKit(override, join('bin', 'lib', 'yaml-lite.mjs'))
    return mod ? mod.parse : null
  } catch {
    return null
  }
}
