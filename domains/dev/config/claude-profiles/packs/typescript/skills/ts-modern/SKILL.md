---
name: ts-modern
description: Use when writing or reviewing TypeScript or JavaScript and a legacy idiom appears — `as` casts or wide annotations that lose inference, try/finally cleanup, `slice().sort()` mutation dances, `JSON.parse(JSON.stringify(x))` cloning, `reduce` grouping boilerplate, hand-built deferred promises, `require`, bare `fs`/`path` imports, axios for a plain HTTP call, or filter-based set intersection. Covers satisfies, using, toSorted, structuredClone, groupBy, node: imports.
metadata:
  verified: 2026-08
---

# Modern TypeScript / JavaScript

## Overview

TypeScript 7.0 (stable since July 2026, Go-native compiler) and Node 24 Active
LTS / Node 26 Current are the baseline. Models emit ES2017-era JavaScript with
TS 4.x-era types: `as` casts, `JSON.parse(JSON.stringify())`, `reduce`
groupings, axios reflexes. Each has a current form — but the third column is
where the review value is.

Check `engines`, `tsconfig` `target`/`lib`, and `type: module` before applying
anything here. **A rewrite correct for Node 24 is a crash on Node 18.**

## Replacement Table

| Legacy default models emit | Current form | When the legacy form is still right |
|---|---|---|
| `const cfg = {...} as Config` or `const cfg: Config = {...}` — the first lies, the second widens literals | `const cfg = {...} satisfies Config` — checks against the type, keeps the narrow inferred one | You genuinely want the wide type (a mutable field reassigned later to another member of the union). `as` remains correct only for real assertions the compiler cannot see (a validated `unknown`, a DOM cast) |
| `function f<T extends string[]>(x: T)` called with a spread that widens to `string[]` | `const` type parameters: `function f<const T extends readonly string[]>(x: T)` | Caller must pass a mutable array; `const` inference makes it `readonly`, which will surface as an error downstream |
| `const c = await open(); try { … } finally { await c.close(); }` | `await using c = await open();` (`Symbol.asyncDispose`) / `using` for sync | **Not Baseline** — see below. Also when cleanup must happen at a different scope than the declaration, or is conditional. `try/finally` stays correct for non-resource cleanup |
| `arr[arr.length - 1]`, `arr.slice().sort()`, `[...arr].reverse()`, `arr.map((v,i)=>i===n?x:v)` | `.at(-1)`, `.toSorted()`, `.toReversed()`, `.with(n, x)`, `.toSpliced()` | In-place mutation is the point (a hot loop reusing one buffer, or a large array where the copy is the cost). `toSorted` still needs a comparator for numbers |
| `JSON.parse(JSON.stringify(obj))` | `structuredClone(obj)` — handles Date, Map, Set, TypedArray, cycles | You *want* the JSON round-trip's lossiness: stripping functions/undefined to produce a wire-safe payload. `structuredClone` throws on functions, DOM nodes, and class prototypes are lost either way |
| `arr.reduce((acc, x) => { (acc[k(x)] ??= []).push(x); return acc; }, {})` | `Object.groupBy(arr, k)` (string keys, null-prototype) or `Map.groupBy(arr, k)` (any key) | Grouping while also transforming or aggregating (sums, counts) — `groupBy` only buckets. Note `Object.groupBy` returns a **partial** record type, so lookups are `T[] \| undefined` |
| `let resolve; const p = new Promise(r => { resolve = r });` + a `!` assertion | `const { promise, resolve, reject } = Promise.withResolvers<T>()` | Nothing meaningful — this one is a straight win where supported (Node 22+, all evergreen browsers) |
| An async IIFE wrapping the whole module body | Top-level `await` | CJS, or any file that must remain synchronously importable. TLA makes the module async, which can serialize a startup path — do not put a slow fetch at the top of a hot import |
| `import fs from 'fs'`, `import { join } from 'path'` | `import fs from 'node:fs/promises'`, `import { join } from 'node:path'` | Code that must also run in a bundler targeting a browser polyfill that keys on the bare specifier. Otherwise always prefix: it is unambiguous and unshadowable by an npm package |
| `axios`/`node-fetch` + a manual `setTimeout` + `AbortController` for a plain JSON GET | Native `fetch` + `AbortSignal.timeout(ms)` (and `AbortSignal.any([...])` to combine) | Interceptors, automatic retries, progress events, or proxy config that you would otherwise reimplement — that is what a client library is for. Also: `fetch` does not reject on 4xx/5xx, so the `res.ok` check is not optional |
| `require()` / `module.exports`, `__dirname` | ESM, `import.meta.dirname` (Node 20.11+), `import.meta.url` | Consumers on CJS-only tooling; a library whose install base includes CJS builds — ship dual output rather than breaking them. Jest configs and some plugin systems still need CJS |
| `JSON.parse(readFileSync(new URL('./x.json', import.meta.url)))` | `import data from './x.json' with { type: 'json' }` (TS 5.3+, Node 20.10+) | Path known only at runtime, or a bundler in the chain without import-attribute support — check before switching |
| `new Set([...a].filter(x => b.has(x)))`, `new Set([...a, ...b])` | `a.intersection(b)`, `a.union(b)`, `difference`, `symmetricDifference`, `isSubsetOf` | Targets older than Node 22 / mid-2024 browsers. These are Baseline newly available (June 2024), not yet widely available |

