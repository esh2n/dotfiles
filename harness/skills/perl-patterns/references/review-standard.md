# Perl review standard

The one Perl standard for both the model writing Perl and `code-reviewer`
reviewing a Perl diff. It lists what to check and where the rule comes from;
detail and code live in `perl-patterns` (idioms, modules, tooling) and
`perl-testing` (test patterns). Injection findings (shell, `eval STRING`,
SQL, two-arg `open`) also go to `security-reviewer`.

Before applying any rule, read the file's `use VERSION` line (or `use
feature`/`use experimental`) and the interpreter the code runs on (shebang,
`cpanfile` `requires 'perl'`, CI matrix). The feature bundle decides which
items apply: section 5 gates syntax by version, and `use v5.36` code does not
compile on a 5.34 interpreter. Confirm a feature against the perldoc of the
target version, never from memory.

## 1. Sources

All URLs were opened in this run (2026-10-19). perldoc pages are the 5.44.0
versions served at perldoc.perl.org. CPAN pages were read through the
metacpan API (`https://fastapi.metacpan.org/v1/pod/<Module>`) because
metacpan.org returns a browser challenge to scripts; the metacpan.org URL is
given for readers. Licences marked "not checked" were not looked up; cite by
name and link only.

| Id | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| STYLE | perlstyle | https://perldoc.perl.org/perlstyle | strict/warnings, `use v5.36`, layout, `open ... or die "$!"` | perl 5.44.0 | not checked (ships with perl) |
| SEC | perlsec | https://perldoc.perl.org/perlsec | Taint mode, laundering with captures, `$ENV{PATH}`, algorithmic-complexity (hash, regex) DoS | 5.44.0 | not checked |
| RUN | perlrun | https://perldoc.perl.org/perlrun | `-T`, `-t`, `-c` (runs `BEGIN` and `use`), builds without taint support | 5.44.0 | not checked |
| OPEN | perlfunc `open` | https://perldoc.perl.org/functions/open | Three-arg form, "magic open" of the 1-/2-arg forms, implicit close skips error checks | 5.44.0 | not checked |
| EXEC | perlfunc `exec` / `system` | https://perldoc.perl.org/functions/exec, https://perldoc.perl.org/functions/system | One-element list goes to `/bin/sh -c` when it has metacharacters; `system { $prog } @args` | 5.44.0 | not checked |
| EVAL | perlfunc `eval` | https://perldoc.perl.org/functions/eval | String vs block eval, `$@` set to `""` on success, `local $SIG{__DIE__}` | 5.44.0 | not checked |
| FUNC | perlfunc (`use`, `length`, `sort`, `local`, `fork`, `wantarray`) | https://perldoc.perl.org/perlfunc | `use VERSION` effects (strict at 5.12, warnings at 5.35, builtin at 5.39, `source::encoding 'ascii'` at 5.41) | 5.44.0 | not checked |
| SUB | perlsub | https://perldoc.perl.org/perlsub | Flat argument list, signatures, named parameters (5.43.5+), `my` vs `local`, `wantarray` | 5.44.0 | not checked |
| OP | perlop | https://perldoc.perl.org/perlop | `==` vs `eq`, `or` vs `||` precedence, `isa`, `while (<>)` implicit `defined` | 5.44.0 | not checked |
| DATA | perldata | https://perldoc.perl.org/perldata | Truth (`"0"` is false), array vs list in scalar context | 5.44.0 | not checked |
| REF | perlref | https://perldoc.perl.org/perlref | Postfix dereference, circular references leak | 5.44.0 | not checked |
| VAR | perlvar | https://perldoc.perl.org/perlvar | `$@`, `$_`, `` $` $& $' `` cost history (fixed by COW in 5.20) | 5.44.0 | not checked |
| RE | perlre | https://perldoc.perl.org/perlre | Exponential backtracking, possessive quantifiers, `(?>...)` | 5.44.0 | not checked |
| SYN | perlsyn | https://perldoc.perl.org/perlsyn | `try`/`catch` (return leaves the enclosing sub), `finally` still experimental, `defer` | 5.44.0 | not checked |
| FEAT | feature | https://perldoc.perl.org/feature | Bundle contents per version; `class` experimental; `try` "partly experimental" | 5.44.0 | not checked |
| BI | builtin | https://perldoc.perl.org/builtin | Which `builtin::` functions are stable (5.40) and which are experimental | 5.44.0 | not checked |
| CLASS | perlclass | https://perldoc.perl.org/perlclass | `class`/`field`/`method`, TODO list, known bugs | 5.44.0 | not checked |
| THR | perlthrtut; threads | https://perldoc.perl.org/perlthrtut, https://perldoc.perl.org/threads | ithreads model; the `threads` module says interpreter threads are "officially discouraged" | 5.44.0 | not checked |
| FORK | perlfork; perlipc | https://perldoc.perl.org/perlfork, https://perldoc.perl.org/perlipc | Windows `fork` emulation; reaping children, deferred signals | 5.44.0 | not checked |
| PERF | perlperf | https://perldoc.perl.org/perlperf | Baseline, Benchmark, Devel::NYTProf | 5.44.0 | not checked |
| POL | perlpolicy | https://perldoc.perl.org/perlpolicy | Support: critical fixes for the two latest series, security for 5.x.0 within three years | 5.44.0 (table "as of 5.42") | not checked |
| DELTA | perldelta 5.36–5.44 | https://perldoc.perl.org/perl5360delta … https://perldoc.perl.org/perl5420delta, https://perldoc.perl.org/perldelta (5.44.0) | What each release added | 5.44.0 released 2026-07-15 (latest stable, perl.org/get.html) | not checked |
| HIST | perlhist | https://perldoc.perl.org/perlhist | Release dates | 5.44.0 | not checked |
| PC | Perl::Critic and its policy modules | https://metacpan.org/pod/Perl::Critic, https://metacpan.org/pod/Perl::Critic::Policy::InputOutput::ProhibitTwoArgOpen (pattern `Perl::Critic::Policy::<Category>::<Name>`) | Severity names, themes, theme operators; default severity and themes read from each policy's source in the 1.156 tarball | 1.156, 2024-10-23 (latest) | perl_5 |
| PPI | PPI Changes | https://metacpan.org/dist/PPI/changes | Signature and `try` parsing added in 1.281 (2024-12-27) | 1.291, 2026-04-25 | perl_5 |
| TIDY | perltidy | https://metacpan.org/pod/perltidy | `-pbp` contents, `-b` with `-pbp` needs `-nst`, `--assert-tidy` | Perl-Tidy 20260826 | gpl_2 |
| TT | Try::Tiny | https://metacpan.org/pod/Try::Tiny | `$@` clobbering, `local $@` masking, false `$@`, `return` inside `try` | 0.32, 2024-08-16 | mit |
| FCT | Feature::Compat::Try | https://metacpan.org/pod/Feature::Compat::Try | Core `try` syntax on perls before 5.34 | 0.05, 2022-02-20 | perl_5 |
| AD | autodie | https://metacpan.org/pod/autodie | Lexical die-on-failure for builtins; `:all` adds `system`/`exec` | 2.37, 2023-12-28 | perl_5 |
| DBI | DBI | https://metacpan.org/pod/DBI | Placeholders and bind values | 1.656, 2026-10-18 | perl_5 |
| TM | Test::More | https://metacpan.org/pod/Test::More | `done_testing`, plans, `is_deeply` | Test-Simple 1.302225, 2026-09-03 | perl_5 |
| T2 | Test2::V0, Test2::Tools::Exception, Test2::Manual::Testing::Migrating | https://metacpan.org/pod/Test2::V0, https://metacpan.org/pod/Test2::Tools::Exception, https://metacpan.org/pod/Test2::Manual::Testing::Migrating | V0 enables strict, warnings, utf8, srand; `dies`/`lives`; `is` is a deep compare unlike Test::More's | Test-Simple 1.302225 (Test2::Suite now ships in this distribution); in core since 5.40 | perl_5 |
| PROVE | prove | https://metacpan.org/pod/prove | `-l`, `-r`, `-j`, `-s`, `--state` | Test-Harness, current | not checked |
| HOUSE | jig hook tables | `harness/jig/README.md` (Perl row) | Edit-time `perltidy -b -bext=/`; Stop-time `perl -c` per touched `.pl`/`.pm` | This repository | This repository |

