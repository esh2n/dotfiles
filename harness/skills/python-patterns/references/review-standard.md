# Python review standard

The one Python standard for both the model writing Python and
`code-reviewer` reviewing a Python diff. It lists what to check and where the
rule comes from; detail and code live in the skills it links:
`python-patterns` (house style: annotations, frozen dataclasses, Protocol,
secrets from the environment), `python-testing` (pytest, anyio, mocking
discipline), `django-patterns` and `fastapi-patterns` (framework structure).

Before applying any rule, read `requires-python` in `pyproject.toml` (the
language floor), the interpreter the CI matrix or `.python-version` pins,
whether the deployed interpreter is the free-threaded build (`python3.13t`,
`sysconfig.get_config_var("Py_GIL_DISABLED")`), and the pinned majors of
pandas, SQLAlchemy, Pydantic and Django. A rule gated on a version does not
apply below it. Supported CPython lines on 2026-10-19 are 3.11 to 3.15; 3.10
reached end of life on 2026-10-01 (VER).

Sources are cited by the short name in the first column of section 1; a
`#fragment` after it names the anchor on that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| PEP8 | PEP 8, Style Guide for Python Code | https://peps.python.org/pep-0008/ | Naming, `is None`, `isinstance`, bare `except`, `try` scope, `raise from`, return consistency, wildcard imports, lambda assignment | Last modified 2025-04-04 | Public domain |
| PEP20 | PEP 20, The Zen of Python | https://peps.python.org/pep-0020/ | "Errors should never pass silently", explicit over implicit | Active | Public domain |
| PEP484 | PEP 484, Type Hints | https://peps.python.org/pep-0484/ | Hints optional, explicit `Optional` for `None` defaults, stubs, `# type: ignore` | Final (3.5) | Public domain |
| PEP585 / PEP604 / PEP695 | Builtin generics; `X \| Y` unions; type parameter syntax | https://peps.python.org/pep-0585/, https://peps.python.org/pep-0604/, https://peps.python.org/pep-0695/ | `list[int]`, `int \| None`, `def f[T]`, `type X = ...` (lazy) | Final (3.9, 3.10, 3.12); historical documents, canonical text in the typing docs | Public domain or CC0-1.0 |
| TYP | `typing` module docs | https://docs.python.org/3/library/typing.html | `Any` vs `object`, `cast`, `TYPE_CHECKING`, Protocol and `runtime_checkable`, `TypeIs`, `Self`, `Final`, `NewType`, `LiteralString`, `override`, abstract collection types for parameters | Python 3.15 docs, fetched 2026-10-19 | PSF-2.0 (docs), 0BSD (examples) |
| DM | Data model | https://docs.python.org/3/reference/datamodel.html | `__eq__`/`__hash__`, `NotImplemented`, `__bool__`/`__len__`, `__del__`, `__slots__`, `__repr__` | 3.15 | PSF-2.0 |
| FAQ | Programming FAQ | https://docs.python.org/3/faq/programming.html | Shared defaults, late-binding closures, aliasing, `UnboundLocalError`, string joining, dispatch dicts | 3.15 | PSF-2.0 |
| STD | Standard library pages: `pickle`, `subprocess`, built-in functions (`eval`, `open`), `secrets`, `hashlib`, `tempfile`, `tarfile`, `xml`, `sqlite3`, `logging`, `dataclasses`, `datetime`, `functools`, `re`, `unittest.mock`, tutorial 7.2 | https://docs.python.org/3/library/ + module name (for example `.../library/pickle.html`); tutorial https://docs.python.org/3/tutorial/inputoutput.html | Security warnings, API contracts | 3.15 | PSF-2.0 |
| ADEV | Developing with asyncio | https://docs.python.org/3/library/asyncio-dev.html | Blocking code, thread safety, never-awaited coroutines, debug mode | 3.15 | PSF-2.0 |
| ATASK | Coroutines and Tasks | https://docs.python.org/3/library/asyncio-task.html | Task references, `TaskGroup`, `gather`, `timeout`, `to_thread`, cancellation | 3.15 | PSF-2.0 |
| THR / MP | `threading`; `multiprocessing` | https://docs.python.org/3/library/threading.html, https://docs.python.org/3/library/multiprocessing.html | GIL, daemon threads, start methods, picklability, importable `__main__` | 3.15 | PSF-2.0 |
| FT / TSG | Free-threading HOWTO; Thread Safety Guarantees | https://docs.python.org/3/howto/free-threading-python.html, https://docs.python.org/3/library/threadsafety.html | Free-threaded build, GIL re-enabling, per-operation guarantees for `list`/`dict`/`set`, compound operations | 3.15 | PSF-2.0 |
| WN | What's New 3.10 to 3.15 | https://docs.python.org/3/whatsnew/3.10.html (and `3.11` to `3.15`) | Version-gated features | 3.15.0 released 2026-10-09 | PSF-2.0 |
| VER | Status of Python versions | https://devguide.python.org/versions/ | Support and end-of-life dates | Fetched 2026-10-19 | PSF-2.0 |
| GPY | Google Python Style Guide | https://google.github.io/styleguide/pyguide.html | Exceptions, `assert`, mutable defaults and globals, threading, power features, properties, comprehensions, type annotations | Undated; fetched 2026-10-19; a company guide, follow the project where it differs | CC BY 3.0 (google/styleguide LICENSE) |
| RUFF | Ruff rules, Default Rules, release notes 0.16.0 and 0.17.0 | https://docs.astral.sh/ruff/rules/, https://docs.astral.sh/ruff/default-rules/, https://github.com/astral-sh/ruff/releases/tag/0.17.0 | Rule codes and default membership | 0.17.1 (2026-10-15); default set expanded to 413 rules in 0.16.0 | MIT |
| MYPY / PYR | mypy command line; Pyright configuration | https://mypy.readthedocs.io/en/stable/command_line.html, https://github.com/microsoft/pyright/blob/main/docs/configuration.md | `--strict` flags; `typeCheckingMode` levels | mypy 2.4.0; Pyright 1.1.414 | MIT |
| PT | pytest: How to write and report assertions | https://docs.pytest.org/en/stable/how-to/assert.html | `pytest.raises` `match`, subclass matching, assert rewriting scope | pytest 9.x | MIT |
| DJ | Django: Database access optimization | https://docs.djangoproject.com/en/stable/topics/db/optimization/ | QuerySet evaluation, `select_related`/`prefetch_related`, `count`/`exists`, bulk, `iterator` | Django 6.1 | BSD-3-Clause |
| SA | SQLAlchemy: Relationship Loading; asyncio | https://docs.sqlalchemy.org/en/21/orm/queryguide/relationships.html, https://docs.sqlalchemy.org/en/21/orm/extensions/asyncio.html | Lazy loading and N+1, `selectinload`/`joinedload`/`raiseload`, `AsyncSession` rules | 2.1.5 (current) | MIT |
| PD | pandas: basics (iteration), Copy-on-Write, `concat` | https://pandas.pydata.org/docs/user_guide/basics.html#iteration, https://pandas.pydata.org/docs/user_guide/copy_on_write.html, https://pandas.pydata.org/docs/reference/api/pandas.concat.html | Row iteration cost, chained assignment, row-by-row frame building | pandas 3.0.6 | BSD-3-Clause |
| PYD | Pydantic: Performance | https://pydantic.dev/docs/validation/latest/concepts/performance/ | `model_validate_json`, reuse `TypeAdapter`, wrap validators, tagged unions | Latest v2 (FailFast needs 2.8+) | MIT |
| REQ | Requests: Advanced Usage | https://requests.readthedocs.io/en/latest/user/advanced/ | No default timeout, `verify=False`, `Session` pooling, `stream=True` | Latest | Apache-2.0 |
| YAML | PyYAML documentation | https://pyyaml.org/wiki/PyYAMLDocumentation | `yaml.load` unsafe on untrusted input | Current | MIT |
| TC | Python wiki: TimeComplexity | https://wiki.python.org/moin/TimeComplexity | `in` on list vs set, `deque` | Edited 2026-02-14 | PSF wiki |
| CWE770 | CWE-770 Allocation of Resources Without Limits or Throttling | https://cwe.mitre.org/data/definitions/770.html | Unbounded fan-out and caches | CWE 4.20 | MITRE CWE terms of use |

