# PHP review standard

The one PHP standard for both the model writing PHP and `code-reviewer`
reviewing a PHP diff. No PHP reviewer agent exists; this file is the PHP
knowledge the review reads. It lists what to check and where the rule comes
from; detail and code live in the skills it links: `php-patterns` (house
style: DTOs, thin controllers, DI, boundaries), `php-testing` (PHPUnit/Pest,
coverage), `laravel-patterns`, `laravel-tdd` and `laravel-verification`
(Laravel structure, tests, the release check loop).

Before applying any rule, read `require.php` in `composer.json` (the language
floor), the PHP version the CI matrix or the container image runs, whether
the project runs under PHP-FPM or a persistent worker (Laravel Octane,
FrankenPHP worker mode, RoadRunner, Swoole), and the pinned major of
`laravel/framework` when present. A rule gated on a version does not apply
below it. Supported PHP branches on 2026-10-19 are 8.2 to 8.5; 8.2 gets
security fixes only until 2026-12-31, and 8.1 is end of life (SUP).
Laravel 13 requires PHP 8.3 (LV-RN).

Sources are cited by the short name in the first column of section 1; a
`#fragment` after it names the anchor on that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| PER | PER Coding Style 3.1 | https://www.php-fig.org/per/coding-style/ | Formatting and declaration order; it extends, expands and replaces PSR-12 | 3.1, current on php-fig.org; fetched 2026-10-19 | PHP-FIG (fig-standards: CC BY 3.0 text, MIT code) |
| PSR4 | PSR-4 Autoloader | https://www.php-fig.org/psr/psr-4/ | Namespace prefix to base directory, case-sensitive class names | Accepted | Same as PER |
| SUP | PHP Supported Versions | https://www.php.net/supported-versions.php | Active and security support dates per branch | Fetched 2026-10-19 | PHP Group site |
| REL81 … REL85 | PHP 8.1–8.5 release pages | https://www.php.net/releases/8.1/en.php … https://www.php.net/releases/8.5/en.php | Version-gated features and deprecations | 8.5 released 2025-11-20 (latest) | PHP Group site |
| TYPES | Manual: Type declarations | https://www.php.net/manual/en/language.types.declarations.php | `strict_types` scope, coercive mode, implicit nullable deprecation | Current manual | CC BY 3.0 (manual copyright page) |
| CMP | Manual: Comparison operators | https://www.php.net/manual/en/language.operators.comparison.php | `==` vs `===`, numeric strings, 8.0 string-number change | Current manual | CC BY 3.0 |
| INARR | Manual: `in_array` | https://www.php.net/manual/en/function.in-array.php | Loose default, `strict` parameter | Current manual | CC BY 3.0 |
| ENUM | Manual: Backed enumerations | https://www.php.net/manual/en/language.enumerations.backed.php | `from` throws `ValueError`, `tryFrom` returns `null` | Current manual | CC BY 3.0 |
| PROP | Manual: Properties (readonly) | https://www.php.net/manual/en/language.oop5.properties.php | Readonly rules, interior mutability, clone (8.3) | Current manual | CC BY 3.0 |
| MATCH | Manual: `match` | https://www.php.net/manual/en/control-structures.match.php | Identity comparison, `UnhandledMatchError` | Current manual | CC BY 3.0 |
| EH | Manual: Throwable errors | https://www.php.net/manual/en/language.error-handling.throwable.php | `Error` vs `Exception` hierarchy, custom exceptions, global handler | Current manual | CC BY 3.0 |
| EXC | Manual: `Exception` class | https://www.php.net/manual/en/class.exception.php | `$previous` chaining, `getPrevious` | Current manual | CC BY 3.0 |
| ERRCTL | Manual: Error control operator | https://www.php.net/manual/en/language.operators.errorcontrol.php | `@` suppresses diagnostics | Current manual | CC BY 3.0 |
| PDO | Manual: Prepared statements | https://www.php.net/manual/en/pdo.prepared-statements.php | Placeholders, whole-value binding only | Current manual | CC BY 3.0 |
| PDOERR | Manual: PDO errors and error handling | https://www.php.net/manual/en/pdo.error-handling.php | `ERRMODE_EXCEPTION` default since 8.0 | Current manual | CC BY 3.0 |
| PWH | Manual: `password_hash` | https://www.php.net/manual/en/function.password-hash.php | `PASSWORD_DEFAULT`, 255-byte column, bcrypt 72-byte cut, cost 12 since 8.4 | Current manual | CC BY 3.0 |
| UNSER | Manual: `unserialize` | https://www.php.net/manual/en/function.unserialize.php | Never on untrusted input, even with `allowed_classes` | Current manual | CC BY 3.0 |
| HSC | Manual: `htmlspecialchars` | https://www.php.net/manual/en/function.htmlspecialchars.php | Default flags `ENT_QUOTES \| ENT_SUBSTITUTE \| ENT_HTML401` since 8.1 | Current manual | CC BY 3.0 |
| UPL | Manual: POST method uploads | https://www.php.net/manual/en/features.file-upload.post-method.php | `$_FILES` `type` and `full_path` are client data; `basename` | Current manual | CC BY 3.0 |
| FN | Manual function pages: `extract`, `escapeshellarg`, `mt_rand`, `random_int`, `hash_equals`, `move_uploaded_file` | https://www.php.net/manual/en/function.extract.php, https://www.php.net/manual/en/function.escapeshellarg.php, https://www.php.net/manual/en/function.mt-rand.php, https://www.php.net/manual/en/function.random-int.php, https://www.php.net/manual/en/function.hash-equals.php, https://www.php.net/manual/en/function.move-uploaded-file.php | The warning on each page | Current manual | CC BY 3.0 |
| SESS | Manual: Session management basics | https://www.php.net/manual/en/features.session.security.management.php | `session_regenerate_id` procedure | Current manual | CC BY 3.0 |
| FIB | Manual: Fibers | https://www.php.net/manual/en/language.fibers.php | Full-stack suspension, cooperative | Current manual | CC BY 3.0 |
| PERSIST | Manual: Persistent database connections | https://www.php.net/manual/en/features.persistent-connections.php | Per-request lifecycle under CGI, FPM worker reuse | Current manual | CC BY 3.0 |
| OPC / PRELOAD | Manual: OPcache configuration; Preloading | https://www.php.net/manual/en/opcache.configuration.php, https://www.php.net/manual/en/opcache.preloading.php | `validate_timestamps`, `revalidate_freq`; preload trade-offs | Current manual | CC BY 3.0 |
| CLI | Manual: Command line options | https://www.php.net/manual/en/features.commandline.options.php | `php -l` syntax check | Current manual | CC BY 3.0 |
| PHPSTAN | PHPStan: Rule Levels; Discovering Symbols | https://phpstan.org/user-guide/rule-levels, https://phpstan.org/user-guide/discovering-symbols | Levels 0–10, baseline, `bootstrapFiles` are executed | PHPStan 2.3.1 (2026-10-08) | MIT |
| PSSR | phpstan-strict-rules | https://github.com/phpstan/phpstan-strict-rules | Loose comparison, `empty()`, `in_array` strict, booleans in conditions | Current `2.x` README | MIT |
| PSALM | Psalm: Error levels; Security analysis | https://psalm.dev/docs/running_psalm/error_levels/, https://psalm.dev/docs/security_analysis/ | Levels 1–8 (default 2), `--taint-analysis` | Psalm 6.20.0 (2026-10-09) | MIT |
| CSF | PHP-CS-Fixer rule sets | https://cs.symfony.com/doc/ruleSets/index.html | `@PER-CS`, `@PER-CS3x0`, `@PHP8x5Migration` | v3.95.27 (2026-09-22) | MIT |
| RECTOR | Rector: Set lists | https://getrector.com/documentation/set-lists | `withPhpSets()` reads `composer.json`, `--dry-run` | Rector 2.7.0 (2026-10-06) | MIT |
| OWASP-PHP | OWASP PHP Configuration Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/PHP_Configuration_Cheat_Sheet.html | `display_errors`, `allow_url_include`, session cookie flags | Fetched 2026-10-19 | CC BY-SA 4.0 |
| OWASP-SQLI | OWASP SQL Injection Prevention | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html | Parameterization; allow-lists for identifiers and sort order | Fetched 2026-10-19 | CC BY-SA 4.0 |
| OWASP-XSS | OWASP XSS Prevention | https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html | Encoding per output context | Fetched 2026-10-19 | CC BY-SA 4.0 |
| OWASP-UPL | OWASP File Upload | https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html | Extension allow-list, spoofed Content-Type, random names, outside webroot | Fetched 2026-10-19 | CC BY-SA 4.0 |
| OWASP-DESER | OWASP Deserialization | https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html | PHP `unserialize` review, JSON instead | Fetched 2026-10-19 | CC BY-SA 4.0 |
| LV-REL | Laravel: Eloquent relationships | https://laravel.com/docs/13.x/eloquent-relationships | Eager loading, child-to-parent N+1, `withCount`, `preventLazyLoading`, `automaticallyEagerLoadRelationships` | 13.x (framework v13.37.0) | MIT (laravel/docs) |
| LV-ELO | Laravel: Eloquent | https://laravel.com/docs/13.x/eloquent | `$fillable`/`$guarded`, `preventSilentlyDiscardingAttributes`, `chunkById` | 13.x | MIT |
| LV-QB | Laravel: Query builder | https://laravel.com/docs/13.x/queries | PDO binding; column names never from input; raw expressions | 13.x | MIT |
| LV-VAL | Laravel: Validation | https://laravel.com/docs/13.x/validation | `validated()`, allowed array keys, `unique` `ignore` injection | 13.x | MIT |
| LV-Q | Laravel: Queues | https://laravel.com/docs/13.x/queues | `afterCommit`, model serialization, `--timeout` vs `retry_after`, long-lived workers | 13.x | MIT |
| LV-BLADE | Laravel: Blade | https://laravel.com/docs/13.x/blade | `{{ }}` escapes, `{!! !!}` does not | 13.x | MIT |
| LV-CFG | Laravel: Configuration | https://laravel.com/docs/13.x/configuration | `env()` after `config:cache` | 13.x | MIT |
| LV-OCT | Laravel: Octane | https://laravel.com/docs/13.x/octane | App kept in memory: stale injected container/request, static-array leaks | 13.x | MIT |
| LV-TEST | Laravel: HTTP client; Database testing | https://laravel.com/docs/13.x/http-client, https://laravel.com/docs/13.x/database-testing | `Http::preventStrayRequests`, `RefreshDatabase` | 13.x | MIT |
| LV-RN | Laravel 13 release notes | https://laravel.com/docs/13.x/releases | PHP 8.3 minimum; 18 months bug fixes, 2 years security | 13.x | MIT |
| PHPUNIT | PHPUnit manual: Writing tests | https://docs.phpunit.de/en/13.4/writing-tests-for-phpunit.html | `expectException` placement | PHPUnit 13.4 | Not stated on the page |