Observed on this machine (2026-10-19), not from a document: `perl` comes
from mise (5.44.0, `home/shared/mise/config/config.toml.template`), and
`perlcritic` 1.156 and `perltidy` 20260826 come from the Nix flake, built
against PPI 1.291 so signatures are parsed (`overlays/default.nix`); macOS's
`/usr/bin/perl` (5.34.1) is still present but not first on `PATH` once mise
is active.

Not opened in this run and therefore not cited: Perl Best Practices (the
book; Perl::Critic policies carry its page numbers in their `$EXPL`),
Moo/Moose docs, IPC::Run3, Syntax::Keyword::Try beyond its release record,
Devel::Cover docs, any Apple statement on the system perl. Treat any claim
resting on them as unverified.

## 2. Mindset

- Every file starts with `use strict; use warnings;` or a `use VERSION` that
  implies them (strict from 5.12, warnings from 5.35); turning either off is
  scoped and justified in a comment (STYLE, FUNC).
- Context is part of the API: every expression is evaluated in list, scalar
  or void context, and a sub's result depends on its caller's context (SUB,
  DATA).
- Every system call that can fail is checked, and the message carries `$!`;
  `autodie` is the lexical way to do it everywhere at once (STYLE, AD).
- External data never reaches a shell, `open` mode, `eval STRING`, SQL text
  or a regex unvalidated; validate with an allowlist, not a denylist (SEC).
