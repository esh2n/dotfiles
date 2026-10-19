# React (JSX / TSX) review standard

The one React standard for both the model writing React and `code-reviewer`
reviewing a `.tsx`/`.jsx` diff. Read it together with the TypeScript standard
(`typescript-patterns/references/review-standard.md`): types, async, Node and
browser sinks, bundle composition and general TS testing stay there; this
file holds only what React adds. Detail and code live in the skills it
links: `react-patterns` (state location, composition, forms, RSC
boundaries), `react-performance` (the Vercel-derived rule catalogue),
`react-testability` (props-controlled states, presenter split),
`react-testing` (RTL, MSW, axe). Element semantics, ARIA and landmarks
belong to the `semantic-html` skill (not yet written); section 4.6 keeps
only the React-specific part.

Before applying any rule, read `react`, `react-dom` and (if present) `next`
in `package.json`, whether React Compiler is on (`babel-plugin-react-compiler`
in the Babel/Vite config, the compiler option in `next.config.*`, or Expo SDK 54+
where it is the default), whether the files run as Server or Client
Components (a `'use client'` directive in the file or an importer), and the
`eslint-plugin-react-hooks` version and preset. A rule gated on a version
does not apply below it; RSC advice does not apply to a Vite SPA.

Sources are cited by the short name in the first column of section 1; a
quoted page or rule name after it names the part to read.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| ROR | Rules of React (index, "Components and Hooks must be pure", "React calls Components and Hooks", "Rules of Hooks") | https://react.dev/reference/rules, https://react.dev/reference/rules/components-and-hooks-must-be-pure, https://react.dev/reference/rules/react-calls-components-and-hooks, https://react.dev/reference/rules/rules-of-hooks | Purity, immutability, hooks placement, no dynamic hooks | Fetched 2026-10-19 | CC BY 4.0 (reactjs/react.dev LICENSE-DOCS) |
| LRN | react.dev Learn: "You Might Not Need an Effect", "Synchronizing with Effects", "Removing Effect Dependencies", "Choosing the State Structure", "Updating Objects in State", "Preserving and Resetting State", "Rendering Lists", "Manipulating the DOM with Refs" | https://react.dev/learn/you-might-not-need-an-effect, https://react.dev/learn/synchronizing-with-effects, https://react.dev/learn/removing-effect-dependencies, https://react.dev/learn/choosing-the-state-structure, https://react.dev/learn/updating-objects-in-state, https://react.dev/learn/preserving-and-resetting-state, https://react.dev/learn/rendering-lists, https://react.dev/learn/manipulating-the-dom-with-refs | Effects, state shape, keys, refs | Fetched 2026-10-19 | CC BY 4.0 |
| API | react.dev API reference: `memo`, `useMemo`, `useContext`, `useRef`, `useId`, `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `use`, `Suspense`, `lazy`, `cache`, `Activity`, `Component`, `StrictMode`, `act`, `hydrateRoot`, common components, `<form>` | https://react.dev/reference/react/memo and siblings under https://react.dev/reference/react/, https://react.dev/reference/react-dom/client/hydrateRoot, https://react.dev/reference/react-dom/components/common, https://react.dev/reference/react-dom/components/form | Per-API contracts and caveats | Fetched 2026-10-19 | CC BY 4.0 |
| RSC | Server Components, `'use client'`, `'use server'` | https://react.dev/reference/rsc/server-components, https://react.dev/reference/rsc/use-client, https://react.dev/reference/rsc/use-server | Boundary on the module graph, serializable props, Server Function security | RSC stable in 19; bundler APIs not semver | CC BY 4.0 |
| RC | React Compiler: introduction, directives, 1.0 release post | https://react.dev/learn/react-compiler/introduction, https://react.dev/reference/react-compiler/directives, https://react.dev/blog/2025/10/07/react-compiler-1 | Auto-memoization, keeping existing memo, `"use no memo"` | 1.0 on 2025-10-07; `babel-plugin-react-compiler` 1.0.0 | CC BY 4.0 |
| R19 | React 19 and 19.2 release posts | https://react.dev/blog/2024/12/05/react-19, https://react.dev/blog/2025/10/01/react-19-2 | Actions, `use`, ref as prop, `<Context>` provider, `Activity`, `useEffectEvent`, hooks plugin v6 | 2024-12-05, 2025-10-01 | CC BY 4.0 |
| CHG | React CHANGELOG | https://github.com/facebook/react/blob/main/CHANGELOG.md | 18.0 automatic batching, 19.0 removals, 19.1, 19.3, 16.9 `javascript:` deprecation | 19.3.0 on 2026-09-09; npm latest 19.3.1 | MIT |
| ERH | eslint-plugin-react-hooks | https://react.dev/reference/eslint-plugin-react-hooks | 17 rules incl. compiler diagnostics | npm 7.1.1 | MIT |
| JXA | eslint-plugin-jsx-a11y | https://github.com/jsx-eslint/eslint-plugin-jsx-a11y | Static JSX accessibility rules; pair with runtime axe | npm 6.10.2 | MIT |
| NXS | Next.js: Data Security | https://nextjs.org/docs/app/guides/data-security | DAL, `server-only`, DTOs, taint, Server Action auth, return values | Updated 2026-10-06 | MIT (vercel/next.js) |
| NXF | Next.js: Fetching Data | https://nextjs.org/docs/app/getting-started/fetching-data | Sequential vs parallel, streaming, `use`, `React.cache`, preload | Updated 2026-09-01 | MIT |
| NXC | Next.js: Caching (Cache Components) | https://nextjs.org/docs/app/getting-started/caching | `fetch` uncached by default, `use cache`, runtime APIs need `<Suspense>` | Updated 2026-10-06; npm `next` 16.4.2 | MIT |
| NXE | Next.js: Environment Variables | https://nextjs.org/docs/app/guides/environment-variables | `NEXT_PUBLIC_` inlined at build | Updated 2026-08-25 | MIT |
| WEB | web.dev: Web Vitals, Optimize INP, Virtualize long lists | https://web.dev/articles/vitals, https://web.dev/articles/optimize-inp, https://web.dev/articles/virtualize-long-lists-react-window | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75; DOM size; windowing | 2024-10-31, 2025-09-02, 2019-04-29 | CC BY 4.0 (code Apache-2.0) |
| VRB | Vercel `react-best-practices` (cited by rule file name) | https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices | 70 rules in 8 categories (`async-`, `bundle-`, `server-`, `client-`, `rerender-`, `rendering-`, `js-`, `advanced-`) | v1.0.0 (January 2026); repo pushed 2026-10-14 | MIT per its SKILL.md front matter; the repo has no LICENSE file |
| RTL | Testing Library: Guiding Principles, About Queries | https://testing-library.com/docs/guiding-principles, https://testing-library.com/docs/queries/about | Query priority, `getBy`/`queryBy`/`findBy` | `@testing-library/react` 16.3.3 | MIT (docs repo) |

The 2018-era React docs (reactjs.org) and articles written for class
components predate hooks semantics as now specified; do not cite them.

## 2. Mindset

- Rendering is a pure function of props, state and context; React may call
  it more than once, interrupt it, or discard it (ROR, API `StrictMode`).
- Effects synchronize with an external system. If no external system is
  involved, the code belongs in render or in an event handler (LRN "You
  Might Not Need an Effect").
- State is minimal: derive what can be computed, store IDs not copies, and
  never mirror a prop (LRN "Choosing the State Structure").
- Dependencies are not chosen; to change them, change the code (LRN
  "Removing Effect Dependencies").
- Server Components are the default where the framework has them; the
  `'use client'` line moves a whole module subtree to the browser (RSC).
- Under React Compiler, memoization is the compiler's job; a performance
  finding needs a trigger frequency and a cost (API `memo`, `useMemo`, RC).
- Every Server Function is a public POST endpoint (RSC `'use server'`, NXS).

## 3. Habits carried from other languages and frameworks

| Habit | Do instead | Source |
|---|---|---|
| Watchers/observers to keep derived values in sync (Vue `watch`, Angular `ngOnChanges`, MobX reactions) written as `useEffect` + `setState` | Compute during render; `useMemo` only if measured slow | LRN "You Might Not Need an Effect" |
| `componentDidMount` thinking: `useEffect(fn, [])` with a suppressed lint rule to "run once" | List every dependency; make the effect safe to set up, clean up and set up again | LRN "Synchronizing with Effects", "Removing Effect Dependencies" |
| Ref flag to stop the dev double-run | Write the cleanup; the remount is what production navigation does | LRN "Synchronizing with Effects" ("Don't use refs to prevent Effects from firing") |
| jQuery/imperative DOM: `ref.current.remove()`, `appendChild`, `innerHTML` on nodes React renders | Render from state; refs only for focus, scroll, measure, or nodes React leaves empty | LRN "Manipulating the DOM with Refs" |
| Mutating an object then "saving" it (`state.items.push(x); setState(state)`) — OOP and Vue 2 style | New object or array per update; Immer for deep updates | LRN "Updating Objects in State", ROR purity |
| Class components and HOCs for reuse; `withLogging(useData)` | Function components and plain custom hooks; never wrap or pass hooks | ROR "React calls Components and Hooks" |
| Calling a component like a function (`{Header()}`) | `<Header />` so React owns its state and reconciliation | ROR "React calls Components and Hooks" |
| Data loading in a mount effect (SPA habit) in a framework with Server Components or loaders | Fetch on the server or through the framework / a cache library | LRN "You Might Not Need an Effect" ("Fetching data"), NXF |
| `index` or `Math.random()` as list keys | Stable ID from the data, created once | LRN "Rendering Lists" |
| `propTypes` / function `defaultProps` for runtime contracts | TypeScript props and ES default parameters (both are ignored on function components in React 19) | CHG 19.0.0 |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
A finding names the concrete failure (stale value, lost input, extra round
trip, leaked field); "could re-render" is not a finding.

### 4.1 Rendering correctness and purity

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-impure-render | `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, DOM writes, logging, or a network call in a component body | Move to an effect, event handler, or state initializer | Components must be idempotent; React may render more than once | ROR "Components and Hooks must be pure" |
| react-mutate-props-state | `props.x = …`, `state.arr.push(…)`, `obj.k = v; setObj(obj)` | New object/array per update | Mutation does not re-render and breaks `Object.is` checks | ROR purity, LRN "Updating Objects in State" |
| react-mutate-after-jsx | Object mutated after it was passed into JSX or a hook | Mutate before creating JSX, or copy | JSX may be evaluated eagerly; hook values may be memoized | ROR purity |
| react-global-mutation | Module-level variable or global written during render | Local variable or state | Render may run twice or be discarded | ROR purity, ERH `globals` |
| react-ref-in-render | `ref.current` read or written in the component body (except `if (ref.current === null) ref.current = …`) | Read/write in effects or handlers; use state for displayed values | Unpredictable output; changing a ref does not re-render | API `useRef`, ERH `refs` |
| react-set-state-in-render | Unconditional `setX(…)` in the body | Derive the value or guard on a previous-prop comparison | Render loop | ERH `set-state-in-render`, LRN "Adjusting some state when a prop changes" |
| react-key-index | `key={i}` / `key={index}` on a list that can reorder, insert or delete | Stable data ID | State and DOM attach to the wrong row | LRN "Rendering Lists" |
| react-key-generated | `key={Math.random()}`, `key={crypto.randomUUID()}` or `key={useId()}` in render | ID created when the item is created and stored with it | All rows remount every render; input lost | LRN "Rendering Lists", API `useId` |
| react-nested-component | Component (or `lazy(…)`) declared inside another component's body | Declare at module top level | A new type each render resets all state below | LRN "Preserving and Resetting State", API `lazy`, ERH `static-components` |
| react-call-component | `{Child()}` or `Child(props)` | Render `<Child />` | Breaks hooks rules and reconciliation | ROR "React calls Components and Hooks" |
| react-falsy-and | `{count && <X/>}` where the left side can be `0` or `NaN` | Ternary or boolean comparison | Renders `0` as text | VRB `rendering-conditional-render` |
| react-dangerous-html | `dangerouslySetInnerHTML` with data not authored by the app | Sanitizer at the same call site, or Trusted Types policy; build `{__html}` next to where the HTML is generated | XSS; `<img onerror>` runs | API common components |
| react-url-scheme | `href`/`src`/`action` from user data | Allowlist schemes (`https:`, `mailto:` …) | React deprecated `javascript:` URLs in 16.9; the changelog through 19.3 records no blocking, so the app must validate | CHG 16.9.0 |
| react-hydration-mismatch | `typeof window` checks, `window.matchMedia`, locale or time formatting in render of SSR'd output | Same output on server and first client render; client-only parts after an effect or behind `use(browser())` (19.3) | Mismatch can attach handlers to wrong elements | API `hydrateRoot`, CHG 19.3.0 |
| react-suppress-hydration | `suppressHydrationWarning` on an element with children or a large subtree | Only on the one divergent leaf | Works one level deep and does not patch content | API `hydrateRoot` |
| react-dom-mutation | `ref.current.remove()`, `appendChild`, `innerHTML =` on nodes React renders | Render from state; touch only nodes React leaves empty | React crashes when its nodes are changed under it | LRN "Manipulating the DOM with Refs" |