Not opened in this run and therefore not cited: PEP 257 (docstrings),
defusedxml, py-spy, OWASP pages. Treat any claim resting on them as
unverified.

## 2. Mindset

- Explicit over implicit; errors never pass silently unless silenced on
  purpose and visibly (PEP20).
- Annotations document and are checked by tools, never by the runtime;
  validate external data at the boundary (TYP, PEP484).
- Structural typing through `Protocol`; accept abstract collection types
  (`Sequence`, `Mapping`, `Iterable`), return concrete ones (TYP, GPY 3.19).
- Resources live in `with` blocks; cleanup never depends on `__del__` (STD
  tutorial 7.2, DM).
- Prefer immutable values (`frozen=True` dataclasses, tuples) per the house
  rule in `python-patterns`; Python cannot make objects truly immutable
  (STD dataclasses `#frozen-instances`).
- Know which concurrency model runs the code before judging it: one event
  loop, threads under a GIL, free-threaded threads, or processes (section 6).
- Formatting is the formatter's job (`ruff format`/black); it is not review.

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| Default argument evaluated per call (JS, Kotlin, C++) | Defaults are evaluated once at `def`; use `None` and build inside | FAQ `#why-are-default-values-shared-between-objects`, GPY 2.12 |
| Loop closures capture the current value (JS `let`) | Closures look the name up when called; bind with a default argument or `functools.partial` | FAQ `#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result` |
| Java getters/setters around a field | Public attribute; `@property` only for cheap computed access | GPY 2.13, 3.15 |
| Classes of only static methods (Java, C#) | Module-level functions | GPY 2.17 |
| `x == null` checks | `x is None`; `if x:` is not a None check | PEP8 "Programming Recommendations" |
| `typeof`/`getClass() ==` type checks | `isinstance()` | PEP8 |
| `for (i = 0; i < len; i++)`, iterating `map.keys()` | Iterate the container, `enumerate`, `zip(strict=True)` | GPY 2.8, WN 3.10 (PEP 618) |
| Threads for CPU parallelism (Java, Go) | On the GIL build one thread runs Python code at a time; processes, interpreters, or the free-threaded build | THR `#introduction`, FT |
| `catch (Exception e)` everywhere, or bare `catch` | Catch the specific exception; bare `except:` also catches `SystemExit` and `KeyboardInterrupt` | PEP8, GPY 2.4 |
| `assert` as runtime validation (C, Java) | Raise an exception; asserts are not for validation | GPY 2.4 |
| `StringBuilder`-free `+=` string building | Collect parts in a list and `"".join` | FAQ `#what-is-the-most-efficient-way-to-concatenate-many-strings-together` |
| Annotations enforced like Java/TS types at runtime | The runtime ignores them; validate input (Pydantic, `fastapi-patterns`) | TYP |
| `IFoo` interface base class per implementation | `typing.Protocol` | TYP `#protocols` |
| camelCase functions, `MAX` constants anywhere | `snake_case` functions, `CapWords` classes, `UPPER_CASE` module constants | PEP8 "Naming Conventions" |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might be
unsafe" is not a finding.

### 4.1 Correctness and types

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-mutable-default | `def f(x=[])`, `={}`, `=set()`, or a call such as `=datetime.now()` in a default | `None` sentinel, build inside | One object shared across calls | FAQ, GPY 2.12, RUFF B006/B008 |
| py-class-mutable-attr | Mutable class attribute (or dataclass field) meant per instance | `field(default_factory=...)` or set in `__init__` | Shared across instances; dataclasses raise `ValueError` only for unhashable defaults | STD dataclasses `#mutable-default-values`, RUFF RUF012 |
| py-late-binding | `lambda`/inner `def` in a loop using the loop variable, run later | Bind via default argument | Every closure sees the last value | FAQ, RUFF B023 |
| py-none-compare | `== None`, or `if x:` where `0`/`""` are valid | `is None` / `is not None` | Falsy values taken as missing | PEP8, GPY 2.14 |
| py-type-compare | `type(x) == T` | `isinstance` | Breaks subclasses | PEP8 |
| py-aliasing | `y = x` then mutation; `[[0] * n] * m` | Copy explicitly | Names share one object | FAQ `#why-did-changing-list-y-also-change-list-x` |
| py-eq-hash | Class adds `__eq__` and is used as a dict key or in a set; mutable class defines `__hash__` | Define `__hash__` from the compared fields, or keep it unhashable; never hash mutable state | `__eq__` alone sets `__hash__ = None`; a changing hash corrupts dicts | DM `#object.__hash__` |
| py-eq-notimplemented | `__eq__`/ordering method returns `False` or raises for a foreign type | Return `NotImplemented` | Lets the other operand answer | DM `#object.__eq__` |
| py-zip-strict | `zip` of sequences that must match in length | `strict=True` (3.10+) | Silent truncation | WN 3.10, RUFF B905 |
| py-any | New `Any` where `object`, a TypeVar or a precise type fits | Replace; a kept `Any` carries a reason | `Any` disables checking; `object` keeps it | TYP `#the-any-type`, RUFF ANN401 |
| py-implicit-optional | `x: int = None` | `x: int \| None = None` | Implicit Optional is no longer recommended; mypy disables it by default | PEP484, GPY 3.19, MYPY, RUFF RUF013 |
| py-cast | `typing.cast` on unchecked data | Narrow with `isinstance`/`TypeIs`, or validate | `cast` returns the value unchanged at runtime | TYP |
| py-type-ignore | Bare `# type: ignore` | Narrow it to an error code; keep `warn_unused_ignores` on | Hides the next error on the line too | PEP484, MYPY, RUFF PGH003 |
| py-runtime-protocol | `isinstance(x, P)` with a `runtime_checkable` Protocol treated as a signature check | Check only presence, or validate properly | Only attribute presence is checked | TYP `#protocols` |
| py-param-abstract | Parameter typed `list`/`dict` but only read | `Sequence`/`Iterable`/`Mapping` | Callers can pass tuples, views, generators | TYP, GPY 3.19 |
| py-naive-datetime | `datetime.utcnow()`, `now()` without tz, naive and aware mixed | `datetime.now(UTC)` | Naive values are read as local time; `utcnow` deprecated since 3.12 | STD datetime `#datetime.datetime.utcnow`, RUFF DTZ005 |
| py-encoding | `open()` in text mode with no `encoding=` while the floor is below 3.15 | `encoding="utf-8"` | Locale-dependent before PEP 686 (3.15) | STD functions `open`, WN 3.10 (PEP 597), WN 3.15 |
| py-invalid-escape | `"\d"` and similar in a non-raw string | Raw string | `SyntaxWarning` since 3.12, an error later | WN 3.12, RUFF W605 |
| py-return-consistency | Some paths `return value`, others bare `return` or fall off | Return explicitly on every path | Accidental `None` | PEP8 |
| py-locals-write | Code mutates `locals()` expecting the variable to change | Assign directly | `locals()` is a snapshot in functions (3.13) | WN 3.13 (PEP 667) |
| py-pd-chained-assign | `df["a"][mask] = x`, `df["a"].replace(..., inplace=True)` | One `.loc[mask, "a"] = x`, or reassign the column | Never updates `df` under pandas 3 Copy-on-Write | PD Copy-on-Write |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-bare-except | `except:`, `except BaseException:` without re-raise | `except Exception` or narrower | Swallows `SystemExit`/`KeyboardInterrupt` | PEP8, GPY 2.4, RUFF E722 |
| py-swallowed | `except ...: pass`, or log-and-continue where the caller needs the failure | Handle, re-raise with context, or comment why ignoring is right | Errors never pass silently | PEP20, RUFF BLE001/S110 |
| py-try-scope | `try` body spanning unrelated calls | Shrink to the call that raises; use `else` | Masks bugs in the other lines | PEP8, GPY 2.4 |
| py-raise-from | New exception raised in an `except` block without `from` | `raise X from err`; `from None` only on purpose | Keeps the cause chain | PEP8, RUFF B904 |
| py-base-exception | Custom exception derives from `BaseException` | Derive from `Exception` | Escapes `except Exception` | PEP8 |
| py-assert-check | `assert` used for input validation or authorization in non-test code | `raise ValueError`/a domain error | Not a validation mechanism | GPY 2.4, RUFF S101 |
| py-cancelled | `except asyncio.CancelledError` (or broad `except BaseException`) in a coroutine without re-raise | Re-raise after cleanup | Breaks `TaskGroup` and `timeout` | ATASK `#task-cancellation` |
| py-exception-group | `TaskGroup` body wrapped in plain `except ValueError` | `except*` (3.11+) | Failures arrive as an `ExceptionGroup` | ATASK `#task-groups`, WN 3.11 (PEP 654) |
| py-finally-flow | `return`/`break`/`continue` inside `finally` | Move it out | Discards the in-flight exception; `SyntaxWarning` in 3.14 | WN 3.14 (PEP 765) |
| py-log-traceback | `logger.error(str(e))` inside `except` | `logger.exception(...)` or `exc_info=True` | Traceback lost | STD logging `#logging.Logger.exception` |
| py-resource-with | `open`, lock, connection, client or temp file acquired outside `with` | `with`, or `try/finally` | Leaks and unflushed writes on the error path | STD tutorial `#reading-and-writing-files`, GPY 2.4 |
| py-del-cleanup | New `__del__` for releasing resources | Context manager or explicit `close` | Not guaranteed to run; exceptions in it are ignored | DM `#object.__del__`, GPY 2.19 |
| py-subprocess-check | `subprocess.run` whose exit code is never read | `check=True` or inspect `returncode` | Failures pass silently | STD subprocess |

### 4.3 Concurrency and async

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-async-blocking | `requests`, `time.sleep`, `open().read()`, a sync DB driver, or a CPU loop inside `async def` on a hot path | Async client, `asyncio.to_thread`, or `run_in_executor` | Stalls every task on the loop, not only this one | ADEV `#running-blocking-code`, RUFF ASYNC210/230/251 |
| py-not-awaited | Coroutine called without `await` or scheduling | `await` it or create a task | It never runs; `RuntimeWarning` only | ADEV |
| py-dangling-task | `asyncio.create_task(...)` result not stored | Keep a reference or use `TaskGroup` | The loop holds weak references; the task can be collected mid-run; its exception is never retrieved | ATASK `#creating-tasks`, RUFF RUF006 |
| py-gather-cancel | `gather` where one failure should stop the rest | `TaskGroup` (3.11+) | `gather` propagates the first error and leaves the others running | ATASK `#task-groups` |
| py-serial-await | `for x in xs: await f(x)` over independent items | `TaskGroup`, bounded (next row); keep sequential when order, rate limits or one connection require it | n round trips; independence must be visible in the diff | ATASK |
| py-unbounded-fanout | `gather`/`TaskGroup`/executor over a caller- or data-sized list | Bound with `asyncio.Semaphore` or a fixed pool size and name the bound | Exhausts connection pools and remote limits | CWE770 |
| py-no-timeout | Network call or `await` on a remote without a deadline; `requests.get(...)` without `timeout=` | `asyncio.timeout` (3.11+) or the client's timeout | Requests never time out by default; `wait_for` may exceed its timeout | REQ `#timeouts`, ATASK `#timeouts`, RUFF S113 |
| py-loop-cross-thread | Another thread calls loop or asyncio-object methods | `loop.call_soon_threadsafe`, `asyncio.run_coroutine_threadsafe` | Almost no asyncio object is thread-safe | ADEV "Concurrency and Multithreading" |
| py-thread-compound | Shared mutable state with check-then-act, read-modify-write (`d[k] += 1`, `if k in d: del d[k]`) across threads | `threading.Lock`, `queue.Queue`, or atomic forms (`d.pop(k, None)`) | Compound operations are never atomic, GIL or not | TSG, GPY 2.18 |
| py-shared-iterator | One iterator or generator consumed by several threads; iterating a dict another thread mutates | Per-thread iterators; iterate a `copy()` | Duplicated or missing items | FT, TSG |
| py-async-session | One `AsyncSession` used by concurrent tasks | One session per task | Not safe for concurrent tasks | SA asyncio `#using-asyncsession-with-concurrent-tasks` |
| py-async-lazy-load | Relationship attribute read on an ORM object under `AsyncSession` | `selectinload`, `lazy="raise"`, `awaitable_attrs`; `expire_on_commit=False` | Implicit IO fails under asyncio | SA asyncio `#preventing-implicit-io-when-using-asyncsession` |
| py-mp-main | `multiprocessing`/`ProcessPoolExecutor` at import time, lambdas or local functions as targets | `if __name__ == "__main__":` guard; picklable top-level targets and arguments | Children re-import `__main__` under spawn/forkserver; arguments must pickle | MP |
| py-fork-threads | Explicit `fork` start method in a process that runs threads; code relying on fork inheritance | `forkserver`/`spawn`; pass state explicitly | Forking a threaded process is unsafe; 3.14 changed the POSIX default to `forkserver` (macOS and Windows use `spawn`) | MP, WN 3.14 |
| py-daemon-thread | Daemon thread holding files, transactions or connections | Non-daemon thread stopped by an `Event` | Daemon threads stop abruptly at shutdown | THR `#thread-objects` |
| py-cache-once | `lru_cache`/`cache` relied on to run a function once per key across threads | Explicit lock or initialize eagerly | Concurrent first calls can run the function more than once | STD functools `#functools.lru_cache` |

### 4.4 Performance

Report a cost only with n (what bounds the iteration count or payload), the
frequency (per request, per row, per job) and the execution context. Cost in
startup, CLI argument handling, migrations, notebooks or test fixtures is not
a finding. Without measurement, label the finding "needs measurement" and
name the command that would confirm it (`python -m cProfile -o out.prof
<entry>`; on 3.15 the `profiling.sampling` profiler, WN 3.15 PEP 799); do not
run it against a diff unless execution was opted into. Interpreter
micro-rewrites (hoisting attribute lookups, aliasing methods to locals,
`map` vs comprehension) are not findings without a profile: 3.11's
specializing adaptive interpreter changed what they cost (WN 3.11 PEP 659).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-perf-threads-cpu | `ThreadPoolExecutor`/`to_thread` around pure-Python CPU work on a GIL build | `ProcessPoolExecutor`, `InterpreterPoolExecutor` (3.14), a GIL-releasing extension, or the free-threaded build; state which build is deployed | One thread runs Python code at a time | THR `#introduction`, ATASK `#running-in-threads`, WN 3.14 |
| py-perf-process-io | Process pool for HTTP/DB fan-out | Threads or asyncio | Each task pays process start-up and pickling | THR, MP |
| py-perf-pickle-payload | Large DataFrame/array passed per task to a process pool | Pass a path, a slice or shared memory | Every argument and result is pickled (needs measurement) | MP |
| py-perf-n-plus-1 | Loop over a queryset/result touching a related attribute | Django `select_related` (FK, one-to-one) / `prefetch_related` (many-to-many, reverse FK); SQLAlchemy `joinedload` (many-to-one) / `selectinload` (collections); `raiseload` to catch regressions | N+1 SELECTs | DJ `#use-queryset-select-related-and-prefetch-related`, SA `#what-kind-of-loading-to-use` |
| py-perf-query-loop | `.get(pk=...)` or a query per item | One `filter(pk__in=ids)` / `WHERE ... IN`; aggregate with `annotate`/`F()` in the database | n round trips | DJ `#do-database-work-in-the-database-rather-than-in-python` |
| py-perf-count-exists | `len(qs)`, `if qs:` where the rows are not used | `count()`, `exists()`; evaluate once if the rows are used later | Materializes every row | DJ `#use-queryset-count`, `#use-queryset-exists` |
| py-perf-bulk | `.save()` per object in a loop | `bulk_create`/`bulk_update`/`update()`; note signals and custom `save()` do not run | One statement instead of n | DJ `#create-in-bulk`, `#use-queryset-update-and-delete` |
| py-perf-big-queryset | Iterating a very large queryset once | `iterator()`; `values_list`/`only` when few columns are read (`defer` misuse adds queries) | QuerySet cache holds every row | DJ `#use-iterator`, `#use-queryset-defer-and-only` |
| py-perf-iterrows | `iterrows`, `apply(axis=1)` over a data-sized frame | Vectorized column operation; `itertuples` when a loop is unavoidable | Slow, and `iterrows` loses dtypes | PD basics `#iteration` |
| py-perf-frame-growth | `pd.concat`/row append inside a loop | Collect rows in a list, build once | Rebuilds the frame each iteration | PD concat (Notes) |
| py-perf-membership | `x in some_list` inside a loop; `list.pop(0)`/`insert(0, x)` as a queue | Build a `set` once; `collections.deque` | O(n) per operation | TC |
| py-perf-str-concat | `s += part` over a large iterable | `"".join(parts)`; `bytearray` for bytes | Repeated copying | FAQ |
| py-perf-materialize | `f.read()`/`readlines()` then iterate; `list(...)` around a one-pass iterator on unbounded input | Iterate the file object or the iterator | Peak memory scales with input | STD tutorial 7.2 ("loop over the file object") |
| py-perf-stream | `requests` `.content`/`.json()` on a body whose size the code does not bound | `stream=True` inside `with`, `iter_content`, or a size check | Whole body buffered in memory | REQ `#body-content-workflow`, CWE770 |
| py-perf-client-reuse | New `requests.get`/client per call on a hot path | Reuse a `Session`/client | Session reuses pooled connections | REQ `#session-objects` |
| py-perf-pydantic | `TypeAdapter(...)` built per call; `model_validate(json.loads(s))`; per-item validation of a large list | Module-level `TypeAdapter`, `model_validate_json`, validate the list once | Adapter construction builds a validator; JSON parsed twice | PYD |
| py-perf-unbounded-cache | `@cache`/`lru_cache(maxsize=None)` or a module dict keyed by external input; `lru_cache` on methods | Bounded `maxsize` with a hit-rate argument; `cached_property` per instance | Grows without bound; method caches keep `self` alive | STD functools `#functools.lru_cache`, CWE770 |
| py-perf-log-format | f-string or `%` formatting inside a `logger.debug(...)` call on a hot path | Pass arguments: `logger.debug("%s", x)` | Formatting runs even when the level is off | STD logging `#logging.Logger.debug`, RUFF G004 |

Not findings: `re.compile` inside a function when the program uses few
patterns (the module caches recent patterns, STD re `#re.compile`);
`iterrows` over a small, code-bounded frame; "add `lru_cache`" with no
expected repeat rate; `__slots__` or `slots=True` on a cold path without a
per-instance count.

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-annotate-public | Public function or method without parameter and return annotations | Annotate; house rule requires all signatures | Signature is the contract | GPY 2.21, `python-patterns` |
| py-mutable-global | Module-level mutable state changed at runtime; `global` | Pass state explicitly or wrap it behind functions; `_` prefix if unavoidable | Hidden coupling, unsafe across threads | GPY 2.5, RUFF PLW0603 |
| py-staticmethod | New `@staticmethod` | Module-level function | No reason to tie it to the class | GPY 2.17 |
| py-trivial-property | Property that only reads/writes a field, or one doing I/O or heavy work | Plain attribute; method for costly work | Readers expect attribute access to be cheap | GPY 2.13, 3.15 |
| py-wildcard-import | `from m import *` | Explicit names | Unclear namespace | PEP8 |
| py-bool-flag | `def f(x, True)`-style positional boolean flag | Keyword-only (`*, flag: bool`) | Call sites unreadable | RUFF FBT001 |
| py-self-type | Methods returning the instance annotated with the class name | `Self` (3.11+) | Subclasses get the right type | TYP, WN 3.11 |
| py-final | Module constant reassigned or overridden | `Final` | Checker enforces it (no runtime check) | TYP |
| py-newtype | Different ID kinds all typed `int`/`str` | `NewType` | Mixing IDs fails type checking | TYP `#newtype` |
| py-literalstring | Function that executes SQL/shell text typed `str` | `LiteralString` | Checker rejects interpolated input | TYP, WN 3.11 (PEP 675) |
| py-override | Subclass method meant to override, without `@override` | Add it (3.12+) | Checker flags a renamed base method | TYP, WN 3.12 (PEP 698) |
| py-value-object | Value-like dataclass left mutable | `frozen=True` (house rule); `copy.replace` (3.13) for changed copies | Accidental shared mutation | STD dataclasses `#frozen-instances`, WN 3.13, `python-patterns` |
| py-repr | New `__repr__` returning an ambiguous string | Expression-like or `<...>` form | Debuggability | DM `#object.__repr__` |

### 4.6 Naming and readability

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-naming | Names not `snake_case`/`CapWords`/`UPPER_CASE`; single-letter `l`, `O`, `I` | Rename | Uniform reading | PEP8 "Naming Conventions" |
| py-lambda-assign | `f = lambda ...` | `def f` | Proper name in tracebacks | PEP8, RUFF E731 |
| py-bool-compare | `== True`/`== False` | `if x:` / `if not x:` | Redundant, and wrong for non-bools | PEP8, GPY 2.14 |
| py-prefix-slice | `s[:3] == "foo"` | `startswith`/`endswith` | Clearer, no off-by-one | PEP8 |
| py-comprehension | Comprehension with several `for` or filter clauses | Loop or helper | Readability | GPY 2.7 |
| py-iterate | `for k in d.keys()`, `for i in range(len(xs))` | Iterate directly, `enumerate`, `items()` | Idiom | GPY 2.8 |
| py-power-features | Custom metaclass, import hooks, bytecode access, `__del__` tricks | Plain classes; stdlib (`dataclasses`, `enum`) is fine | Hard to read and test | GPY 2.19 |
| py-print | `print()` in library or service code | `logging.getLogger(__name__)` | Unroutable output | STD logging `#logging.getLogger`, RUFF T201 |
| py-shadow-builtin | Variable named `list`, `id`, `type`, `input` | Rename | Breaks later uses of the builtin | RUFF A001 |
| py-str-dispatch | `eval`/`getattr` to call a function named by a string | Dict of name to function | Explicit and safe | FAQ `#how-do-i-use-strings-to-call-functions-methods` |

### 4.7 Testing

Patterns live in `python-testing`; whether tests protect behaviour at all is
`test-reviewer`'s question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-test-raises | `pytest.raises(Exception)` or no `match=` where the message matters | Specific type plus `match` (regex `search`); assert `excinfo.type is X` when subclasses must not pass | `raises` also matches subclasses | PT `#matching-exception-messages`, RUFF PT011 |
| py-test-autospec | `@patch`/`Mock()` without `autospec`/`spec` | `autospec=True` or `create_autospec` | Plain mocks accept any call; API drift passes | STD unittest.mock `#unittest.mock.create_autospec`, `python-testing` |
| py-test-patch-target | Patch target is the defining module while the code under test did `from a import X` | Patch where the name is looked up (`b.X`) | The patch has no effect | STD unittest.mock `#where-to-patch` |
| py-test-awaited | `AsyncMock` checked with `assert_called*` | `assert_awaited*` | Called is not awaited | STD unittest.mock `#unittest.mock.AsyncMock` |
| py-test-helper-assert | Bare `assert` in a helper module outside collected tests | `pytest.register_assert_rewrite` before import | Helpers lose assertion introspection | PT `#assertion-introspection-details` |
| py-test-async-marker | `@pytest.mark.asyncio`, `pytest-asyncio` fixtures | `pytest.mark.anyio` and the `anyio_backend` fixture | House rule | `python-testing` |
| py-test-catch | `try/except` in a test to check an error | `pytest.raises` | Swallows the failure signal | `python-testing` |

### 4.8 Security specific to Python

Language-specific sinks only. Authorization, secret handling, SSRF and
supply-chain review belong to `security-reviewer`; hand those over.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| py-pickle | `pickle.load(s)`, `shelve`, or pickle-based caches on data from outside the process | JSON or a schema format; HMAC-sign if pickle is unavoidable | Unpickling executes arbitrary code | STD pickle (top warning), RUFF S301 |
| py-yaml-load | `yaml.load` without `SafeLoader`, `yaml.unsafe_load` | `yaml.safe_load` | Constructs arbitrary objects | YAML, RUFF S506 |
| py-eval | `eval`/`exec`/`compile` on input; restricted `__builtins__` as a sandbox | `ast.literal_eval`, a parser, or a dispatch dict | Executes arbitrary code; restricting builtins is not security | STD functions `eval`/`exec`, RUFF S307/S102 |
| py-shell | `shell=True`, `os.system`, `os.popen` with external input | Argument list without a shell; `shlex.quote` only if a shell is unavoidable | Shell injection | STD subprocess "Security Considerations", RUFF S602/S605 |
| py-sql-format | f-string, `%` or `.format` building SQL for `execute` | Driver placeholders (`?`, `%s`, `:name`) or ORM parameters | SQL injection | STD sqlite3 `#how-to-use-placeholders-to-bind-values-in-sql-queries`, RUFF S608 |
| py-tar-extract | `extractall`/`extract` on an archive from outside while the floor is below 3.14 | `filter="data"` explicitly | Pre-3.14 default honours absolute paths and escaping links | STD tarfile `#extraction-filters` |
| py-xml | Parsing untrusted XML with the stdlib; `xmlrpc` server | Check `pyexpat.EXPAT_VERSION` (2.7.2+); limit input size | Entity-expansion and decompression-bomb DoS | STD xml `#xml-vulnerabilities` |
| py-random-token | `random` for tokens, passwords, nonces | `secrets` | `random` is for simulation | STD secrets, RUFF S311 |
| py-token-compare | `==` on tokens, HMACs, password hashes | `secrets.compare_digest` / `hmac.compare_digest` | Timing attack | STD secrets |
| py-weak-hash | `md5`/`sha1` for integrity or auth; `sha256(password)` | SHA-256+ for integrity; `scrypt`/`pbkdf2_hmac` (or the project's password hasher) for passwords; `usedforsecurity=False` for checksums | Collisions; fast hashes are brute-forceable | STD hashlib `#key-derivation`, RUFF S324 |
| py-mktemp | `tempfile.mktemp` | `mkstemp`/`NamedTemporaryFile` | Race between name and create | STD tempfile `#tempfile.mktemp`, RUFF S306 |
| py-tls-verify | `verify=False` outside tests | Fix the CA bundle | Accepts any certificate | REQ `#ssl-cert-verification`, RUFF S501 |

## 5. Version-gated modern features

Gate on `requires-python` and the deployed interpreter, never on the latest
release. Ruff's `UP` rules rewrite most of these once `target-version` (or
`requires-python`) is set; Ruff 0.17 assumes 3.11 when neither is set (RUFF
0.17.0).

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| 3.10 | `match`; `X \| Y` unions and in `isinstance`; `zip(strict=True)`; `dataclass(slots=True, kw_only=True)`; parenthesized `with`; `ParamSpec`, `TypeGuard` | A plain `if`/`elif` on values reads better than `match`; floor 3.9 | WN 3.10, PEP604 |
| 3.11 | `TaskGroup`, `asyncio.timeout`; `except*`, `add_note`; `tomllib`; `Self`, `LiteralString`, `Required`/`NotRequired`; `StrEnum`. About 1.25× faster than 3.10 | `gather(return_exceptions=True)` when every result is wanted regardless of failures | WN 3.11, ATASK |
| 3.12 | `def f[T]`, `class C[T]`, `type X = ...` (lazily evaluated); `@override`; `Unpack[TypedDict]` for `**kwargs`; `itertools.batched`; PEP 701 f-strings; `datetime.now(UTC)` (`utcnow` deprecated) | Floor below 3.12 (keep `TypeVar`); `TypeAlias` is deprecated, not removed | WN 3.12, PEP695, TYP |
| 3.13 | `TypeIs`; `ReadOnly`; TypeVar defaults; `warnings.deprecated`; `copy.replace`; `Queue.shutdown`. Removed modules (PEP 594): `cgi`, `crypt`, `telnetlib`, `pipes` and others; free-threaded build experimental | `TypeGuard` when the narrowed type is not a subtype of the input | WN 3.13, TYP |
| 3.14 | Deferred annotations (PEP 649/749, `annotationlib`): forward references need no quotes; t-strings (PEP 750) for sanitizing interpolation; `except A, B:` without parentheses; free-threaded build supported (PEP 779); `concurrent.interpreters`, `InterpreterPoolExecutor`; `compression.zstd`; `forkserver` POSIX default; tarfile `data` filter default. Incremental GC was reverted in 3.14.5 | Floor below 3.14: keep quoted forward references or `from __future__ import annotations`, explicit `filter="data"`, explicit start method | WN 3.14, MP, STD tarfile |
| 3.15 (released 2026-10-09) | `lazy import` (PEP 810); `frozendict` (PEP 814); `sentinel` (PEP 661); UTF-8 default I/O encoding (PEP 686); `*`/`**` in comprehensions (PEP 798); `profiling` package (PEP 799); TypedDict extra items (PEP 728) | Floor below 3.15: keep explicit `encoding=`; module-level-only rule for `lazy` | WN 3.15 |

## 6. Concurrency model

- GIL build: only one thread executes Python code at a time; threads suit
  I/O-bound work, processes (`multiprocessing`, `ProcessPoolExecutor`) suit
  CPU-bound Python — THR `#introduction`.
- Free-threaded build (3.13 experimental, 3.14 supported by PEP 779): threads
  run Python code in parallel. Importing an extension not marked
  free-threading safe re-enables the GIL with a warning; `PYTHON_GIL` or
  `-X gil` override it. Single-threaded overhead is about 1–8% depending on
  platform; memory use is higher — FT. A CPU-in-threads finding must state
  which build is deployed; on the free-threaded build the recommendation
  inverts.
- Built-in containers keep internal consistency on both builds, but
  compound operations (check-then-act, read-modify-write) and iteration
  while another thread mutates are never atomic. Use `threading.Lock` or
  `queue.Queue`; do not rely on builtin atomicity — TSG, GPY 2.18.
- asyncio: one thread runs the loop; almost no asyncio object is
  thread-safe. Cross-thread calls go through `call_soon_threadsafe` or
  `run_coroutine_threadsafe`; blocking or CPU-bound calls stall every task —
  ADEV.
- Every `await` is a point where other tasks run; state read before it may
  be stale after it. A check-then-act split by an `await` is a race between
  tasks; re-read, serialize per key, or use a database constraint.
- Tasks need an owner: keep a reference, prefer `TaskGroup`, and re-raise
  `CancelledError` — ATASK.
- Processes share nothing by default: arguments and results are pickled,
  `__main__` must be importable, and forking a threaded process is unsafe;
  3.14 made `forkserver` the POSIX default (macOS and Windows use `spawn`) —
  MP. Subinterpreters (`concurrent.interpreters`, 3.14) are a third option —
  WN 3.14.
- Several processes or pods share no memory: an in-process lock, cache or
  rate limiter does not coordinate across them.
- Correctness vs speed: a race, lost update or swallowed cancellation is
  4.3; a model that is only slow (threads on CPU work, processes for I/O) is
  4.4.

## 7. Linter mapping

Run the project's own checks first (`[tool.ruff]`/`ruff.toml`,
`[tool.mypy]`, `pyrightconfig.json`, `lefthook.yml`,
`.pre-commit-config.yaml`, CI results via `gh pr checks`) and pass their
output to the review; never report "no issues" from a tool that did not run.
`ruff check` and `pyright` analyse source without importing it. mypy can
load project plugins (for example a Django stubs plugin that imports
settings); when the config names plugins, name the command instead of
running it. Never run `pytest`, `python -m`, `uv run` or an install against a
diff without explicit opt-in: `conftest.py`, build backends and imported
modules execute code the diff controls. Do not restate what a tool that ran
already reported.