- Use the newest syntax the target interpreter's bundle provides, and no
  experimental feature in code that must keep working across upgrades (FEAT,
  POL).
- Choose the most readable of Perl's many ways; do not hide the main action
  in a statement modifier (STYLE).
- Formatting is perltidy's output and not up for review (HOUSE).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `return` inside `eval { }` or a `Try::Tiny` `try { }` to leave the sub (Python, Java) | Core `try` (feature `try`) returns from the enclosing sub; in `eval`/`Try::Tiny`, return a flag and test it | https://perldoc.perl.org/perlsyn#Try-Catch-Exception-Handling, https://metacpan.org/pod/Try::Tiny#CAVEATS |
| `if ($@)` as the "did it throw" test (`except` style) | `eval { ...; 1 } or do { ... }`, core `try`/`catch`, or Try::Tiny | https://metacpan.org/pod/Try::Tiny#BACKGROUND |
| `local` meaning a function-local variable (Lua, shell) | `my`; `local` only gives a global a temporary value | https://perldoc.perl.org/functions/local, https://perldoc.perl.org/perlsub#When-to-Still-Use-local() |
| `==` to compare strings (JS, Python) | `eq` for strings, `==` for numbers | https://perldoc.perl.org/perlop#Equality-Operators |
| Passing two arrays as two arguments | Pass references; arguments are one flat list | https://perldoc.perl.org/perlsub (flat list), #Pass-by-Reference |
| `length(@a)` for element count | `scalar @a`, `scalar keys %h` | https://perldoc.perl.org/functions/length |
| `sort @numbers` expecting numeric order | `sort { $a <=> $b } @numbers`; the default is string order | https://perldoc.perl.org/functions/sort |
| Treating `"0"` as true (Python, Ruby, JS) | `"0"`, `""`, `0` and `undef` are false; test `defined` or `length` when `0` is valid | https://perldoc.perl.org/perldata (Scalar values) |
| Threads for parallel work (Java, Go) | Processes (`fork`, a process pool module) or an event loop; ithreads are officially discouraged | https://perldoc.perl.org/threads |
| `assert.Equal` style string compare of references in Test::More habits carried into Test2 | Test2 `is` compares structures; `ref_is` for identity | https://metacpan.org/pod/Test2::Manual::Testing::Migrating |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.