### 4.2 Hooks and effects

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-hook-placement | Hook in `if`/loop/after early `return`/handler/`try`/inside `useMemo`/`useEffect` callbacks/regular function | Move to top level of a component or `use*` function (`use` itself may be conditional) | Hook order identifies state | ROR "Rules of Hooks", R19 `use` |
| react-hook-name | Function that calls hooks without a `use` prefix; `use*` function that calls none | Rename | The linter and compiler identify hooks by name | ROR "Rules of Hooks" |
| react-dynamic-hook | Hook passed as a prop or argument, or wrapped by a higher-order function | Static custom hook called directly | Breaks local reasoning and compiler optimization | ROR "React calls Components and Hooks", ERH `component-hook-factories` |
| react-deps-suppressed | `// eslint-disable-next-line react-hooks/exhaustive-deps` | Remove; change the code so the dependency is not needed (move object inside the effect, updater function, `useEffectEvent`) | Stale values: the effect keeps the first render's closure | LRN "Removing Effect Dependencies" |
| react-deps-unstable | Object, array or function built in render used as an effect/memo dependency | Move it inside the effect, outside the component, or depend on its primitive fields | Effect re-runs every render; with `setState` inside it is a request or render loop | LRN "Removing Effect Dependencies" |
| react-effect-derived | `useEffect(() => setX(f(a, b)), [a, b])` | Compute `f(a, b)` in render | Extra render pass; transient inconsistent UI | LRN "You Might Not Need an Effect", ERH `set-state-in-effect` |
| react-effect-chain | Effect sets state that triggers another effect that sets state | Compute in render and set the next state in one handler | Cascading renders, hard-to-follow flow | LRN "Chains of computations" |
| react-effect-event-logic | POST, navigation, toast or `onChange` call in an effect keyed on state a user action changed | Do it in the event handler | Fires on remount, Back, and the dev double-run | LRN "Synchronizing with Effects" (purchase example), "Notifying parent components" |
| react-effect-cleanup | Subscription, listener, interval, connection or observer in an effect with no returned cleanup | Return a cleanup that undoes setup | Leaks and duplicates; Strict Mode exposes it | LRN "Synchronizing with Effects", API `StrictMode` |
| react-effect-fetch-race | `fetch(...).then(setX)` in an effect without an ignore flag or abort | `let ignore = false` with cleanup, or a framework/cache library | Out-of-order responses overwrite newer data | LRN "Synchronizing with Effects" |
| react-effect-reset-state | Effect that resets state when a prop (e.g. `userId`) changes | `key={userId}` on the child | Renders stale state first, then corrects | LRN "Resetting all state when a prop changes" |
| react-effect-app-init | One-time app setup in `useEffect(…, [])` | Module-level guard or module init code | Runs twice in development; not app-scoped | LRN "Initializing the application" |
| react-manual-subscribe | Effect subscribing to an external store/browser API and copying into state | `useSyncExternalStore` | Concurrent renders can show inconsistent values | LRN "Subscribing to an external store", API `useSyncExternalStore` |
| react-uses-snapshot | `getSnapshot` returning a new object each call; `subscribe` defined inside the component | Return cached immutable data; hoist `subscribe` or `useCallback` it | Infinite loop; resubscribe every render | API `useSyncExternalStore` |
| react-effect-event-deps | `useEffectEvent` result listed in deps, called outside its effect, or used to silence the linter for reactive logic | Omit from deps; call only from the effect in the same component; keep reactive values as deps | Wrong usage hides real dependencies | R19 (19.2 "useEffectEvent caveats") |
| react-stale-updater | `setCount(count + 1)` inside an interval, async callback or effect that does not list `count` | `setCount(c => c + 1)` | Updater avoids reading stale state | LRN "Removing Effect Dependencies" |
| react-ref-callback-return | Ref callback with an implicit return (`ref={n => (x = n)}`) | Block body; return a cleanup when needed (19) | React 19 types reject a non-function return; a returned function runs as cleanup | R19 "Ref cleanup functions", API common components |

