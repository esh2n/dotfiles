# TypeScript / JavaScript review standard

The one TypeScript and JavaScript standard for both the model writing TS/JS
and `code-reviewer` reviewing a TS/JS diff. It lists what to check and where
the rule comes from; detail and code live in the skills it links:
`typescript-patterns` (types on public APIs, `unknown` errors, Zod
validation, envelope, repository), `ts-modern` (version-gated replacements),
`typescript-testing` (E2E), `nestjs-patterns` (NestJS backends). React
component logic (hooks, rendering, server/client boundaries, accessibility)
is out of scope here: read `react-patterns`, `react-performance` and
`react-testability` for `.tsx`/`.jsx`.

Before applying any rule, read `engines` and `type` in `package.json`, the
runtime actually used (Node, Bun, Deno, workerd, browser), and
`target`/`lib`/`module`/`moduleResolution`/`strict` in the `tsconfig` that
owns the changed files. A rule gated on a version does not apply below it,
and a rewrite correct for Node 24 can crash on an older floor.

Sources are cited by the short name in the first column of section 1; a
quoted topic after it (for example GTS "Empty catch blocks") names the part
of that page to search for.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| TSC | TSConfig reference | https://www.typescriptlang.org/tsconfig/ | `strict` family, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | Tracks 6.0 defaults (`strict: true`); fetched 2026-10-19 | CC BY 4.0 (microsoft/TypeScript-Website) |
| HB | TypeScript Handbook: Narrowing, Everyday Types, Type Compatibility, Enums, Do's and Don'ts | https://www.typescriptlang.org/docs/handbook/2/narrowing.html, https://www.typescriptlang.org/docs/handbook/2/everyday-types.html, https://www.typescriptlang.org/docs/handbook/type-compatibility.html, https://www.typescriptlang.org/docs/handbook/enums.html, https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html | Narrowing and exhaustiveness, assertions have no runtime effect, structural typing, `as const` objects vs enums, wrapper types | Narrowing page updated 2026-10-16 | CC BY 4.0 |
| REL | TypeScript release notes 4.9, 5.0, 5.2, 5.5, 5.8 | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html (and `-5-0`, `-5-2`, `-5-5`, `-5-8`) | `satisfies`, `const` type parameters, `verbatimModuleSyntax`, `using`, inferred type predicates, `isolatedDeclarations`, `erasableSyntaxOnly`, `require(esm)` | Per release | CC BY 4.0 |
| TS6 | Announcing TypeScript 6.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ | New defaults, deprecations, `es2025` target/lib | 2026-03-23 | Microsoft blog terms |
| TS7 | Announcing TypeScript 7.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ | Go-native compiler, removed options, no programmatic API until 7.1, typescript-eslint coexistence | 2026-07-08 (latest stable) | Microsoft blog terms |
| TSE | typescript-eslint shared configs, rule catalogue, typed linting | https://typescript-eslint.io/users/configs/, https://typescript-eslint.io/rules/, https://typescript-eslint.io/getting-started/typed-linting/ | `recommended`/`strict`/`stylistic` and `-type-checked` variants, rule membership | v8.71.2; `strict` is not semver-stable | MIT |
| ESL | ESLint core rule `no-await-in-loop` | https://eslint.org/docs/latest/rules/no-await-in-loop | When sequential `await` is wrong and when it is required | Current | MIT |
| GTS | Google TypeScript Style Guide | https://google.github.io/styleguide/tsguide.html | Naming, `any`, assertions, exceptions, empty catch, `export let`, default exports, namespaces, container classes, `@ts-ignore` | Undated, volunteer-pushed; fetched 2026-10-19 | CC BY 3.0 (google/styleguide) |
| MDN | MDN Web Docs: Execution model, Promise, Using promises, `forEach`, `sort`, `for...in`, `??`, `MAX_SAFE_INTEGER`, `JSON.parse`, `eval`, `innerHTML`, `fetch`, `structuredClone`, `Object.groupBy`, `Atomics` | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model and the pages named per item | Language and platform semantics | Execution model 2026-04-06, Promise 2026-09-14 | CC BY-SA 2.5 (prose) |
| NBLK | Node.js: Don't Block the Event Loop | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | Sync APIs, large JSON, ReDoS, partitioning and offloading | Current | MIT (nodejs/nodejs.org) |
| NSEC | Node.js: Security Best Practices | https://nodejs.org/en/learn/getting-started/security-best-practices | DoS, timing attacks, prototype pollution, supply chain, permission model | Current | MIT |
| NBP | Node.js: Backpressuring in Streams | https://nodejs.org/en/learn/modules/backpressuring-in-streams | `write()`/`'drain'`, `pipeline` | Current | MIT |
| NAPI | Node.js API docs: `child_process`, `process`, `worker_threads`, TypeScript | https://nodejs.org/api/child_process.html, https://nodejs.org/api/process.html, https://nodejs.org/api/worker_threads.html, https://nodejs.org/api/typescript.html | Shell injection warning, `unhandledRejection`, workers, type stripping | v26.12.0 | Node.js licence (MIT-style) |
| NREL | Node.js release lines | https://nodejs.org/en/about/previous-releases | Supported lines: 26 Current, 24 and 22 LTS | Fetched 2026-10-19 | MIT |
| OWN | OWASP Node.js Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html | Request size limits, input allowlists, flat promise chains, `child_process`, ReDoS, headers | Current | CC BY-SA 4.0 |
| OPT | OWASP Path Traversal | https://community.owasp.org/attacks/Path_Traversal | `../` escapes | Current (moved from owasp.org/www-community) | CC BY-SA 4.0 |
| CWE770 | CWE-770 Allocation of Resources Without Limits or Throttling | https://cwe.mitre.org/data/definitions/770.html | Unbounded fan-out, caches, buffering | CWE 4.20 | MITRE CWE terms of use |
| WPT | webpack Tree Shaking guide | https://webpack.js.org/guides/tree-shaking/ | ESM requirement, `sideEffects` | Current | CC BY 4.0 |
| BIO | Biome rule `noAccumulatingSpread` | https://biomejs.dev/linter/rules/no-accumulating-spread/ | O(n²) spread in accumulators | Since Biome 1.0 | MIT |
| V8 | V8 blog: Maglev | https://v8.dev/blog/maglev | Mid-tier optimizing JIT between Sparkplug and TurboFan (Chrome M117) | 2023-12-05 | Apache-2.0 (v8/v8.dev) |
| VIT | Vitest: Testing Types, Timers | https://vitest.dev/guide/testing-types, https://vitest.dev/guide/mocking/timers | `expectTypeOf`, `--typecheck`, fake timers | v5.0.5 | MIT |
| JEST | Jest: Testing Asynchronous Code | https://jestjs.io/docs/asynchronous | Return or `await` promises and `.resolves`/`.rejects` | Current | MIT |