### 4.1 Correctness and context

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| pl-strict-warnings | New `.pl`/`.pm` with no `use strict`/`use warnings` and no `use v5.12`+ / `v5.36`+ | Add them or a `use VERSION` that implies them | Undeclared variables and symbolic refs pass silently | https://perldoc.perl.org/perlstyle, https://perldoc.perl.org/functions/use |
| pl-no-strict | `no strict 'refs'`, `no warnings` with no category | Narrowest block and category; a hash instead of symbolic names | Re-opens every check strict and warnings gave | https://perldoc.perl.org/perlstyle, PC `TestingAndDebugging::ProhibitNoStrict` |
| pl-use-version-twice | Second `use VERSION` in one scope, or one lowering a version above 5.11 to below | Keep one, first in the file | Fatal when either is v5.39+; a downgrade is fatal since 5.40 | https://perldoc.perl.org/perl5400delta#Restrictions-to-use-VERSION-declarations |
| pl-scalar-list | `my $x = func()` / `my ($x) = func()` / `return (...)` in a sub called both ways | The caller's context is the one the sub was written for; `wantarray` if it must serve both | A list in scalar context yields its last element, an array yields its count | https://perldoc.perl.org/perldata, https://perldoc.perl.org/perlsub |
| pl-return-undef | `return undef;` in a sub whose result is used in list context or as a boolean | Bare `return;` | `undef` is a one-element, true list | PC `Subroutines::ProhibitExplicitReturnUndef` |
| pl-local-vs-my | `local $var` on a lexical-looking name, or `my` on `$_`, `$/`, `$,`, `@ARGV` | `my` for new variables; `local` only for package and punctuation globals | `local` is dynamic scope, visible to every sub called from the block | https://perldoc.perl.org/perlsub#Temporary-Values-via-local(), https://perldoc.perl.org/functions/local |
| pl-localize-punct | Assignment to `$/`, `$,`, `$\`, `$_` or `$@` in a sub with no `local` | `local` them | Changes leak to callers | https://perldoc.perl.org/perlsub#When-to-Still-Use-local(), PC `Variables::RequireLocalizedPunctuationVars` |
| pl-cond-my | `my $x = ... if $cond;` | Declare, then assign conditionally | perlsyn leaves a `my` with a statement modifier undefined | https://perldoc.perl.org/perlsyn (Simple Statements), PC `Variables::ProhibitConditionalDeclarations` |
| pl-ref-deref | Nested data access, `@{$h->{list}}`, `exists`/`delete` on array elements | Postfix `->@*`, `->%*` where the floor allows; no `exists`/`delete` on arrays | Readability; array `exists`/`delete` is "strongly discouraged" | https://perldoc.perl.org/perlref#Postfix-Dereference-Syntax, https://perldoc.perl.org/perlfunc (delete, exists) |
| pl-circular-ref | Parent/child or callback structures holding references to each other | `Scalar::Util::weaken` / `builtin::weaken` on the back-reference | Reference counting never frees cycles | https://perldoc.perl.org/perlref#Circular-References |
| pl-bless-one-arg | `bless {}` with no class argument | `bless $ref, $class` | Breaks inheritance | https://perldoc.perl.org/functions/bless, PC `ClassHierarchies::ProhibitOneArgBless` |
| pl-indirect-new | `new Foo(...)` | `Foo->new(...)` | Ambiguous parse; disabled by the 5.36 bundle | https://perldoc.perl.org/perl5360delta#use-v5.36, PC `Objects::ProhibitIndirectSyntax` |
| pl-readline-for | `for my $l (<$fh>)` | `while (my $l = <$fh>)` | Reads the whole file into memory first | PC `InputOutput::ProhibitReadlineInForLoop`, https://perldoc.perl.org/perlop (I/O Operators) |
| pl-module-true | `.pm` file without a final true value | Keep `1;` unless every consumer is under `use v5.38`+ (`module_true`) | `require` fails on a false last value | https://perldoc.perl.org/feature (module_true), PC `Modules::RequireEndWithOne` |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| pl-unchecked-syscall | `open`, `close` (of a written handle), `mkdir`, `unlink`, `rename`, `chdir`, `system` with the result unused | `or die "...: $!"` or `use autodie` (`qw(:all)` to cover `system`) | Silent failure; implicit close on scope exit does not check errors | https://perldoc.perl.org/perlstyle, https://perldoc.perl.org/functions/open, https://metacpan.org/pod/autodie |
| pl-or-precedence | `open my $fh, '<', $f \|\| die` (no parentheses) | `or die`, or parenthesise the call | `\|\|` binds to `$f`, so the `die` never runs | https://perldoc.perl.org/perlop#List-Operators-(Rightward) |
| pl-eval-dollar-at | `eval { ... }; if ($@)` or `die ... if $@` | `eval { ...; 1 } or do { my $e = $@; ... }` | A `DESTROY` running `eval` during unwinding can clear `$@`; a false exception object also slips through | https://metacpan.org/pod/Try::Tiny#BACKGROUND, https://perldoc.perl.org/functions/eval |
| pl-local-at-die | `local $@;` in a block that later `die`s | Capture the error in a `my` first, `die` after the block | The localized `$@` is restored and the error is lost | https://metacpan.org/pod/Try::Tiny#BACKGROUND |
| pl-eval-unchecked | Block `eval` whose return value is not tested | Test the value (`eval {...; 1}`) | PC flags it; testing `$@` alone is not reliable | PC `ErrorHandling::RequireCheckingReturnValueOfEval` |
| pl-die-hook | Library code installing or relying on `$SIG{__DIE__}`, or `eval` in a library without `local $SIG{__DIE__}` | Localize the hook around the `eval` | User hooks fire inside the library's `eval` | https://perldoc.perl.org/functions/eval |
| pl-try-tiny-return | `return` inside a Try::Tiny `try`/`catch` block | Assign the block's value and return after it | It returns from the block, not the sub; `catch`'s value becomes `try`'s value | https://metacpan.org/pod/Try::Tiny#CAVEATS |
| pl-core-try | Core `try`/`catch` on a floor below 5.40, or with `finally` | Below 5.40 it warns as experimental (5.34+); `finally` is still experimental in 5.44; on older perls use Feature::Compat::Try | Experimental features may change | https://perldoc.perl.org/feature#The-'try'-feature, https://perldoc.perl.org/perlsyn#Try-Catch-Exception-Handling, https://metacpan.org/pod/Feature::Compat::Try |
| pl-croak | `die` in a module for caller mistakes | `Carp::croak` so the message points at the caller | Error location | PC `ErrorHandling::RequireCarping` |
| pl-die-newline | `die "msg\n"` vs `die "msg"` chosen by accident | Trailing newline suppresses "at FILE line N"; choose deliberately | Lost or noisy location | https://perldoc.perl.org/functions/die |

### 4.3 Security

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| pl-two-arg-open | `open(FH, $name)`, `open my $fh, "<$name"`, bareword handles | `open my $fh, '<', $name` with a lexical handle | 1-/2-arg forms apply "magic open": a name ending in `\|` runs a command | https://perldoc.perl.org/functions/open, PC `InputOutput::ProhibitTwoArgOpen`, `ProhibitBarewordFileHandles` |
| pl-shell-system | `system("cmd $var")`, `exec "..."`, backticks or `qx` with interpolation, `open` with `\|-`/`-\|` and a string | List form with two or more elements, or `system { $prog } @args`; capture output without a shell (`open` list form with `-\|`) | A one-element list with metacharacters goes to `/bin/sh -c` | https://perldoc.perl.org/functions/exec, https://perldoc.perl.org/functions/system |
| pl-eval-string | `eval "$code"`, `eval "require $mod"`, `eval "use $mod"` | Block `eval`; `require` on a validated module path or a module loader; never interpolate input | Compiles and runs arbitrary code | https://perldoc.perl.org/functions/eval, PC `BuiltinFunctions::ProhibitStringyEval` |
| pl-taint | Script that runs setuid/setgid, as CGI, or on input from another trust domain, without `-T` | `#!perl -T`; untaint with an allowlist capture (`/\A([\w.-]+)\z/`), never `/(.*)/`; set `$ENV{PATH}` to fixed absolute dirs | Taint stops tainted data reaching the shell, files and `eval` | https://perldoc.perl.org/perlsec, https://perldoc.perl.org/perlrun |
| pl-taint-dev | `-t` in a shipped script | `-T` | `-t` only warns; perlrun calls it a development aid | https://perldoc.perl.org/perlrun |
| pl-regex-dos | Nested quantifiers `(a+)+`, `(.*)*`, alternations that overlap, applied to external input; user input interpolated into a pattern | Possessive quantifiers / `(?>...)`, anchors, `\Q...\E` (`quotemeta`) for literal input, input length limits | Backtracking can be exponential | https://perldoc.perl.org/perlre, https://perldoc.perl.org/perlsec#Algorithmic-Complexity-Attacks |
| pl-sql-interp | SQL built with interpolation or `.` | DBI placeholders and bind values | SQL injection | https://metacpan.org/pod/DBI#Placeholders-and-Bind-Values |
| pl-rand-security | `rand`/`srand` for tokens, keys, salts | A CSPRNG module | The 5.44 perldelta still rules perl's PRNG out for security use | https://perldoc.perl.org/perldelta#New-source-of-entropy-for-PRNG-seeding |
| pl-utf8-layer | `:utf8` layer on input from outside | `:encoding(UTF-8)` | PC puts `RequireEncodingWithUTF8Layer` in the security theme (`:utf8` does not validate) | PC `InputOutput::RequireEncodingWithUTF8Layer` |