### 4.3 State and data flow

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-redundant-state | State that can be computed from other state or props | Derive it | Values drift out of sync | LRN "Choosing the State Structure" |
| react-mirror-prop | `useState(props.x)` where later `x` changes must show | Use the prop; if intentional, name it `initialX`/`defaultX`; or reset with `key` | State initializes once and ignores later props | LRN "Choosing the State Structure" ("Don't mirror props in state") |
| react-contradicting-state | Booleans like `isSending` + `isSent`, or `loading`/`error`/`data` set independently | One `status` / discriminated union (see TS `ts-discriminated`) | Impossible combinations become representable | LRN "Choosing the State Structure" |
| react-duplicated-state | Selected object copied into state alongside the list | Store `selectedId` and derive | Edits update one copy only | LRN "Choosing the State Structure" |
| react-child-to-parent-data | Child fetches then pushes data up via an effect calling a parent setter | Parent fetches and passes down | Data flow becomes bidirectional and racy | LRN "Passing data to the parent" |
| react-context-value | `<Ctx value={{ … }}>` or inline function as context value in a provider that re-renders | Memoize the value (or rely on the compiler) and split rarely- and often-changing values | Every consumer re-renders on each provider render; `memo` does not stop it | API `useContext` |
| react-state-too-high | Per-keystroke, hover or timer state held above a large subtree | Move the state into the component that uses it, or pass the static part as `children` | Whole subtree re-renders per change | API `memo` ("Principles that make memoization unnecessary") |
| react-props-control | Component whose loading/error/empty branches depend only on internal state or an internal fetch | Accept the state as props; keep fetching in a container | Each branch cannot be rendered in a test or story (house rule) | `react-testability` |
| react-form-action | `<form onSubmit>` doing `preventDefault` + manual pending state in React 19 code | `action={fn}` with `useActionState`/`useFormStatus`; inputs need `name` to appear in `FormData` | Pending, reset and progressive enhancement come built in | API `<form>`, R19 |
| react-optimistic | Optimistic list updated via local state and manually rolled back | `useOptimistic` | React reverts when the action settles or fails | R19, API `<form>` |