PSR-12 (https://www.php-fig.org/psr/psr-12/) is replaced by PER Coding Style;
do not cite it as current. Not opened in this run and therefore not cited:
Composer docs (`composer audit`), Laravel Pint, Larastan, Symfony docs, the
Laravel security pages. Treat any claim resting on them as unverified.

## 2. Mindset

- Every new file starts with `declare(strict_types=1);`. It applies to calls
  made from that file only; a non-strict caller still coerces, and internal
  callbacks ignore it (TYPES `#language.types.declarations.strict`).
- Parameters, returns and properties carry native types; docblock types only
  add what the engine cannot say (generics, array shapes) for PHPStan.
- A closed set of values is a backed enum, not string or int constants;
  external input enters through `tryFrom` and a handled `null` (ENUM, REL81).
- Data crossing a boundary is a readonly DTO or value object, not an
  associative array (REL81, `php-patterns`).
- Compare with `===`; loose comparison is a decision that needs a reason (CMP).
- Failures are exceptions, never `false`/`null` sentinels in new code (EH,
  `php-patterns`).
- Know the execution model before judging state: under PHP-FPM each request
  starts clean; under a persistent worker statics, singletons and memory
  survive across requests (section 6).
- Formatting is the formatter's job (PER via PHP-CS-Fixer or Pint); it is not
  review.

## 3. Habits carried from other languages or old PHP

| Habit | Do instead | Source |
|---|---|---|
| `==`, `!=`, `switch`, `in_array`/`array_search` without `strict`, `empty()` (old PHP, JS) | `===`, `match`, `strict: true`; explicit checks instead of `empty()` | CMP, INARR, MATCH, PSSR |
| Assuming pre-8.0 `0 == "a"` behaviour, or relying on it | Since 8.0 a number and a non-numeric string compare as strings; never depend on either | CMP `#language.operators.comparison` warning |
| Associative arrays as records passed between layers | Readonly class or DTO with typed properties; array shapes in docblocks only at edges | REL81 "Readonly Properties", `php-patterns` |
| Class constants as an enum | Backed enum | REL81 "Enumerations" |
| Return `false`/`null`/`-1` on failure, check `mysqli_error()` | Throw; PDO throws by default since 8.0 and mysqli since 8.1 | PDOERR, REL81 deprecations list |
| `@` to silence warnings | Check the condition first, or handle the failure; `@` hides every diagnostic of the expression | ERRCTL |
| `function f(Foo $x = null)` | `?Foo $x = null`; implicit nullable is deprecated in 8.4 | TYPES `#language.types.declarations.nullable`, REL84 |
| Typo-tolerant dynamic properties (`$this->nmae = …`) | Declare properties; dynamic properties are deprecated in 8.2 | REL82 |
| `static` arrays, singletons or globals assumed reset per request (true only under FPM) | Request-scoped state through the container or parameters; nothing request-bound in statics under Octane or queue workers | LV-OCT `#managing-memory-leaks`, LV-Q `#queue-workers-and-deployment` |
| `rand`/`mt_rand`/`uniqid` for tokens | `random_bytes`, `random_int`, `Random\Randomizer` | FN `mt_rand`, FN `random_int`, REL82 |
| `md5`/`sha1`/`crypt` for passwords | `password_hash(PASSWORD_DEFAULT)` and `password_verify` | PWH |
| `serialize`/`unserialize` for caches, cookies or transport | JSON; `__serialize`/`__unserialize` instead of the soft-deprecated `__sleep`/`__wakeup` | UNSER, REL85 |
| Backtick operator, `(integer)`/`(boolean)`/`(double)` casts | `shell_exec` or better no shell; `(int)`, `(bool)`, `(float)` (deprecated 8.5) | REL85 |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might be
unsafe" is not a finding.

### 4.1 Correctness and types

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-strict-types | New file without `declare(strict_types=1);`, or it placed after other statements | Add it as the first statement | Scalars are coerced silently otherwise | TYPES, PER §3 |
| php-strict-scope | Code relies on strict typing for values arriving from a non-strict caller or from `array_map`/`usort` callbacks | Validate at the boundary; do not assume the declaration protects the callee | Strictness follows the caller's file, and internal-function callbacks are unaffected | TYPES (notes under "Strict typing") |
| php-loose-compare | `==`/`!=` where either side can be string, int, bool or null | `===`/`!==`; a kept `==` carries a reason | Type juggling makes `"1" == "01"` and `"10" == "1e1"` true | CMP |
| php-in-array-strict | `in_array`, `array_search`, `array_keys($a, $v)` without the strict argument | `strict: true` | Non-strict mode still compares loosely: `true` matches any truthy string | INARR, PSSR |
| php-switch-loose | `switch` on strings/ints mixing types, or a `switch` that only maps values | `match` | `match` compares with `===` and throws on no arm | MATCH |
| php-match-default | `match` on external or widening input with no `default` arm | Add `default` or prove exhaustiveness (enum) | `UnhandledMatchError` at runtime | MATCH |
| php-empty | `empty($x)` / `!$x` where `"0"`, `0` or `[]` are valid values | Explicit `=== null`, `=== ''`, `count() === 0` | `"0"` is falsy | PSSR, CMP |
| php-enum-from | `Enum::from($request->…)` on untrusted input | `tryFrom` and handle `null`, or catch `ValueError` and map to a 4xx | `from` throws `ValueError` on unknown values | ENUM |
| php-enum-constants | New string/int constants modelling a closed set | Backed enum | Validation for free | REL81 |
| php-readonly-mutation | Readonly property holding an object or array that is changed through it | Clone into a new value (`clone` with, 8.5) or make the inner value immutable | Readonly does not prevent interior mutability | PROP `#language.oop5.properties.readonly-properties` |
| php-readonly-clone | `clone` of a readonly object then writing a property outside `__clone` (below 8.5) | `__clone` (8.3+) or a constructor-based wither; `clone($obj, [...])` from 8.5 | Readonly can only be reinitialized inside `__clone` | PROP, REL83, REL85 |
| php-implicit-nullable | `Type $x = null` | `?Type $x = null` | Deprecated 8.4 | TYPES, REL84 |
| php-dynamic-prop | Assignment to an undeclared property; new `#[\AllowDynamicProperties]` | Declare the property | Deprecated 8.2; usually a typo | REL82 |
| php-mixed | New `mixed`, untyped parameter, or `@param array` without a shape | Narrow the type; a kept `mixed` carries a reason | PHPStan level 9–10 rejects operations on `mixed` | PHPSTAN |
| php-float-int | Float or numeric string cast to `int` where precision matters (money, IDs) | Integers in minor units, `BcMath\Number` (8.4) | Implicit lossy float→int deprecated 8.1; 8.5 warns on unrepresentable casts | REL81, REL84, REL85 |
| php-null-offset | `$a[null]`, `array_key_exists(null, …)` | Use `''` or fix the key | Deprecated 8.5 | REL85 |
| php-override | Method meant to override a parent or interface method without `#[\Override]` (floor 8.3+) | Add it | A renamed parent method then fails loudly | REL83 |
| php-psr4 | New class whose namespace does not match its path under the `composer.json` `autoload.psr-4` prefix, or case differs | Move or rename | The autoloader cannot find it; case-sensitive filesystems differ from macOS | PSR4 |

### 4.2 Errors and exceptions

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-false-return | New function returning `false`/`null` to signal failure | Throw a domain exception; `null` only for a legitimate "absent" | Callers forget to check sentinels | `php-patterns`, EH |
| php-catch-throwable | `catch (\Throwable)` or `catch (\Error)` outside the top-level handler | Catch the specific exception | `Error` covers `TypeError` and other programming bugs | EH "Throwable hierarchy" |
| php-swallow | `catch (…) {}` or log-and-continue where the caller needs the failure | Handle, rethrow, or comment why ignoring is right | Lost failures | EH |
| php-chain | New exception thrown inside `catch` without passing `$previous` | `new X($msg, 0, $e)` | Keeps the cause chain | EXC |
| php-custom-exception | Custom exception overriding `__construct` without `parent::__construct()` | Call the parent | Message, code and previous stay unset | EH "Extending exceptions" |
| php-error-suppress | `@` on a call | Check preconditions or handle the error explicitly | Suppresses every diagnostic of the expression | ERRCTL |
| php-pdo-errmode | `PDO::ATTR_ERRMODE` set to silent/warning, or result checks of `execute()` with no exception mode | Leave `ERRMODE_EXCEPTION` (default since 8.0) | Silent failures | PDOERR |
| php-display-errors | `ini_set('display_errors', '1')`, `APP_DEBUG=true` committed for production | Off in production; log instead | Leaks paths and internals | OWASP-PHP |
| php-finally-return | `return` inside `finally` | Move it out | It discards the in-flight exception | EH (general knowledge; behaviour confirmed in the manual's try/finally rules — unverified in this run) |

### 4.3 Security specific to PHP

Language and framework sinks only. Authorization design, secret handling,
SSRF and supply-chain review belong to `security-reviewer`; hand those over.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-sql-concat | SQL built with `.`/interpolation/`sprintf` and passed to `query`/`exec`/`prepare`, `DB::raw`, `whereRaw`, `orderByRaw`, `selectRaw` with input | Placeholders (`?`, `:name`) or query-builder bindings | SQL injection | PDO, LV-QB `#raw-expressions`, OWASP-SQLI |
| php-sql-identifier | Column, table or sort direction taken from the request (`orderBy($request->sort)`) | Map to an allow-list in code | Placeholders bind values only; identifiers cannot be bound | PDO "Invalid use of placeholder", LV-QB, OWASP-SQLI `#defense-option-3-allow-list-input-validation` |
| php-unique-ignore | Laravel `Rule::unique(...)->ignore($request->input(...))` | Pass a model ID, never request input | SQL injection | LV-VAL `#rule-unique` |
| php-xss-echo | `echo`/`print`/`<?=` of variables in templates without `htmlspecialchars`; Blade `{!! !!}` with user data | Escape (`{{ }}` in Blade); raw output only for sanitized HTML, with a reason | XSS | HSC, LV-BLADE `#displaying-unescaped-data` |
| php-xss-flags | `htmlspecialchars($s)` with the floor below 8.1, or explicit `ENT_COMPAT` | `ENT_QUOTES \| ENT_SUBSTITUTE` and `'UTF-8'` | Pre-8.1 default leaves `'` unescaped, breaking single-quoted attributes | HSC changelog 8.1.0 |
| php-xss-context | HTML-escaped value placed in `<script>`, an event-handler attribute, `style`, or an `href`/`src` | Encoder for that context (`json_encode` with `JSON_HEX_*` for JS data, URL encoding plus scheme allow-list) | HTML encoding does not protect JS, CSS or URL contexts | OWASP-XSS `#output-encoding-for-html-attribute-contexts`, `#output-encoding-for-url-contexts` |
| php-upload-trust | `$_FILES[..]['type']`, `['name']` or `['full_path']` used to decide type or path; `copy`/`rename` of `tmp_name` | Detect type from content (`finfo`), allow-list extensions, generate the stored name, `move_uploaded_file`, store outside the web root | Client-supplied fields are not checked by PHP | UPL, FN `move_uploaded_file`, OWASP-UPL |
| php-upload-ext | Extension check by regex or deny-list | Allow-list; reject double extensions, `.phtml`/`.phar`/`.php5`, and colons | Alternative extensions reach the PHP interpreter | OWASP-UPL `#extension-validation` |
| php-unserialize | `unserialize` on data from a request, cookie, cache shared with clients, or queue payload from outside | JSON; HMAC-sign if serialized data must round-trip | Object instantiation and autoloading can execute code even with `allowed_classes` | UNSER, OWASP-DESER |
| php-password | `md5`/`sha1`/`hash()` on passwords; `PASSWORD_BCRYPT` with long passphrases; column shorter than 255 | `password_hash(PASSWORD_DEFAULT)`, `password_verify`, `password_needs_rehash`; `VARCHAR(255)` | Fast hashes are brute-forceable; bcrypt cuts input at 72 bytes; default algorithm may change | PWH |
| php-token-compare | `==`/`===` on tokens, HMACs, API keys | `hash_equals` | Timing attack | FN `hash_equals` |
| php-weak-random | `rand`, `mt_rand`, `uniqid`, `lcg_value` for tokens, nonces, reset codes | `random_bytes`/`random_int`/`Randomizer` | Not cryptographically secure | FN `mt_rand`, FN `random_int` |
| php-extract | `extract($_GET)`, `extract($_POST)`, `extract($request->all())` | Explicit assignment | Overwrites local variables from input | FN `extract` |
| php-shell | `exec`/`system`/`shell_exec`/`passthru`/`proc_open`/backticks with input | `proc_open` with an argument array, or `escapeshellarg` per argument when a shell is unavoidable | Command injection | FN `escapeshellarg`, OWASP-PHP (`disable_functions`) |
| php-eval-include | `eval`, `include`/`require` with a path built from input, `allow_url_include` | Dispatch table; fixed paths | Code execution | OWASP-PHP, https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html |
| php-session-fixation | Login or privilege change without `session_regenerate_id(true)` (or Laravel's `$request->session()->regenerate()`) | Regenerate on authentication | Session fixation | SESS, `php-patterns` |
| php-session-cookie | Session config without `httponly`, `secure`, `samesite`, `use_strict_mode` | Set them | Cookie theft and fixation | OWASP-PHP |
| php-mass-assign | `Model::create($request->all())`, `fill($request->input())`, new `$guarded = []`, `Model::unguard()` | `$request->validated()` into `$fillable` columns | A posted `is_admin` changes a column | LV-ELO `#mass-assignment`, LV-VAL |
| php-sensitive-param | Function receiving a password or secret (floor 8.2+) | `#[\SensitiveParameter]` | Keeps it out of stack traces | REL82 |

### 4.4 Performance

Measure before asserting a hot path; a finding names the request or job
where the cost lands.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-n-plus-one | Relationship property read inside a loop over a collection (`$post->author->name` in `foreach`, Blade `@foreach`, API resource) | `with([...])` at the query; `load` when already fetched | One query per row | LV-REL `#eager-loading` |
| php-n-plus-one-inverse | Loop over eager-loaded children that reads `$child->parent` | `chaperone()` on the relation, or eager load the inverse | Eloquent does not hydrate the parent on children | LV-REL (N + 1 note under "Automatically Hydrating Parent Models") |
| php-count-relation | `$model->relation->count()` or `count($model->relation)` in a loop | `withCount` / `withExists` / `withSum` | Loads every related row to count it | LV-REL `#counting-related-models` |
| php-lazy-guard | Laravel app with no `Model::preventLazyLoading(! app()->isProduction())` and repeated N+1 findings | Suggest enabling it outside production | Lazy loads then fail in tests | LV-REL `#preventing-lazy-loading` |
| php-big-result | `Model::all()`/`->get()` over an unbounded table in a job or command | `chunkById`, `lazyById`, or pagination | Memory exhaustion | LV-ELO `#chunking-results` |
| php-chunk-update | `chunk()` while updating the filtered column | `chunkById` | Rows skipped | LV-ELO |
| php-opcache-deploy | Deployment with `opcache.validate_timestamps=0` and no `opcache_reset`/FPM reload | Reset or reload on deploy | Old code keeps serving | OPC |
| php-preload | New `opcache.preload` script | Restart on every deploy; measure memory | Preload needs a process restart to clear, trades memory for speed | PRELOAD |
| php-worker-leak | Static array or singleton accumulating per request under Octane, or per job in a queue worker | Reset per request/job, or don't keep it | Memory grows until the worker restarts | LV-OCT `#managing-memory-leaks`, LV-Q |
| php-job-payload | Queued job constructor taking models with large loaded relations | Pass IDs or `withoutRelations` | Relations are serialized and refetched in full | LV-Q `#handling-relationships` |
| php-persistent-conn | New `PDO::ATTR_PERSISTENT` | Confirm SAPI reuse and that no transaction or lock spans requests | Persistent links persist only per FPM/Apache worker and carry state | PERSIST |

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-array-record | Public method returning or accepting an associative array with fixed keys | DTO/value object | Untyped records drift | `php-patterns`, REL81 |
| php-dto-readonly | New DTO with public mutable properties (floor 8.2+) | `readonly class` or readonly promoted properties | Value objects stay values | REL82, PROP |
| php-bool-param | Boolean flag parameters switching behaviour | Separate methods or an enum | Call sites unreadable | general knowledge |
| php-never | Function that always throws or exits typed `void` | `never` (8.1+) | Static analysis learns the branch ends | REL81 |
| php-no-discard | Function whose result must be used (floor 8.5) | `#[\NoDiscard]` | Ignored results warn | REL85 |
| php-deprecated-attr | `@deprecated` docblock on a new API (floor 8.4) | `#[\Deprecated(message:, since:)]` | Engine emits the deprecation | REL84 |
| php-getter-setter | Getter/setter pairs that only guard writes (floor 8.4) | Asymmetric visibility `public private(set)` or property hooks | Less boilerplate, same guarantee | REL84 |
| php-service-locator | `app()`, `resolve()`, facades or `$container->get()` inside domain services | Constructor injection | Hidden dependencies; stale under Octane | `php-patterns`, LV-OCT `#dependency-injection-and-octane` |

### 4.6 Framework-specific (Laravel, when used)

Structure and patterns: `laravel-patterns`. These are review triggers only.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-lv-validated | `$request->all()`/`input()` passed into models or services after validation | `$request->validated()` or `safe()->only()` | Unvalidated keys pass through | LV-VAL `#working-with-validated-input` |
| php-lv-array-keys | `'field' => 'array'` rule without listing allowed keys | `array:key1,key2` | `validated()` returns every key of the array otherwise | LV-VAL `#validating-arrays` |
| php-lv-authorize | Form request `authorize()` returning `true` on a resource-owned action with no policy elsewhere | Policy check | Any user can act on any resource | LV-VAL `#authorizing-form-requests` |
| php-lv-env | `env()` called outside `config/*.php` | Read through `config()` | Returns only system variables after `config:cache` | LV-CFG `#configuration-caching` |
| php-lv-job-commit | Job, event or notification dispatched inside `DB::transaction` | `afterCommit()` or `after_commit => true` | Worker may run before commit and see missing rows | LV-Q `#jobs-and-database-transactions` |
| php-lv-timeout | Worker `--timeout` ≥ connection `retry_after` | `--timeout` several seconds shorter | Job runs twice | LV-Q `#job-expiration` |
| php-lv-idempotent | Job with external side effects and `$tries > 1` or backoff | Idempotency key, `ShouldBeUnique`, or `WithoutOverlapping` | Retries repeat side effects | LV-Q `#unique-jobs`, `#preventing-job-overlaps` |
| php-lv-octane-inject | Singleton binding that captures `$app`, `Request` or config in its constructor (Octane apps) | Inject a resolver closure, or bind per request | Stale container or request on later requests | LV-OCT `#dependency-injection-and-octane` |
| php-lv-silent-discard | Fillable mismatch hidden in development | `Model::preventSilentlyDiscardingAttributes(! app()->isProduction())` | Dropped attributes go unnoticed | LV-ELO |

### 4.7 Naming and readability

PER is enforced by the formatter; flag only what it cannot fix.

| id | Trigger | Check | Source |
|---|---|---|---|
| php-per | Formatting differs from the project's fixer config | Run the fixer; do not hand-review layout | PER, CSF |
| php-case | Classes not PascalCase, methods not camelCase, constants not UPPER_CASE | Rename | PER §2.1 (PSR-1) |
| php-keywords-lower | `NULL`, `TRUE`, `Array` types | Lower case for keywords and types | PER §2.5 |
| php-imports | Fully qualified names inline where `use` fits; unused `use` | Import; remove unused | PER §3, `php-patterns` |
| php-arrow-fn | Closure with one returned expression and `use` captures | Arrow function `fn` | PER §7.1 |
| php-casts | `(integer)`, `(boolean)`, `(double)`, `(binary)` | `(int)`, `(bool)`, `(float)`, `(string)` | REL85 |

### 4.8 Testing

Patterns: `php-testing`, `laravel-tdd`. `test-reviewer` owns whether tests
protect behaviour; these are PHP-specific forms.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| php-test-expect | `expectException` followed by setup code that could throw the same type | Call it right before the call under test | Setup throwing passes the test | PHPUNIT |
| php-test-message | `expectException(Exception::class)` only | Narrow class plus `expectExceptionMessage`/code where the message is contract | Any exception passes | PHPUNIT |
| php-test-stray-http | Feature test hitting code that uses Laravel's HTTP client with no fake | `Http::preventStrayRequests()` with `Http::fake` | Real network in tests | LV-TEST |
| php-test-db-reset | Tests sharing database state without `RefreshDatabase` (or the project's equivalent) | Reset per test | Order-dependent results | LV-TEST |
| php-test-framework-mix | New Pest file in a PHPUnit suite or the reverse | Follow the configured framework | `php-testing` house rule | `php-testing` |

## 5. Version-gated modern features

Gate on `require.php` in `composer.json` and the deployed interpreter, never
on the latest release. Rector's `withPhpSets()` reads the floor from
`composer.json` and applies most rewrites; run it with `--dry-run` before hand
edits (RECTOR). PHP-CS-Fixer's `@PHP8xNMigration` sets cover syntax-level
upgrades (CSF).

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| 8.1 (EOL) | Enums; readonly properties; `never`; first-class callables `f(...)`; `new` in initializers; pure intersection types; `0o` octal; Fibers (for libraries); `array_is_list` | Floor 8.0; constants when values must be extended by other packages (enums cannot be extended) | REL81, ENUM |
| 8.2 | `readonly class`; DNF types; `null`/`false`/`true` standalone types; `Random\Randomizer`; constants in traits; `#[\SensitiveParameter]`. Dynamic properties deprecated | Mutable entities (ORM models) stay non-readonly | REL82 |
| 8.3 | Typed class constants; `#[\Override]`; readonly reinitialized in `__clone`; `json_validate`; `Randomizer::getBytesFromString`; `php -l` on many files | `json_decode` when the decoded value is needed anyway (validating then decoding parses twice) | REL83, PROP |
| 8.4 | Property hooks; asymmetric visibility; `#[\Deprecated]`; `array_find`/`array_find_key`/`array_any`/`array_all`; `new Foo()->bar()`; lazy objects; `BcMath\Number`; `Pdo\Mysql` etc. subclasses; bcrypt cost 12. Implicit nullable and `E_STRICT` deprecated | Plain public readonly properties when no logic is needed — hooks add indirection; loops when early-exit logic is complex | REL84, PWH |
| 8.5 | Pipe operator `\|>`; `clone($obj, ['prop' => …])`; `#[\NoDiscard]`; URI extension (`Uri\Rfc3986\Uri`, `Uri\WhatWg\Url`); `array_first`/`array_last`; closures in constant expressions; `final` on promoted properties; fatal-error backtraces. Deprecated: backtick operator, non-canonical casts, `case …;`, `null` array offsets; `__sleep`/`__wakeup` soft-deprecated | Pipes for one or two calls read worse than a nested call; `parse_url` only where the floor is below 8.5 | REL85 |

## 6. Concurrency model

- Shared-nothing under PHP-FPM and Apache `mod_php`: each request runs in a
  worker process from start to finish, and the next request from the same
  client may land in a different process. Nothing in PHP memory is shared
  between requests or processes; persistent DB connections are the
  per-worker exception and carry their state with them — PERSIST.
- Coordination across requests therefore lives outside PHP: database
  constraints and transactions, row locks, Redis or cache locks. An
  in-process lock, static cache or counter does not coordinate two requests.
  A check-then-act across two queries is a race between concurrent requests;
  use a unique constraint, `SELECT … FOR UPDATE`, or an atomic update.
- Persistent workers (Octane on FrankenPHP, Swoole, RoadRunner; queue
  workers) boot the application once and reuse it. Service-provider `boot`
  runs once, singletons and statics persist, injected request or container
  objects go stale, and static arrays leak. Octane restarts a worker after
  500 requests by default (`--max-requests`); queue workers need
  `queue:restart` on deploy and `--max-jobs`/`--max-time` to release memory —
  LV-OCT, LV-Q.
- Fibers (8.1) are cooperative: a fiber runs until it calls
  `Fiber::suspend()`; nothing preempts it. Fibers do not provide concurrency
  by themselves; an event loop library (Revolt, AMPHP, ReactPHP) schedules
  them, and a blocking call (PDO, `file_get_contents`, `sleep`) blocks every
  fiber — FIB, REL81. Application code rarely calls the Fiber API directly.
- Slow or retryable work goes to a queue. Jobs run at least once: design for
  retries (idempotency, `ShouldBeUnique`, `WithoutOverlapping`), dispatch
  after commit, and keep `--timeout` below `retry_after` — LV-Q.
- Octane's `Octane::concurrently` needs Swoole; on other servers there is no
  in-request parallelism — LV-OCT `#concurrent-tasks`.
- Correctness vs speed: a race, lost update, duplicate job or stale state is
  4.6 or 4.1; a model that is only slow is 4.4.

## 7. Linter mapping

Run the project's own checks first (`phpstan.neon`/`phpstan.neon.dist`,
`psalm.xml`, `.php-cs-fixer.php`/`.php-cs-fixer.dist.php`, `pint.json`,
`rector.php`, Composer scripts, `lefthook.yml`, `.pre-commit-config.yaml`,
CI results via `gh pr checks`) and pass their output to the review; never
report "no issues" from a tool that did not run. Do not restate what a tool
that ran already reported.

Safety: `php -l` only parses (CLI). PHPStan executes files listed under
`bootstrapFiles` (PHPSTAN discovering-symbols), and framework extensions may
boot the application; Rector and Psalm load the project autoloader. When the
diff changes those configs or bootstrap files, name the command instead of
running it. Never run `phpunit`, `pest`, `artisan` or `composer install`
against a diff without explicit opt-in.

| Tool | What to run | Covers |
|---|---|---|
| `php -l <files>` | Syntax check of changed files (several files per call from 8.3) | Parse errors only |
| PHPStan | `vendor/bin/phpstan analyse` at the configured level; levels are cumulative 0–10, `max` aliases the highest; a baseline hides old errors, not new ones | Level 3 return/property types, 5 argument types, 6 missing typehints, 7 partial unions, 8 nullable access, 9–10 `mixed` (php-mixed, php-implicit-nullable, php-override partly) |
| phpstan-strict-rules | When installed | php-loose-compare (`disallowedLooseComparison`), php-empty (`disallowedEmpty`), php-in-array-strict, php-switch-loose, booleans in conditions |
| Psalm | `vendor/bin/psalm`; levels 1 (strictest) to 8, default 2; `--taint-analysis` for source-to-sink flows | Type items; taint mode covers parts of 4.3 (SQL, XSS, shell) |
| PHP-CS-Fixer or Pint | `--dry-run --diff` (`pint --test`) with the project's set; `@PER-CS` follows the latest PER, `@PER-CS3x0` pins 3.0 | 4.7 formatting, `declare(strict_types=1)` placement, casts |
| Rector | `vendor/bin/rector process --dry-run` | Section 5 upgrades, implicit nullable, dead code |

No tool decides: whether a loose comparison is intended, whether a value
reaching a sink is attacker-controlled through a framework helper, N+1
behind an Eloquent attribute or Blade loop, whether state survives the
request (FPM vs Octane vs queue worker), job idempotency, whether a version
gate applies, or whether an array should be a DTO. Those are the review's
work.