## Support Caveats Worth Checking Before You Rewrite

- **`using` / `await using`** — Stage 4, part of ES2026. Runtime support:
  Node 24+ (V8 13.6), Chromium 134+, Firefox 134+; **Safari has not shipped
  it**, so it is not Baseline. TypeScript 5.2+ downlevels it (needs
  `Symbol.dispose` polyfill below ES2022 lib). Safe server-side on Node 24+,
  risky for browser bundles without transpilation.
- **`Object.groupBy` / `Map.groupBy` / `Promise.withResolvers`** — Baseline
  newly available (2024); Node 21+/22+. Fine for evergreen and current Node.
- **Set methods** — Baseline newly available June 2024; Node 22+.
- **Toolchain** — TS 7.0 is the Go-native compiler (~10x faster than 6.0).
  It drops some long-deprecated options; if a repo is on 5.x, do not assume
  a 7.0 flag exists. Verify against the repo's installed version, not the latest.

## Common Mistakes

- **`satisfies` used where a real assertion was needed.** It cannot widen or
  force a type; if the value genuinely does not match, `satisfies` errors (which
  is usually correct — do not "fix" it by switching back to `as`).
- **`satisfies` on a value that must stay assignable to a wider variable.**
  `const routes = {...} satisfies Routes` gives literal types; assigning it to a
  `Routes`-typed mutable field later loses the benefit anyway.
- **`toSorted()` without a comparator on numbers.** Same lexicographic trap as
  `sort()`: `[10, 9].toSorted()` is `[10, 9]`.
- **`structuredClone` on objects holding functions, class instances, or DOM
  nodes.** It throws (`DataCloneError`) or silently drops the prototype.
- **`Object.groupBy` result treated as fully populated.** The type is
  `Partial<Record<K, T[]>>`; index access needs a guard.
- **`await using` on something whose `Symbol.asyncDispose` is missing.** It
  fails at runtime, not compile time, if the object is typed loosely.
- **`node:` prefix inside code also targeting the browser.** Bundlers will not
  shim it — that is the intent, but it means the failure moves to build time.
- **`AbortSignal.timeout` confused with a retry.** It aborts once; combine with
  `AbortSignal.any([userSignal, AbortSignal.timeout(5000)])` to respect both.
- **Top-level await in a module imported by a CJS consumer.** `require()` of an
  ESM module with TLA fails; Node 22+ can require ESM only when it has no TLA.

## Related

- `nestjs-patterns` — backend module/provider structure
- `e2e-testing` — Playwright patterns
- `mcp-server-patterns` — MCP servers with the TypeScript SDK