Airbnb's JavaScript style guide predates ES2019 and TypeScript; do not cite
it for current practice.

## 2. Mindset

- Types are the design: model states as discriminated unions so invalid
  states do not type-check, and let `never` prove a `switch` exhaustive (HB
  Narrowing).
- Narrow, do not assert. `typeof`, `in`, `instanceof`, equality and type
  predicates change what the compiler knows; `as` and `!` only silence it and
  have no runtime effect (HB Everyday Types).
- Typing is structural: a value fits a type when its shape fits, whatever it
  was declared as. Excess-property checks apply only to fresh object
  literals (HB Type Compatibility).
- `unknown` at every boundary (JSON, `catch`, `process.env`, network), then
  validate; `any` switches checking off for everything it touches (HB
  Do's and Don'ts, GTS "any").
- Infer locals; annotate what others depend on (exports, public methods).
  `satisfies` checks a value against a type without widening it (REL 4.9).
- One thread runs JavaScript; every `await` is a point where other code runs
  and state may change (section 6).
- Prefer the platform and the standard library (`fetch`, `structuredClone`,
  `node:stream/promises`) over a dependency when the floor allows
  (`ts-modern`).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `enum` for every closed set (Java, C#) | String-literal union or an `as const` object; plain `enum` only for interop; never publish ambient `const enum` | HB Enums ("Objects vs Enums"), GTS ("must not use const enum"), REL 5.8 (`erasableSyntaxOnly`) |
| Nominal typing expected: "a `UserId` cannot be passed as an `OrderId`" (Java, C#, Rust) | Shapes are compatible structurally; use a branded type if distinctness matters | HB Type Compatibility |
| Classes holding only static methods, or `namespace` blocks, to group functions (Java, C#) | Export functions and constants from a module | GTS ("Container classes", "Namespaces") |
| `IUser` interface prefix, `_private` underscores (C#, Python) | No marker prefix; no leading or trailing underscores; use `private`/`#` | GTS ("Naming") |
| `x \|\| default` for "missing" (Python `or`, Ruby `\|\|`) | `x ?? default`; `\|\|` also replaces `0`, `""`, `false` | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing |
| `for (const i in arr)` (Python `for ... in`) | `for...of`, or an index loop; `for...in` yields string keys and inherited properties | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in, GTS |
| `arr.sort()` on numbers (Python `sorted`, Go `slices.Sort`) | Pass a comparator; default sort compares as strings and mutates in place (`toSorted` for a copy) | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort |
| 64-bit integer IDs as `number` (Go, Java `long`) | `string` or `bigint` above 2^53−1 | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER |
| Checked exceptions / typed `catch (FooException e)` (Java, C#) | `catch (e)` is `unknown` under `strict`; narrow with `instanceof` | TSC `useUnknownInCatchVariables` |
| `throw "message"` or throwing plain objects (scripting habits) | `throw new Error(...)` or a subclass; keeps the stack | GTS ("Exceptions"), TSE `only-throw-error` |
| `new String(...)`, `Number`/`Object` as types (Java boxing) | Primitives `string`/`number`/`boolean`, `object` or `unknown` | HB Do's and Don'ts, GTS ("Wrapper types") |
| Expecting a thread pool to run CPU work in parallel with requests (Java, Go) | CPU work blocks the single event loop; partition it or move it to `worker_threads` | NBLK, NAPI worker_threads |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might be
unsafe" is not a finding.

### 4.1 Correctness and types

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-any | New `any` (explicit, `as any`, untyped JSON) | `unknown` plus narrowing, a generic, or a precise type; a kept `any` carries a reason | `any` disables checking for everything downstream | HB Everyday Types, GTS "any", TSE `no-explicit-any`, `no-unsafe-*` |
| ts-assertion | `as T` on a value the compiler could not verify; `as unknown as T` | Narrow or validate instead; `as` is right only after a runtime check the compiler cannot see | No runtime check; a wrong assertion fails later, far away | HB Everyday Types, GTS "Type assertions" |
| ts-non-null | `x!` without a preceding guard | Add the guard or handle `undefined` | `!` is an assertion; it throws at the use site if wrong | HB Everyday Types, TSE `no-non-null-assertion` (strict) |
| ts-ts-ignore | `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` in production code | Fix the type; in tests, `@ts-expect-error` only with a reason | Hides the next real error on that line too | GTS "@ts-ignore" |
| ts-strict-weakened | `tsconfig` diff turning off `strict` or a family flag, adding `skipLibCheck` to silence errors | Call it out; require the reason | Weakens every file the config owns | TSC `strict` |
| ts-index-access | `arr[i]`, `record[key]`, `process.env.X` used as defined | Handle `undefined`; recommend `noUncheckedIndexedAccess` where absent | Index signatures claim a value exists when it may not | TSC `noUncheckedIndexedAccess` |
| ts-optional-undefined | Optional property assigned `undefined` explicitly, or `'k' in obj` used to mean "has value" | Decide absent vs `undefined`; `exactOptionalPropertyTypes` enforces the difference | `{k: undefined}` and `{}` differ for `in`, spread and `Object.keys` | TSC `exactOptionalPropertyTypes` |
| ts-exhaustive | `switch`/`if` chain over a union with a `default` that returns a value or nothing | `default` assigns to `never` (or TSE `switch-exhaustiveness-check`) | A new union member then fails to compile instead of falling through | HB Narrowing, TSE |
| ts-discriminated | Several optional fields whose combination encodes state (`loading?`, `error?`, `data?`) | Discriminated union with a literal `kind`/`status` | Impossible combinations become unrepresentable | HB Narrowing |
| ts-satisfies | `const x: T = {...}` that loses literal types, or `{...} as T` on a literal | `satisfies T`; see `ts-modern` for when the wide type is wanted | `as` skips the check; annotation widens | REL 4.9, `ts-modern` |
| ts-equality | `==`/`!=` except `== null` | `===`/`!==` | Coercion rules produce surprising matches | GTS "Equality checks" |
| ts-var-let | `var`, or `let` never reassigned | `const`, then `let` | `var` is function-scoped and hoisted | GTS "var" |
| ts-default-sort | `.sort()` with no comparator on numbers, or on an array the caller still owns | Comparator; `toSorted` when the input must not change | Lexicographic order; in-place mutation of a shared array | MDN Array/sort |
| ts-for-in-array | `for...in` over an array | `for...of` or index loop | String keys, inherited properties | MDN for...in, TSE `no-for-in-array` |
| ts-falsy-default | `\|\|` default on a value where `0`, `""` or `false` is valid | `??` | Valid values replaced | MDN Nullish_coalescing, TSE `prefer-nullish-coalescing` (stylistic) |
| ts-big-int-id | Integer IDs or amounts from an API that can exceed 2^53−1 parsed as `number` | `string` or `bigint` | Silent precision loss | MDN MAX_SAFE_INTEGER |
| ts-module-system | `require()` in an ESM file, `__dirname` in ESM, a `.ts` import without `type` when run by Node type stripping | Pick one system per file; `import type`; `import.meta.dirname` (`ts-modern`) | `require` of ESM with top-level `await` fails; value-imported types fail at runtime under stripping | REL 5.8, NAPI TypeScript |
| ts-erasable | `enum`, runtime `namespace`, parameter properties, `import =` in code Node runs directly | Rewrite to erasable syntax; turn on `erasableSyntaxOnly` | Node's type stripping rejects them (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) | NAPI TypeScript, REL 5.8 |
| ts-clone | `JSON.parse(JSON.stringify(x))` as a deep clone | `structuredClone`, unless JSON lossiness is the point (`ts-modern`) | Drops `Date`/`Map`/`undefined`; throws on cycles | MDN https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone, `ts-modern` |
| ts-groupby-partial | `Object.groupBy(...)[k]` used without a guard | Handle `undefined`; the result has a null prototype | Missing groups are absent, and `hasOwnProperty` does not exist on it | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy |

### 4.2 Async and errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-floating-promise | Promise-returning call not awaited, returned, `.catch`-ed or passed to a combinator; `void p` used as "handled" | Await it, return it, or attach a rejection handler; `void` does not handle a rejection | Rejection becomes `unhandledRejection`, which crashes Node by default (`throw` mode) | TSE `no-floating-promises`, NAPI process, MDN Using_promises |
| ts-misused-promise | `async` callback passed where a sync callback is expected (`forEach`, event emitter, `if (promise)`) | `for...of` with `await`, or `Promise.all(arr.map(...))`; await before testing | `forEach` does not wait; a promise is always truthy | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach, TSE `no-misused-promises` |
| ts-await-loop | `await` inside a loop over independent items | `Promise.all` (bounded, see ts-perf-fanout) when iterations are independent; keep sequential when they depend on each other, write to one stream, retry, or rate-limit | n round trips where one batch would do; independence must be visible in the diff | ESL `no-await-in-loop`, MDN Using_promises |
| ts-all-vs-allsettled | `Promise.all` where one failure should not discard the others' results, or `allSettled` whose rejections are never read | Pick by intent; read each `status` | `all` rejects on the first failure and the rest keep running unobserved | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise |
| ts-race-cleanup | `Promise.race` used for a timeout on work that keeps running | Cancel the work with `AbortSignal` (`AbortSignal.timeout`, `ts-modern`) | `race` settles but does not stop the losers; handlers accumulate | MDN Promise |
| ts-fetch-ok | `fetch` result used without checking `res.ok`/`status` | Check it before reading the body | `fetch` rejects only on network failure, not on 4xx/5xx | MDN https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch |
| ts-swallowed | Empty `catch`, or `catch` that logs and continues where the caller needs the failure | Rethrow with context (`new Error(msg, { cause })`), return a typed failure, or comment why ignoring is correct | Lost failures | GTS "Empty catch blocks" |
| ts-throw-non-error | `throw` of a string/object; `Promise.reject("x")` | `Error` or a subclass | No stack; `instanceof Error` narrowing fails downstream | GTS "Exceptions", TSE `only-throw-error`, `prefer-promise-reject-errors` |
| ts-catch-unknown | `catch (e: any)`, `e.message` without narrowing, `.catch((e: any) => ...)` | Narrow `unknown` with `instanceof Error` (`typescript-patterns`) | Anything can be thrown | TSC `useUnknownInCatchVariables`, TSE `use-unknown-in-catch-callback-variable` (strict) |
| ts-json-parse | `JSON.parse` on external input without handling `SyntaxError`, and its result used as a typed value | Catch, then validate the shape (Zod, `typescript-patterns`) | Throws on malformed input; the result is `any` | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse |
| ts-callback-mix | New callback-style API, or callbacks and promises mixed in one flow | Promises/`async`; `util.promisify` or the `node:*/promises` modules | Errors fall between the two models | OWN "flat Promise chains" |
| ts-resource-cleanup | Handle, connection, lock or temp file acquired with no release on the throw path | `try/finally`, or `using`/`await using` where the floor allows (section 5) | Leaks on the error path | REL 5.2, `ts-modern` |

### 4.3 Security (Node and browser sinks)

Language-specific sinks only. Authorization, secrets, SQL injection, SSRF and
supply-chain review belong to `security-reviewer`; hand those over rather
than duplicating them.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-eval | `eval`, `new Function`, `setTimeout(string)`, `vm` used to run untrusted code | Remove; `vm` is not a sandbox | Code execution with the caller's privileges | MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval, OWN "dangerous functions" |
| ts-html-sink | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` with data not authored by the app | `textContent`, or a sanitizer plus Trusted Types | XSS; `<img onerror>` runs even though `<script>` does not | MDN https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML |
| ts-shell | `exec`/`execSync`, or `spawn`/`execFile` with `shell: true`, taking external input | `execFile`/`spawn` with an argument array and no shell; allowlist values | Shell metacharacters execute commands | NAPI child_process, OWN |
| ts-proto-pollution | Recursive merge/assign of parsed input into an object; `obj[userKey] = v` | Reject `__proto__`/`constructor`/`prototype` keys, `Object.create(null)` or `Map`, `Object.hasOwn`, schema validation | Writes reach `Object.prototype` | NSEC "Prototype Pollution" |
| ts-path-traversal | File path built from request data | Resolve, then confirm the result stays under the intended root | `../` reads outside the directory | OPT |
| ts-timing-compare | Token, HMAC or password compared with `===` | `crypto.timingSafeEqual` on equal-length buffers; `scrypt` for passwords | Response time leaks the secret | NSEC "Timing Attacks" |
| ts-redos | New regex with nested quantifiers `(a+)*`, overlapping alternation, or backreferences, run on external input | Rewrite, bound input length, or use plain string search | One crafted string blocks the event loop | NBLK "ReDoS", OWN |
| ts-body-limit | Handler reading a body or upload with no size limit | Limit per content type | Memory exhaustion | OWN "request size limits", CWE770 |
| ts-input-validate | External data (body, query, env, message, file) used without a schema | Validate at the boundary and infer the type from the schema (Zod, `typescript-patterns`) | Types are erased; nothing checks the shape at runtime | OWN "input validation", NSEC |

### 4.4 Performance (event loop, await fan-out, bundle)

Report a cost only with its execution context (request path, startup, build,
client bundle, test) and a size or frequency argument. Cost in startup-only
or test-only code is not a finding. Without measurement, label the finding
"needs measurement" and name the command that would confirm it
(`node --cpu-prof`, a benchmark, a bundle analyzer). Micro-rewrites (`for`
vs `.map`, caching `length`, manual monomorphization) are not findings
without a profile: the engine's optimizing tiers have changed since most
such advice was written (Maglev, V8).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-perf-sync-io | `fs.*Sync`, `execSync`/`spawnSync`, `zlib.*Sync`, `crypto.pbkdf2Sync`/`scryptSync`/sync `randomBytes` on a request path | Async form (runs on the libuv pool); module-scope startup reads are fine | Blocks every concurrent request, not only this one | NBLK |
| ts-perf-cpu-block | Large synchronous transform per request (big `JSON.parse`/`stringify`, base64 of MB-sized buffers, heavy compute) | Stream, partition with `setImmediate`, or offload to `worker_threads` | Head-of-line blocking; NBLK measured ~1.3 s to parse 50 MB | NBLK, NAPI worker_threads |
| ts-perf-fanout | `Promise.all(items.map(...))` where `items` length comes from the caller or the data | Bound concurrency (a pool or chunks) and name the bound | Opens n sockets/connections at once; exhausts pools under load | CWE770, ESL `no-await-in-loop` ("unbounded concurrency") |
| ts-perf-n-plus-1 | Per-item DB/HTTP call in a loop where the backend accepts a batch | Batch API or loader; otherwise ts-await-loop applies | n round trips | ESL `no-await-in-loop` |
| ts-perf-buffer-all | `await res.text()`/`arrayBuffer()`, `readFile` on input whose size the code does not bound | Stream with `pipeline` from `node:stream/promises`, or enforce a limit | Peak memory scales with the largest input anyone sends | NBP, CWE770 |
| ts-perf-backpressure | `src.on('data', c => dst.write(c))`, `.pipe()` chains | `pipeline()`; if manual, stop on `write() === false` until `'drain'` | Memory grows with consumer lag; `.pipe` does not propagate errors or destroy streams | NBP |
| ts-perf-unbounded-cache | Module-level `Map`/object memo keyed by external input with no size cap or TTL | Bound it (LRU, TTL) or drop it | That is a leak under real traffic | CWE770 |
| ts-perf-accum-spread | `reduce((acc, x) => ({ ...acc, ... }))`, `arr = [...arr, x]` or `concat` in a loop | Mutate a local accumulator, `Map`, or `Object.groupBy` | O(n²) copying | BIO |
| ts-bundle-cjs | New client-side import of a CommonJS-only package, `import * as X` of CJS, or a whole-library default import | ESM named imports or a smaller package; name the bundler and the size delta when a report exists | Tree shaking needs static ESM | WPT |
| ts-bundle-side-effects | Package under review with no `sideEffects` field, or `"sideEffects": true`, plus barrel re-exports | Declare `sideEffects` (list CSS and polyfills) | Unused modules cannot be dropped | WPT |
| ts-bundle-server-leak | `node:` import or server-only module reachable from a client entry | Split the module | Build failure or a larger bundle | WPT |

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-export-types | Exported function or public method without parameter or return types | Annotate parameters always; return types per the house rule in `typescript-patterns`, and required under `isolatedDeclarations` | The signature is the contract; inference can change it silently | `typescript-patterns`, REL 5.5 |
| ts-export-let | `export let` or exported mutable object | Export a getter function or a `readonly` view | Importers see a live binding anyone can change | GTS "Mutable exports" |
| ts-default-export | New `export default` in a codebase that uses named exports | Named export | Each importer names it differently; renames do not follow | GTS "Exports" |
| ts-readonly | Parameters or fields that are never mutated typed as mutable arrays/objects | `readonly T[]`, `Readonly<T>`, `readonly` fields | Callers can rely on no mutation; matches the house immutability rule | GTS "readonly", `typescript-patterns` |
| ts-optional-param | `x: T \| undefined` parameter or field meaning "may be omitted" | `x?: T` | Callers must otherwise pass `undefined` explicitly | GTS "Optionals vs \|undefined" |
| ts-overloads | Overloads differing only in one parameter's type | One union-typed parameter | Simpler and composes with callers holding the union | HB Do's and Don'ts |
| ts-callback-void | Callback parameter typed to return `any` when the result is ignored | `=> void` | Prevents use of the ignored value | HB Do's and Don'ts |
| ts-override | Subclass method overriding without `override` | `override`, and `noImplicitOverride` | A renamed base method otherwise leaves a silent orphan | TSC `noImplicitOverride` |
| ts-envelope | New HTTP handler returning an ad hoc shape | The project's envelope (`typescript-patterns` API Response Format) | One response contract | `typescript-patterns` |

### 4.6 Naming and readability

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-naming-case | Types not `UpperCamelCase`, values and functions not `lowerCamelCase`; `I` prefix; `_` prefix/suffix | Rename | Uniform reading across the codebase | GTS "Naming" |
| ts-container-class | Class with only static members, or `namespace` with runtime code | Module-level exports | Modules already namespace; `namespace` is not erasable | GTS "Container classes", NAPI TypeScript |
| ts-getter-pure | Getter with side effects | Make it a method | Readers expect property access to be free of effects | GTS "Getters and setters" |
| ts-wrapper-types | `String`/`Number`/`Boolean`/`Object` as types, `new String()` | Primitives, `object`, `unknown` | Wrapper objects behave differently from primitives | HB Do's and Don'ts, GTS |

### 4.7 Testing

E2E framework choice and patterns: `typescript-testing`, `e2e-testing`.
Whether tests protect behaviour at all is `test-reviewer`'s question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| ts-test-await | `expect(p).resolves/rejects` or a promise in a test neither returned nor awaited | `await` it | The test ends before the assertion runs and passes vacuously | JEST |
| ts-test-timers | Test sleeping on real `setTimeout`, or code under test driven by timers | Fake timers (`vi.useFakeTimers`, `advanceTimersByTime`) and restore real timers after | Slow and flaky | VIT Timers |
| ts-test-types | New public generic or conditional type with no type-level test | `expectTypeOf`/`assertType` in `*.test-d.ts`, run with `--typecheck` | Type regressions do not fail runtime tests | VIT Testing Types |
| ts-test-expect-error | `@ts-expect-error` in a type test without checking it fails for the intended reason | Pair with a runtime include or a precise assertion | A typo makes it pass falsely | VIT Testing Types, GTS |
| ts-test-any | `as any` to build fixtures or reach private members | Typed factories; test through the public API | Fixtures drift from real types without errors | HB Everyday Types |

## 5. Version-gated modern features

Gate on the `typescript` version installed in the project and on the
runtime floor (`engines`, browser targets), never on the latest release.
The replacement table, with when the old form is still right, is in
`ts-modern`; this section adds only the gates and toolchain facts a review
needs.

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| TS 4.9 | `satisfies` for checked literals; `in` narrowing on unlisted properties | The wide type is wanted later (reassigned field) | REL 4.9 |
| TS 5.0 | `const` type parameters; `verbatimModuleSyntax`; `moduleResolution: bundler`; standard decorators | Callers pass mutable arrays (`const` T infers `readonly`); a framework still requires `experimentalDecorators` | REL 5.0 |
| TS 5.2 / Node 24 | `using` / `await using` for resources | Browser bundles without downlevelling (not Baseline); conditional cleanup; non-resource cleanup | REL 5.2, `ts-modern` |
| TS 5.5 | Rely on inferred type predicates in `filter`; `isolatedDeclarations` for libraries | Truthiness predicates (`x => !!x`) are not inferred | REL 5.5 |
| TS 5.8 / Node 22.18+, 23.6+ | `erasableSyntaxOnly` + `verbatimModuleSyntax` when Node runs `.ts` directly; `require(esm)` under `nodenext` | ESM with top-level `await` cannot be required | REL 5.8, NAPI TypeScript |
| TS 6.0 | Expect `strict: true`, `module: esnext`, `types: []`, `target: es2025` by default; `es2025` lib (`Promise.try`, `RegExp.escape`); `#/` subpath imports | Project pins `ignoreDeprecations: "6.0"` while migrating (temporary only) | TS6 |
| TS 7.0 | Go-native `tsc` (8–12× faster builds). Deprecated 6.0 options are errors: `target: es5`, `baseUrl`, `moduleResolution: node`/`node10`/`classic`, `outFile`, AMD/UMD/System modules. Migrate through a clean 6.0 build first | No programmatic API until 7.1: typescript-eslint, webpack loaders and Vue/Svelte/Astro/Angular template tooling stay on 6.0 (`@typescript/typescript6` alias beside `@typescript/native`) | TS7 |
| ES2023–2024 (runtime floors in `ts-modern`) | `toSorted`/`toReversed`/`with`, `Object.groupBy`, `Promise.withResolvers`, Set methods (Node 22+) | Floor below the runtime that ships them | `ts-modern`, MDN groupBy |

A build-time complaint about type-checking speed is a compiler-version
question (TS 7), not a reason for type surgery (TS7).

## 6. Concurrency model

- One agent runs one job to completion before the next; there is no
  preemption inside synchronous code. Microtasks (promise callbacks) drain
  before the next task (timers, I/O) — MDN Execution model.
- `then` callbacks never run synchronously, even on a resolved promise
  — MDN Using promises.
- Races happen across `await`: state read before an `await` may be stale
  after it. Check-then-act split by an `await` (read balance, `await`
  something, write balance) is a race between concurrent requests in the
  same process. Re-read after the `await`, or serialize with a per-key queue
  or a database constraint or transaction.
- Long synchronous work delays every other request in the process; the
  libuv worker pool (fs, crypto, zlib, DNS) can also be saturated by
  long-running tasks — NBLK.
- `worker_threads` are for CPU-bound JavaScript, not I/O. Workers share
  nothing by default: messages are structured-cloned, `ArrayBuffer`s can be
  transferred (the sender loses them), and only `SharedArrayBuffer` is shared,
  coordinated with `Atomics` — NAPI worker_threads, MDN Execution model,
  MDN https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics.
- Multiple processes (cluster, several pods) share nothing in memory: an
  in-process lock, cache or rate limiter does not coordinate across them.
- Unhandled rejections terminate Node by default; every promise needs an
  owner that awaits it or handles its rejection — NAPI process.
- Correctness vs speed: a lost update or unhandled rejection is 4.2; a
  blocked loop or unbounded fan-out that only slows the system is 4.4.

## 7. Linter mapping

Run the project's own checks first (`lefthook.yml`, `.pre-commit-config.yaml`,
its ESLint config, CI results via `gh pr checks`) and pass their output to
the review; never report "no issues" from a tool that did not run. The safe
default is a PATH-resolved `tsc --noEmit -p <tsconfig owning the changed
files>` (not `npx tsc`, not build mode). Running the project's ESLint,
`npm run` scripts or tests executes code the diff controls; name those
commands instead of running them unless execution was opted into. Do not
restate what a tool that ran already reported.

`tsc` with `strict` already catches: implicit `any` (`noImplicitAny`), null
misuse (`strictNullChecks`), `catch` variables as `unknown`, unsound
function parameter variance, uninitialized class fields, wrong `bind`/`call`
arguments. With the extra flags: unchecked index access
(`noUncheckedIndexedAccess`), optional-vs-`undefined`
(`exactOptionalPropertyTypes`), missing `override` (`noImplicitOverride`),
switch fallthrough (`noFallthroughCasesInSwitch`), non-erasable syntax
(`erasableSyntaxOnly`) — TSC, REL 5.8.

typescript-eslint (type-checked configs need `parserOptions.projectService`;
TSE typed linting):

| Item | Rule | Config |
|---|---|---|
| ts-any | `no-explicit-any`; `no-unsafe-assignment`/`-member-access`/`-argument`/`-return`/`-call` | recommended; recommended-type-checked |
| ts-floating-promise | `no-floating-promises` | recommended-type-checked |
| ts-misused-promise | `no-misused-promises`, `await-thenable` | recommended-type-checked |
| ts-throw-non-error | `only-throw-error`, `prefer-promise-reject-errors` | recommended-type-checked |
| ts-catch-unknown | `use-unknown-in-catch-callback-variable` | strict-type-checked |
| ts-non-null | `no-non-null-assertion` | strict |
| ts-assertion (redundant) | `no-unnecessary-type-assertion`; style via `consistent-type-assertions` | recommended-type-checked; stylistic |
| ts-for-in-array | `no-for-in-array` | recommended-type-checked |
| ts-falsy-default | `prefer-nullish-coalescing` | stylistic-type-checked |
| ts-exhaustive | `switch-exhaustiveness-check` | not in a preset; enable explicitly |
| ts-module-system (type imports) | `consistent-type-imports` | not in a preset |
| deprecated APIs | `no-deprecated` | strict-type-checked |
| unbound methods, `delete` on arrays, `${obj}` | `unbound-method`, `no-array-delete`, `restrict-template-expressions`, `no-base-to-string` | recommended-type-checked |
| ts-await-loop | ESLint `no-await-in-loop` | ESLint core rule |
| ts-perf-accum-spread | Biome `noAccumulatingSpread` | Biome (not ESLint) |

`strict` and `strict-type-checked` are not semver-stable; a typescript-eslint
minor upgrade can add findings (TSE configs).

No tool decides: whether an assertion is backed by a runtime check, whether
`await`-in-loop iterations are independent, the concurrency bound, whether a
path is hot or ships to a client, races across `await`, union modelling,
`any` justification, or whether a version gate applies. Those are the
review's work.