### 4.4 Performance

Report only on paths that run often; tag `static` or `needs-measurement`
and name the confirming command (`perl -d:NYTProf script; nytprofhtml`, or
`Benchmark` `cmpthese`). Do not call a claim verified without a baseline
and a rerun (PERF).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| pl-slurp-for | `for (<$fh>)`, `my @lines = <$fh>` on files of unbounded size | `while (my $l = <$fh>)` | Whole file in memory | PC `InputOutput::ProhibitReadlineInForLoop` |
| pl-boolean-grep | `if (grep { ... } @big)` | `List::Util::any` or core `any` (5.42, experimental) | `grep` scans the whole list | PC `BuiltinFunctions::ProhibitBooleanGrep`, https://perldoc.perl.org/perl5420delta#New-any-and-all-operators |
| pl-match-vars | `` $& ``, `` $` ``, `$'` | Fine on 5.20+ (COW); on older floors use `@-`/`@+` or `/p` with `${^MATCH}` | Pre-5.20 every match copies the string | https://perldoc.perl.org/perlvar, PC `Variables::ProhibitMatchVars` |
| pl-regex-in-loop | Pattern built from a variable inside a hot loop | Precompile with `qr//` outside the loop; needs-measurement | Recompilation per iteration | https://perldoc.perl.org/perlop (qr) |
| pl-unbounded-cache | Hash used as a cache with no size bound | Bound or expire it | Unbounded memory | general knowledge (no source opened) |
| pl-measure | Micro-optimisation without numbers | Baseline with Benchmark or Devel::NYTProf, then rerun | perlperf requires a rerun against the baseline | https://perldoc.perl.org/perlperf |

### 4.5 Modern Perl