### 4.4 Server / client boundaries

Applies only where the project renders Server Components (Next.js App
Router or another RSC framework).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-rsc-action-input | `'use server'` function using arguments/`FormData` without a schema | Validate every argument; types are erased | Arguments are fully client-controlled | RSC `'use server'`, NXS "Validating client input" |
| react-rsc-action-authz | `'use server'` function with no auth and ownership check inside it | Authenticate and authorize in the action or its DAL call; a page-level check does not cover it | Reachable by direct POST even if not rendered | RSC `'use server'`, NXS "Authentication and authorization", VRB `server-auth-actions` |
| react-rsc-action-return | Action returning a raw DB record | Return only what the UI needs | Return values are serialized to the client | NXS "Controlling return values" |
| react-rsc-props-leak | Server Component passing a whole user/DB record to a `'use client'` component | DTO with the needed fields; DAL in a `server-only` module; taint as an extra layer | Every passed field ships in the payload | NXS "Component-level data access", VRB `server-serialization` |
| react-rsc-server-only | DB client, secrets or `process.env` reachable from a `'use client'` module graph | `import 'server-only'` in server modules; keep env reads in the DAL | Build error is better than a leak | NXS "Preventing client-side execution of server-only code" |
| react-public-env | Secret in `NEXT_PUBLIC_*` (or the bundler's equivalent public prefix) | Server-only variable | Inlined into the client bundle at build time | NXE |
| react-use-client-high | `'use client'` added to a layout, page, or shared module | Push it down to the interactive leaf; pass server output as `children` | The directive marks the module and its transitive imports as client code | RSC `'use client'` |
| react-rsc-non-serializable | Server → Client prop that is a non-Server-Function function, class instance, or null-prototype object | Plain data, JSX, promises, or a Server Function | Throws at the boundary | RSC `'use client'` ("Serializable props") |
| react-rsc-render-mutation | Cookie writes, logout, revalidation or DB writes during a Server Component render | Move to a Server Action | Mutations must not be render side effects | NXS "Avoiding side-effects during rendering" |
| react-rsc-module-state | Mutable module-level variable holding request data in server code | Request-scoped data (`React.cache`, cookies/headers) | Concurrent renders share module state across users | VRB `server-no-shared-module-state` |
| react-rsc-cache-scope | `cache(fn)` created inside a component, or called outside render | Create once at module scope and import the same function | New cache per render; calls outside a component do not cache | API `cache` |

### 4.5 Performance

Report a cost only with its trigger (per keystroke, per scroll frame, per
navigation, once) and its size (subtree, row count, bytes, round trips).
Without a Profiler recording or bundle report, label the finding
"needs measurement" and name the recording that would confirm it. A
calculation under about 1 ms is not expensive (API `useMemo`).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-perf-compiler-memo | Missing or added `useMemo`/`useCallback`/`memo` in a project with React Compiler on | Not a finding; keep existing memo unless tests cover removal; check `"use no memo"` has a TODO and reason | The compiler memoizes; removing manual memo can change output | RC (introduction, 1.0 post, directives) |
| react-perf-compiler-bailout | Compiler on and the component breaks a Rule of React (mutation, ref read in render) | Fix the violation; ERH reports it | The compiler skips that component | ERH, RC |
| react-perf-memo-defeated | Without the compiler: `memo` child receiving inline object/array/function props or `items ?? []` | Hoist constants, `useMemo`/`useCallback`, or drop the `memo` | One always-new prop defeats `memo` | API `memo`, VRB `rerender-memo-with-default-value` |
| react-perf-over-memo | Without the compiler: `useMemo` on cheap values or `useCallback` not feeding a `memo` child or a dependency | Remove | Cost without benefit; readability | API `useMemo` ("Should you add useMemo everywhere?") |
| react-perf-heavy-render | Without the compiler: sort/parse/filter over thousands of items in render, re-run on unrelated updates | `useMemo` after measuring ≥ 1 ms in a production build | Repeated work per render | API `useMemo` |
| react-perf-deferred | Slow subtree re-rendered on every keystroke | `useDeferredValue` (child must be `memo` without the compiler) or a transition | Keeps input responsive; INP | API `useDeferredValue`, WEB INP |
| react-perf-long-list | `items.map` where the length comes from data, not a code bound, with non-trivial rows | Windowing (`react-window`, TanStack Virtual) after measuring; not for code-bounded lists | DOM size drives style, layout and INP cost | WEB "Virtualize long lists", WEB "Optimize INP" |
| react-perf-waterfall-server | Sequential `await`s for independent data in a Server Component or route | Start both, then `Promise.all`; or split into sibling components | Each `await` adds a round trip | NXF "Parallel data fetching" |
| react-perf-waterfall-child | Child cannot start its request until the parent's resolves and it mounts | Start the promise in the parent and pass it to `use()`, or preload | Parent-then-child waterfall | RSC server-components, NXF "Preloading data" |
| react-perf-dedupe | Same data fetched by layout and page, or by several components in one request | `fetch` memoization, `React.cache` for ORM calls, or a client cache library | Duplicate round trips | NXF "Reusing data with React.cache", VRB `client-swr-dedup` |
| react-perf-suspense-placement | One `<Suspense>` at the route root around independent slow parts, or runtime API (`cookies`, `headers`) read with no boundary | Boundary around each slow subtree, no finer than the intended loading sequence | Whole page waits for the slowest part | API `Suspense`, NXF "Streaming", NXC |
| react-perf-use-promise | `use(fetch(...))` or a promise created during render | Cache the promise or create it in a Server Component/loader | New promise each render suspends repeatedly | API `use` |
| react-perf-client-heavy-lib | Markdown, highlighter or date library imported into a Client Component that only formats data | Render it in a Server Component | Server Component dependencies stay out of the client bundle | RSC server-components |
| react-perf-split | Editor, chart or map imported eagerly on a route where it appears after interaction | `lazy`/`next/dynamic` with a nearby `<Suspense>` | Smaller initial bundle; LCP/INP | API `lazy`, VRB `bundle-dynamic-imports` |
| react-perf-barrel | Named imports from a large barrel (`lucide-react`, `@mui/material`) | Direct imports or Next `optimizePackageImports` | Hundreds of ms of import cost per cold start | VRB `bundle-barrel-imports` |
| react-perf-rsc-dup | Same array passed twice to a Client Component in different forms (`list`, `list.toSorted()`) | Pass once, transform on the client | Serialized once per reference | VRB `server-dedup-props` |
| react-perf-activity | Tabs/panels toggled by unmount/remount to keep state, in React 19.2+ | `<Activity mode>`; pause `<video>`/`<audio>`/`<iframe>` in a layout-effect cleanup | State kept, effects cleaned; hidden media keeps playing | API `Activity`, R19 (19.2) |

### 4.6 Accessibility hooks into semantic HTML

Element choice, ARIA roles, headings, landmarks and contrast: the
`semantic-html` skill (not yet written). React-specific items only:

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-a11y-click-div | `onClick` on `div`/`span` without `role`, `tabIndex` and key handlers | `<button>` (or `<a href>` for navigation) | Not reachable by keyboard or assistive tech | JXA `click-events-have-key-events`, `no-static-element-interactions`, `interactive-supports-focus` |
| react-a11y-anchor | `<a onClick>` with no `href`, or `href="#"` | `<button>` or a real `href` | Invalid link semantics | JXA `anchor-is-valid` |
| react-a11y-label | Input with no `<label htmlFor>`, wrapping label, or `aria-label`/`aria-labelledby` | Associate a label | Unlabelled control | JXA `label-has-associated-control` |
| react-a11y-static-id | Hard-coded `id` used for `htmlFor`/`aria-describedby` in a reusable component | `useId()` (with a prefix for several fields) | Duplicate IDs when rendered twice; counters mismatch on hydration | API `useId` |
| react-a11y-alt | `<img>` without `alt` | Description, or `alt=""` for decoration | Screen readers read the file name | JXA `alt-text` |
| react-a11y-focus | Dialog, route change or inline error that moves context without moving focus | Focus the target via a ref in the handler/effect; `flushSync` if the node is added in the same handler | Keyboard users lose their place | LRN "Manipulating the DOM with Refs" |
| react-a11y-autofocus | `autoFocus` on page load | Remove unless the page's single purpose is that field | Disorients screen-reader users | JXA `no-autofocus` |

### 4.7 Testing

Whether tests protect behaviour at all is `test-reviewer`'s question;
patterns and setup are in `react-testing`.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| react-test-query | `getByTestId`, `container.querySelector` where a role, label or text query works | `getByRole`, `getByLabelText`, then text; test ID last | Tests should resemble how the UI is used | RTL "About Queries", "Guiding Principles" |
| react-test-async | Assertion after async UI change using `getBy` or a sleep | `await findBy…` / `waitFor`; `queryBy` for absence | `findBy` waits; `getBy` throws immediately | RTL "About Queries" |
| react-test-act | Direct `act(() => …)` sync form, or `act` warnings left in output | `await act(async () => …)` or RTL helpers (already wrapped) | Sync `act` is slated for removal; warnings mean unflushed updates | API `act` |
| react-test-renderer | New `react-test-renderer` or shallow-renderer tests | RTL | Deprecated in React 19; shallow export removed | CHG 19.0.0 |
| react-test-mock-component | Test mocks child components or hooks to reach a branch | Pass state via props (`react-test-props`) or mock the network; E2E for flows | Mocks test the mock, not the integration | ROR "React calls Components and Hooks", `react-testing` |
| react-test-props | Visual state reachable only through internal state or a live fetch | Test the presenter with props per state | Each state testable in isolation (house rule) | `react-testability` |
| react-test-a11y-runtime | Interactive component with no runtime a11y check | axe in component tests | jsx-a11y sees static JSX only | JXA README, `react-testing` |

## 5. Version-gated modern features

Gate on the installed `react`/`react-dom` (and `next`) versions, never the
latest release.

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| React 18.0 | `createRoot`; automatic batching (do not add `unstable_batchedUpdates`); `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `useId` | Legacy root still in use during migration (runs in 17 mode) | CHG 18.0.0 |
| React 19.0 | Actions, `useActionState`, `useFormStatus`, `useOptimistic`, `use`, `<form action>`; `ref` as a prop instead of `forwardRef`; `<Context value>` instead of `.Provider`; ref cleanup functions; `useDeferredValue(v, initial)`; `<title>`/`<meta>`/`<link precedence>` in components; `preload`/`preinit`/`preconnect`/`prefetchDNS` | Library supporting React 18 consumers keeps `forwardRef`/`.Provider` | R19 |
| React 19.0 removals | Flag `propTypes`, function `defaultProps`, string refs, `ReactDOM.render`/`hydrate`/`findDOMNode`, `react-test-renderer/shallow` | — | CHG 19.0.0 |
| React 19.1 | Owner Stacks (`captureOwnerStack`, dev only) in error tooling | — | CHG 19.1.0 |
| React 19.2 | `<Activity>`; `useEffectEvent`; `cacheSignal` (RSC); Performance tracks; hooks plugin v6 flat `recommended` | Below 19.2: keep event-handler refs instead of `useEffectEvent` | R19 (19.2) |
| React 19.3 | `<ViewTransition>`, Fragment refs, `use(browser())` for browser-only subtrees, Trusted Types integration; transitions render independently; DEV warning for conditional `use()` unblocking | Below 19.3: two-pass render (effect sets `isClient`) for client-only content | CHG 19.3.0 |
| React Compiler 1.0 | Enable it (React 17+; below 19 add `react-compiler-runtime` and a `target`); rely on it for new code; keep existing memo unless tested | Effects that need a stable dependency still use `useMemo`/`useCallback` as an escape hatch | RC |
| Next.js 15.3.1+ | Compiler via SWC | — | RC |
| Next.js 16 (Cache Components) | `fetch` is not cached by default; `use cache` + `cacheLife`; runtime APIs (`cookies`, `headers`, `searchParams`) inside `<Suspense>` | `cacheComponents` off: the previous caching model's guide applies | NXC, NXF |

## 6. Concurrency model

- Rendering can be interrupted, repeated or thrown away before commit;
  only effects and event handlers run once per committed change. Purity is
  what makes this safe (ROR, API `StrictMode`).
- Strict Mode in development double-invokes render functions, effects
  (setup → cleanup → setup) and ref callbacks; a bug that appears only under
  it is a missing cleanup or an impure render (API `StrictMode`).
- Transitions mark updates as non-blocking and interruptible; urgent
  updates (typing) win. Transition updates cannot drive a controlled text
  input. State updates after an `await` inside `startTransition` need their
  own `startTransition` (API `useTransition`). From 19.3, separate
  transitions render independently instead of being batched (CHG 19.3.0).
- Async actions in transitions do not guarantee order; rapid submissions can
  resolve out of order. Use `useActionState`, `<form action>` or Server
  Functions, which order for you, or add your own queue and abort
  (API `useTransition`).
- Effect fetches race: each run needs an `ignore` flag (or an equivalent)
  in its cleanup so a stale response never overwrites a newer one; abort
  alone does not cover chained async steps (LRN "Synchronizing with
  Effects").
- External stores must be read through `useSyncExternalStore` so every
  component in one render sees the same store version (API
  `useSyncExternalStore`).
- Suspense shows a fallback only for Suspense-enabled sources (`lazy`, `use`
  on a cached promise, framework data); an effect fetch never suspends.
  A transition keeps already revealed content instead of falling back;
  a `key` on the boundary resets it (API `Suspense`).
- Error boundaries catch render errors and errors in `startTransition`
  functions, not event handlers, other async code or SSR; `use` cannot sit
  in `try/catch` (API `Component`, API `use`).
- On the server, concurrent requests share module scope: request data in a
  module variable leaks between users (VRB `server-no-shared-module-state`).
- Correctness vs speed: a stale response, lost input or leaked field is
  4.1–4.4; extra renders or round trips that only slow the page are 4.5.

## 7. Linter mapping

Run the project's own checks first (`lefthook.yml`, `.pre-commit-config.yaml`,
its ESLint config, CI results via `gh pr checks`) and pass their output to
the review; never report "no issues" from a tool that did not run. Running
the project's ESLint executes its config, which the diff controls; name the
command instead of running it unless execution was opted into. A project
with `.tsx` files and no `eslint-plugin-react-hooks` is itself a finding.
Do not restate what a tool that ran already reported.

eslint-plugin-react-hooks (v7; flat `recommended`, all 17 rules; compiler
diagnostics work without the compiler installed — ERH, RC 1.0 post):

| Item | Rule |
|---|---|
| react-hook-placement | `rules-of-hooks` |
| react-deps-suppressed, react-deps-unstable (missing deps) | `exhaustive-deps` |
| react-dynamic-hook, react-nested-component | `component-hook-factories`, `static-components` |
| react-mutate-props-state, react-mutate-after-jsx | `immutability` |
| react-impure-render | `purity` (known impure calls only) |
| react-global-mutation | `globals` |
| react-ref-in-render | `refs` |
| react-set-state-in-render | `set-state-in-render` |
| react-effect-derived | `set-state-in-effect` |
| react-perf-compiler-memo (removed memo changes output) | `preserve-manual-memoization` |
| react-perf-compiler-bailout | `incompatible-library`, `unsupported-syntax`, `config`, `gating` |
| `useMemo` without a return value | `use-memo` |
| try/catch around child render | `error-boundaries` |
| react-effect-event-deps | `exhaustive-deps` on a current plugin version (the 19.2 post says to upgrade so `useEffectEvent` is not inserted as a dependency) |

eslint-plugin-jsx-a11y (`recommended`/`strict`): `alt-text`,
`anchor-is-valid`, `click-events-have-key-events`,
`no-static-element-interactions`, `interactive-supports-focus`,
`label-has-associated-control`, `no-autofocus`, plus the ARIA validity
rules (`aria-props`, `aria-role`, `role-has-required-aria-props`,
`role-supports-aria-props`). It checks static JSX only; pair it with axe at
runtime (JXA).

TypeScript-level checks for `.tsx` (strictness, floating promises, `any`)
are mapped in the TypeScript standard's section 7.

No tool decides: whether an effect synchronizes with an external system or
should be render/handler code, whether state is redundant, where a
`'use client'` or `<Suspense>` boundary belongs, whether a Server Action
authorizes the specific resource, which fields a DTO needs, whether a list
is data-bounded, whether a re-render costs anything, or whether a version
gate applies. Those are the review's work.