Ruff 0.16 made 413 rules the default set; most `S` (bandit) rules, `B904`,
`B905`, `RUF006` and `PERF401` are still opt-in (RUFF Default Rules).
mypy `--strict` adds `disallow-untyped-defs`, `disallow-any-generics`,
`warn-unused-ignores`, `warn-return-any`, `strict-equality` and more (MYPY);
Pyright's default mode is `standard`, and `strict` adds the
`reportUnknown*` family and `reportMissingTypeStubs` (PYR).

| Item | Rule | In Ruff's default set |
|---|---|---|
| py-mutable-default | B006, B008 | yes |
| py-class-mutable-attr | RUF012 | yes |
| py-late-binding | B023 | yes |
| py-implicit-optional | RUF013; mypy default; Pyright `strictParameterNoneValue` | yes |
| py-bare-except, py-swallowed | E722, BLE001, S110, S112 | yes |
| py-raise-from | B904 | no |
| py-zip-strict | B905 | no |
| py-async-blocking | ASYNC210, ASYNC230, ASYNC251 | yes |
| py-dangling-task | RUF006 | no |
| py-invalid-escape | W605 | yes |
| py-naive-datetime | DTZ005 (removed from defaults in 0.17.0) | no |
| py-type-ignore | PGH003; mypy `warn_unused_ignores` | no |
| py-any | ANN401 | no |
| py-mutable-global | PLW0603 | no |
| py-lambda-assign, py-none-compare, py-type-compare | E731, E711, E721 (dropped from defaults in 0.16.0) | no |
| py-print, py-shadow-builtin, py-bool-flag | T201, A001, FBT001 | no |
| py-perf-log-format | G004 | no |
| py-test-raises | PT011 | no |
| py-pickle, py-yaml-load, py-eval | S301, S506, S307 (S102 `exec` is default) | no |
| py-shell, py-sql-format | S602, S605, S608 | no |
| py-weak-hash, py-random-token, py-mktemp, py-tls-verify, py-no-timeout | S324, S311, S306, S501, S113 | no |
| section 5 rewrites | UP006, UP007, UP040, UP045 (with `target-version`) | yes |
| py-assert-check | S101 (disable for tests) | no |

No tool decides: whether an `except` should swallow, whether `await`
iterations are independent, the concurrency bound, which interpreter build
is deployed, whether a path is hot, N+1 behind an ORM attribute, whether a
cast or `Any` is justified, or whether a version gate applies. Those are the
review's work.