Suggest only at or above the file's `use VERSION` floor (section 5).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| pl-signatures | `my ($a, $b) = @_;` on a floor ≥ 5.36 | `sub f ($a, $b = 1) { }`; `//=` / `\|\|=` defaults need 5.38 | Arity checked by perl; stable since 5.36 | https://perldoc.perl.org/perl5360delta#use-v5.36, https://perldoc.perl.org/perl5380delta |
| pl-sig-args-array | `@_`, `$_[0]`, bare `shift` inside a sub with a signature | Use the named parameters | Experimental (`experimental::args_array_with_signatures`), behaviour unspecified | https://perldoc.perl.org/perl5360delta |
| pl-sig-named | `:$name` named parameters | Only on 5.44+, and they are experimental | Warns in `experimental::signature_named_parameters` | https://perldoc.perl.org/perlsub#Signatures |
| pl-postfix-deref | Circumfix `@{ $x->{y} }` in new code on a floor ≥ 5.24 | `$x->{y}->@*` | Left-to-right reading; stable since 5.24 | https://perldoc.perl.org/perlref#Postfix-Dereference-Syntax, https://perldoc.perl.org/feature |
| pl-say | `print "...\n"` | `say` (feature `say`, in every bundle from 5.10) | Shorter; optional | https://perldoc.perl.org/feature |
| pl-isa | `blessed($o) && $o->isa('X')` on a floor ≥ 5.36 | `$o isa X` | Stable and in the 5.36 bundle (experimental 5.32–5.34) | https://perldoc.perl.org/perlop#Class-Instance-Operator |
| pl-builtin | `Scalar::Util::blessed/reftype/weaken`, `POSIX::floor`, hand-written `trim` | `builtin::` on 5.40+ (imported by `use v5.40`); `is_bool`, `inf`, `nan`, `stringify`, `created_as_*`, `export_lexically`, `load_module` are still experimental | Core, lexical import | https://perldoc.perl.org/builtin |
| pl-class | `use feature 'class'` / `class Foo { field ...; method ... }` | Experimental (5.38+), no roles yet, open bugs including object-storage corruption; not for code that must survive upgrades | Implementation may change | https://perldoc.perl.org/perlclass, https://perldoc.perl.org/feature#The-'class'-feature |
| pl-smartmatch | `~~`, `given`/`when` | Replace with `eq`/`==`/`any`/hash lookup | Off in the 5.36 (switch) and 5.42 (smartmatch) bundles; still experimental | https://perldoc.perl.org/perl5420delta#Switch-and-Smart-Match-operator-kept,-behind-a-feature |
| pl-v541-ascii | Non-ASCII bytes in source under `use v5.42`+ with no `use utf8` | Add `use utf8` (or escape) | `use v5.41`+ enables `source::encoding 'ascii'` | https://perldoc.perl.org/functions/use |
| pl-multi-foreach | `for my ($k, $v) (%h)` | Stable from 5.40, experimental on 5.36–5.38 | Version gate | https://perldoc.perl.org/perl5400delta |

### 4.6 Readability and structure

| id | Trigger | Check | Source |
|---|---|---|---|
| pl-modifier-hides | `die "..." unless open(...)`, `$v && print ...` | Put the main action first | https://perldoc.perl.org/perlstyle |
| pl-block-map | `map EXPR, LIST` / `grep EXPR, LIST`; `map`/`grep` in void context | Block form; `for` when the result is unused | PC `BuiltinFunctions::RequireBlockMap`, `RequireBlockGrep`; https://perldoc.perl.org/perlstyle |
| pl-regex-x | Long regex on one line | `/x` or `/xx` with whitespace and comments; non-slash delimiter when the pattern has slashes | https://perldoc.perl.org/perlstyle, PC `RegularExpressions::RequireExtendedFormatting` |
| pl-capture-test | `$1` used without testing the match | Use captures only inside `if (/.../)` or from the list return | PC `RegularExpressions::ProhibitCaptureWithoutTest` |
| pl-mixed-bool | `!$a or $b && $c` mixing `and/or/not` with `&&/\|\|/!` | One family per expression | PC `ValuesAndExpressions::ProhibitMixedBooleanOperators` |
| pl-names | `$VarNamesLikeThis`, lowercase package names | `$var_names_like_this`; packages capitalised (lowercase is for pragmas); `$ALL_CAPS` for constants | https://perldoc.perl.org/perlstyle |
| pl-prototypes | `sub f($$)` prototypes in new code | Remove (or signatures); see linter note on PPI | PC `Subroutines::ProhibitSubroutinePrototypes` |
| pl-ampersand-call | `&foo(...)` | `foo(...)` | PC `Subroutines::ProhibitAmpersandSigils` |
| pl-filename-package | `package` name not matching the `.pm` path | Rename | PC `Modules::RequireFilenameMatchesPackage` |
| pl-leading-zero | Numeric literal `0755` meant as decimal, or `chmod '0755'` string | Octal literal `0o755` (5.34+) or `0755` deliberately; never a string | PC `ValuesAndExpressions::ProhibitLeadingZeros` |

### 4.7 Testing

