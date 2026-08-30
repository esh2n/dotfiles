// main.mjs — the "am I the entry point" check every CLI uses to decide
// whether to run its main() when loaded, vs. just export functions when
// another module imports it.
//
// The naive check is `process.argv[1] === fileURLToPath(import.meta.url)`,
// but it breaks when the script is reached through a symlink: this kit is
// normally invoked via `~/.claude/skills/writeup-kit`, a symlink into this
// repo. `process.argv[1]` keeps the symlinked path Node was told to run,
// while `import.meta.url` resolves to the realpath of the file — so the
// strings never match, the guard is false, and the CLI silently exits 0
// having done nothing. Comparing realpaths on both sides fixes it.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function isMain(importMetaUrl) {
  const argvPath = resolve(process.argv[1] ?? '')
  let argvReal
  try {
    argvReal = realpathSync(argvPath)
  } catch {
    argvReal = argvPath
  }
  const modulePath = fileURLToPath(importMetaUrl)
  let moduleReal
  try {
    moduleReal = realpathSync(modulePath)
  } catch {
    moduleReal = modulePath
  }
  return argvReal === moduleReal
}