Patterns and examples: `perl-testing`. `test-reviewer` owns whether tests
protect behaviour; these are Perl-specific forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| pl-test-plan | `.t` with neither a plan nor `done_testing` | Add `done_testing` at the end (not in `END`) | https://metacpan.org/pod/Test::More |
| pl-test2-floor | `use Test2::V0` in a distribution whose floor is below 5.40 | Declare Test2::Suite (Test-Simple ≥ the needed version) in `cpanfile` test requires | In core only from 5.40 (perl5400delta) |
| pl-test2-is | Test ported from Test::More to Test2 comparing references with `is` | `ref_is` for identity; Test2 `is` is a deep compare | https://metacpan.org/pod/Test2::Manual::Testing::Migrating |
| pl-test2-pragmas | Test relying on bytes semantics or a fixed random order under Test2::V0 | V0 turns on `utf8` for the file and seeds `srand`; use `-no_utf8` / `-srand` | https://metacpan.org/pod/Test2::V0 |
| pl-test-exception | `eval { ... }; like($@, ...)` | `like(dies { ... }, qr/.../)`, `ok(lives { ... })` | https://metacpan.org/pod/Test2::Tools::Exception |
| pl-prove-lib | `prove t/` on a dist with modules under `lib/` | `prove -l` (`-r` for subdirs; `-j N` only for isolated tests; `-s` to expose order dependence) | https://metacpan.org/pod/prove |

## 5. Version-gated features

Latest stable: perl 5.44.0, released 2026-07-15 (perl.org/get.html,
perlhist); 5.42.3 is the latest maintenance release of the previous series.
Per perlpolicy, critical fixes go to the two most recent series and
security fixes to any series whose 5.x.0 is under three years old.

macOS system perl on this machine: `/usr/bin/perl` is 5.34.1 (observed with
`perl -v` in this run). 5.34.0 was released 2021-05-20, so it is outside the
three-year security window. Code with `#!/usr/bin/perl` or run by a bare
`perl` on this Mac cannot use `use v5.36` or anything below; it needs a
newer perl from Nix/mise/perlbrew with `#!/usr/bin/env perl`.

| Release (date) | Added or changed | Gotcha |
|---|---|---|
| 5.34 (2021-05-20) | `try`/`catch` (experimental); `0o` octal literals | The system perl here |
| 5.36 (2022-05-27) | `use v5.36` enables strict, warnings, `signatures` (stable), `isa` (stable), `say`; disables `indirect`, `multidimensional`, `switch`; `builtin::` (experimental); `defer`, `finally`, multi-value `for` (experimental) | `@_` inside a signatured sub is experimental |
| 5.38 (2023-07-02) | `class` feature (experimental); `module_true` and no `bareword_filehandles` in the bundle; `//=`/`\|\|=` defaults in signatures; switch/smartmatch deprecated (later reversed) | |
| 5.40 (2024-06-09) | `try`/`catch` stable and in the bundle; `builtin` stable (some functions still experimental) and imported by `use v5.40`; multi-value `for` stable; `__CLASS__`, `field :reader`; `^^` operator; Test2::Suite in core | A second `use VERSION` ≥ 5.39 in scope is fatal |
| 5.42 (2025-07-03) | `any`/`all` operators (experimental); `field :writer`; `my method`, `->&`; `^^=`; `use v5.41`+ sets `source::encoding 'ascii'`; smartmatch and `'` package separator dropped from the bundle; switch/smartmatch kept behind features | Non-ASCII source without `use utf8` fails under `use v5.42` |
| 5.44 (2026-07-15) | Named signature parameters (experimental); multi-variable `foreach` with ref aliases (experimental); `enhanced_xx`; Unicode 17; `getentropy()` PRNG seeding; three regex/pack CVE fixes | Unescaped `#` in `/xx` bracketed classes is deprecated; `goto` into a loop body is now an error |

## 6. Execution model

- Context propagation: the caller's context (list, scalar, void) flows into
  the sub and into its last evaluated expression and `return` argument;
  `wantarray` reads it, and `eval` blocks inherit it the same way (SUB,
  EVAL, https://perldoc.perl.org/functions/wantarray).
- Dynamic scope: `local` values are seen by every sub called while the block
  runs; global state (`$_`, `$@`, `$!`, `$?`, `$/`) is shared by all code in
  the process, so any call can overwrite it before you read it (SUB, VAR).
- Destruction is by reference count: `DESTROY` runs when the last reference
  goes, including during `die` unwinding, which is how an `eval` in a
  destructor clears `$@`; cycles are never freed without `weaken` (REF, TT).
- `fork`: unflushed output buffers are duplicated unless `$|` is set or
  handles are flushed; unreaped children become zombies, so `waitpid` (loop
  with `WNOHANG` in a `CHLD` handler) or set `$SIG{CHLD}` per platform
  (https://perldoc.perl.org/functions/fork, FORK). On Windows `fork` is
  emulated with interpreter threads (perlfork).
- Signals are deferred to safe points between ops since 5.8, so a handler
  does not run in the middle of an op; a long op such as a slow regex delays
  it (https://perldoc.perl.org/perlipc#Deferred-Signals-(Safe-Signals)).
- Threads: each ithread is a separate interpreter with copied data; sharing
  is explicit via `threads::shared`. The `threads` module documentation
  states interpreter-based threads are "officially discouraged"; perlthrtut
  itself does not say so (verified in this run). `exit` in a thread ends the
  whole program (THR).
- `perl -c` is not a static check: it runs `BEGIN`, `UNITCHECK`, `CHECK`
  and every `use` (RUN). The jig Stop gate runs `perl -c` on touched files
  (HOUSE), so loading a diff's modules executes their compile-time code.

## 7. Linter mapping

Run perltidy and Perl::Critic first and pass their output to the review;
never report "no issues" from a tool that did not run (neither is installed
on this machine; name the command). Perl::Critic parses with PPI and does
not execute code. Use the project's `.perlcriticrc`/`.perltidyrc` when
present; without one, `perlcritic --severity 3 <files>` and
`perltidy --assert-tidy -st <file>` (non-zero exit when not tidy). jig
already runs `perltidy -b -bext=/` on edit (HOUSE); `-pbp` combined with
`-b` needs `-nst` after it (TIDY). Do not restate what a tool that ran
already reported.

Severity is the policy's default from its 1.156 source (5 gentle … 1
brutal). Theme expressions use `&&`/`||`/`!` (or `and`/`or`/`not`); the
legacy `+` means union, so `core + pbp + security` selects all of `core`.
The `security` theme holds only `ProhibitTwoArgOpen` and
`RequireEncodingWithUTF8Layer`; it is not a security scan.

| Item | Policy | Severity |
|---|---|---|
| pl-strict-warnings | TestingAndDebugging::RequireUseStrict, RequireUseWarnings (`use v5.11+` / `v5.36+` count) | 5, 4 |
| pl-no-strict | TestingAndDebugging::ProhibitNoStrict, ProhibitNoWarnings | 5, 4 |
| pl-two-arg-open | InputOutput::ProhibitTwoArgOpen, ProhibitBarewordFileHandles | 5, 5 |
| pl-eval-string | BuiltinFunctions::ProhibitStringyEval | 5 |
| pl-return-undef | Subroutines::ProhibitExplicitReturnUndef | 5 |
| pl-cond-my | Variables::ProhibitConditionalDeclarations | 5 |
| pl-bless-one-arg | ClassHierarchies::ProhibitOneArgBless | 5 |
| pl-filename-package | Modules::RequireFilenameMatchesPackage | 5 |
| pl-leading-zero | ValuesAndExpressions::ProhibitLeadingZeros | 5 |
| pl-prototypes | Subroutines::ProhibitSubroutinePrototypes | 5 |
| pl-localize-punct | Variables::RequireLocalizedPunctuationVars | 4 |
| pl-indirect-new | Objects::ProhibitIndirectSyntax | 4 |
| pl-readline-for, pl-slurp-for | InputOutput::ProhibitReadlineInForLoop | 4 |
| pl-module-true | Modules::RequireEndWithOne | 4 |
| pl-block-map | BuiltinFunctions::RequireBlockMap, RequireBlockGrep | 4, 4 |
| pl-mixed-bool | ValuesAndExpressions::ProhibitMixedBooleanOperators | 4 |
| pl-match-vars | Variables::ProhibitMatchVars | 4 |
| pl-unchecked-syscall | InputOutput::RequireCheckedOpen, RequireCheckedClose, RequireCheckedSyscalls | 3, 2, 1 |
| pl-eval-unchecked | ErrorHandling::RequireCheckingReturnValueOfEval | 3 |
| pl-croak | ErrorHandling::RequireCarping | 3 |
| pl-regex-x | RegularExpressions::RequireExtendedFormatting | 3 |
| pl-capture-test | RegularExpressions::ProhibitCaptureWithoutTest | 3 |
| pl-shell-system (backticks only) | InputOutput::ProhibitBacktickOperators | 3 |
| pl-utf8-layer | InputOutput::RequireEncodingWithUTF8Layer | security theme |
| pl-local-vs-my | Variables::ProhibitLocalVars | 2 |
| pl-boolean-grep | BuiltinFunctions::ProhibitBooleanGrep | 2 |
| pl-ampersand-call | Subroutines::ProhibitAmpersandSigils | 2 |
| formatting | perltidy | — |

Conflicts to know: `ValuesAndExpressions::ProhibitConstantPragma`
(severity 4) flags `use constant`. `ProhibitSubroutinePrototypes` reports
any sub where PPI returns a prototype; PPI parses signatures as signatures
only from 1.281 (2024-12-27), so with an older PPI every signatured sub is a
false positive — check the installed PPI before reporting.

No linter decides: list vs scalar context at a call site, whether `system`
reaches a shell with external data, regex backtracking risk, taint need,
`$@` handling around destructors, whether a feature is experimental at the
file's floor, whether the interpreter that runs the file supports its `use
VERSION`, or missing tests. Those are the review's work.
