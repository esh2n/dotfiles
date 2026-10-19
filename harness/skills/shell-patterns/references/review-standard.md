# Shell review standard

The one shell standard for both the model writing a bash, zsh or sh script
and `code-reviewer` reviewing one. It lists what to check and where the rule
comes from. There is no dedicated shell reviewer agent; `code-reviewer`
applies this file, and shell injection findings also go to
`security-reviewer`.

Before applying any rule, read the shebang (`#!/bin/sh`, `#!/bin/bash`,
`#!/usr/bin/env bash`, `#!/usr/bin/env zsh`) or, for a sourced file, the
shell that sources it. The dialect decides which items apply: section 5
gates bash 4+ features, and zsh differs from bash in splitting, globbing and
array indexing. A file with no shebang that is executed directly runs under
whatever shell invokes it; flag that first.

## 1. Sources

All URLs were opened in this run (2026-10-19). Licences marked "not
checked" were not looked up; cite by name and link only.

| Id | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| SCW | ShellCheck wiki, per-check pages | https://www.shellcheck.net/wiki/SC2086 (pattern `/wiki/SC<code>`) | Problem, fix and exceptions for each check code | Live wiki; fetched 2026-10-19 | not checked |
| SCS | ShellCheck source (severity of each check) | https://github.com/koalaman/shellcheck/tree/master/src/ShellCheck | `err`/`warn`/`info`/`style` level per code (`Analytics.hs`, `Checks/Commands.hs`, `Parser.hs`) | `master`, fetched 2026-10-19 | GPL-3.0 (tool) |
| SCM | ShellCheck manual | https://github.com/koalaman/shellcheck/blob/master/shellcheck.1.md | `--severity`, `--shell` values (sh, bash, dash, ksh, busybox), optional checks | `master` | GPL-3.0 |
| GSG | Google Shell Style Guide | https://google.github.io/styleguide/shellguide.html | When to use shell (100-line limit), `main`, `local`, `[[ ]]`, eval, arrays, pipes to while, return values, builtins | Current page; fetched 2026-10-19 | not checked |
| BP | BashPitfalls (Greg's Wiki) | https://mywiki.wooledge.org/BashPitfalls | Numbered pitfalls (cited as BP#n), incl. #60 on `set -euo pipefail` | Live wiki | not checked |
| F105 | BashFAQ/105: why `set -e` does not do what you expect | https://mywiki.wooledge.org/BashFAQ/105 | errexit exceptions: `local`, functions in conditions, command substitution, arithmetic | Live wiki | not checked |
| F062 | BashFAQ/062: temporary files | https://mywiki.wooledge.org/BashFAQ/062 | `mktemp -d` plus `trap ... EXIT` | Live wiki | not checked |
| F001 | BashFAQ/001: read a file line by line | https://mywiki.wooledge.org/BashFAQ/001 | `while IFS= read -r` | Live wiki | not checked |
| F020 | BashFAQ/020: file names with spaces and newlines | https://mywiki.wooledge.org/BashFAQ/020 | `find -print0`, `-exec`, NUL-delimited reads | Live wiki | not checked |
| F024 | BashFAQ/024: variables set in a piped loop disappear | https://mywiki.wooledge.org/BashFAQ/024 | Pipeline subshells, process substitution, `lastpipe` | Live wiki | not checked |
| F048 | BashFAQ/048: eval | https://mywiki.wooledge.org/BashFAQ/048 | Double parsing, code injection, namerefs not a fix | Live wiki | not checked |
| F050 | BashFAQ/050: commands in variables | https://mywiki.wooledge.org/BashFAQ/050 | Use arrays or functions, not strings | Live wiki | not checked |
| WQ | Quotes; WordSplitting (Greg's Wiki) | https://mywiki.wooledge.org/Quotes, https://mywiki.wooledge.org/WordSplitting | Quoting rules, `"$@"`, IFS splitting | Live wiki | not checked |
| BSET | Bash manual: The Set Builtin | https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html | `-e` exceptions, `-u`, `pipefail` | Bash 5.3 manual | GFDL |
| BSHOPT | Bash manual: The Shopt Builtin | https://www.gnu.org/software/bash/manual/html_node/The-Shopt-Builtin.html | `inherit_errexit`, `lastpipe`, `nullglob`, `failglob` | Bash 5.3 manual | GFDL |
| BPIPE | Bash manual: Pipelines | https://www.gnu.org/software/bash/manual/html_node/Pipelines.html | Each pipeline element in a subshell; exit status; `lastpipe` | Bash 5.3 manual | GFDL |
| BCEE | Bash manual: Command Execution Environment | https://www.gnu.org/software/bash/manual/html_node/Command-Execution-Environment.html | What runs in a subshell; `-e` cleared in command substitution | Bash 5.3 manual | GFDL |
| BNEWS | Bash NEWS | https://tiswww.case.edu/php/chet/bash/NEWS | Version in which each feature arrived (2.0 to 5.3) | Through bash-5.3 | GPL-3.0 (bash) |
| POSIX | POSIX.1-2024 Shell Command Language | https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html | Portable sh: special built-ins (no `local`), `set -e`, `pipefail` (added by Austin Group Defect 789) | Issue 8 (2024) | The Open Group terms |
| PECHO / PSED | POSIX `echo`, `sed` | https://pubs.opengroup.org/onlinepubs/9799919799/utilities/echo.html, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/sed.html | `echo` options implementation-defined, use `printf`; `sed` has no `-i` | Issue 8 | The Open Group terms |
| BSDSED | FreeBSD `sed(1)` | https://man.freebsd.org/cgi/man.cgi?query=sed&sektion=1 | BSD `sed -i extension` takes a required argument | Current FreeBSD | BSD |
| ZOPT | zsh manual: Options | https://zsh.sourceforge.io/Doc/Release/Options.html | `SH_WORD_SPLIT`, `KSH_ARRAYS`, `NOMATCH`, `ERR_EXIT`, `ERR_RETURN`, `PIPE_FAIL` | zsh 5.9 docs | zsh licence (MIT-like), not checked |
| ZFAQ | zsh FAQ 3.1 | https://zsh.sourceforge.io/FAQ/zshfaq03.html | Unquoted `$var` not split by default; `${=var}` forces splitting | Current | not checked |
| SHFMT | mvdan/sh (shfmt) | https://github.com/mvdan/sh | Formatter and parser for POSIX sh, bash, zsh, mksh | `master` | BSD-3-Clause |
| BATS | bats-core documentation | https://bats-core.readthedocs.io/en/stable/ | TAP-compliant test framework for Bash 3.2+ | stable docs | MIT |
| HOUSE | House rules | `~/.claude/CLAUDE.md` (Bash: `set -euo pipefail`; no installer piped from `curl`), `harness/rules/decisions/2026-09-25-dotctl-in-go.md`, `harness/rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md` | When shell is allowed; bash defaults | Accepted 2026-09-25 | This repository |

Observed on the owner's Mac in this run, not from a document: `/bin/bash`
is `GNU bash, version 3.2.57`; `/usr/bin/sed` rejects `--version` (BSD
sed); zsh is 5.9.

Not opened in this run and therefore not cited: the GNU sed manual (the
request timed out), BashFAQ/031 (`[[` vs `[`), ShellCheck's GitHub wiki
`Severity` page (renders client-side), dash's `pipefail` support, Apple's
documentation on why `/bin/bash` stays at 3.2. Treat any claim resting on
them as unverified.

## 2. Mindset

- Shell is for gluing other programs together with little data
  manipulation. A script past 100 lines, with non-trivial control flow, or
  that prints, logs or reports errors to the user, is rewritten in Go as a
  `dotctl` subcommand (GSG#when-to-use-shell, HOUSE).
- Every expansion is double-quoted unless splitting and globbing are wanted
  on purpose; lists of arguments live in arrays, never in strings
  (WQ, F050).
- Every command whose failure matters is checked explicitly.
  `set -euo pipefail` is the house default for bash and catches the cases
  nobody thought of, but it does not fire in conditions, `&&`/`||` lists,
  `local x=$(cmd)` or command substitution (BSET, F105, BP#60).
- Resources a script creates (temp directories, background jobs, changed
  directories) are released by a `trap ... EXIT` set right after creation
  (F062).
- Error messages go to stderr; the exit status is the result
  (GSG#stdout-vs-stderr).
- Know the dialect: sh, bash 3.2, bash 5 and zsh accept different syntax
  and expand the same text differently.

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| Treating `$var` like a variable reference that yields one value | Quote it; unquoted, its value is split on IFS and each piece globbed | https://www.shellcheck.net/wiki/SC2086, https://mywiki.wooledge.org/WordSplitting |
| Building a command line as a string, then running `$cmd` | Use an array (`cmd=(git -C "$d" log)`; `"${cmd[@]}"`) or a function | https://mywiki.wooledge.org/BashFAQ/050 |
| `arr=( $(cmd) )` expecting one element per line | `mapfile -t arr < <(cmd)` (bash 4+), or a `while IFS= read -r` loop on 3.2 | https://www.shellcheck.net/wiki/SC2207 |
| Expecting the script to stop on the first error, as with exceptions | `set -e` has many exceptions; check critical commands with `|| exit` / `|| return` | https://mywiki.wooledge.org/BashFAQ/105, https://mywiki.wooledge.org/BashPitfalls (#60) |
| `a && b || c` read as a ternary | Use `if a; then b; else c; fi`; `c` also runs when `b` fails | https://mywiki.wooledge.org/BashPitfalls (#22) |
| `if [ false ]` / `if [grep ...]` expecting a boolean test | `if` runs a command and tests its exit status; `[ false ]` is true (non-empty string) | https://mywiki.wooledge.org/BashPitfalls (#9) |
| Variables set inside a piped `while` loop expected after it | The loop runs in a subshell; feed it with `< <(cmd)` or `< file` | https://mywiki.wooledge.org/BashFAQ/024, https://google.github.io/styleguide/shellguide.html#pipes-to-while |
| Variables in a function assumed local | Declare with `local`; shell variables are global by default | https://google.github.io/styleguide/shellguide.html#use-local-variables |
| `printf "$msg"` like a print call | `printf '%s\n' "$msg"`; a variable format string interprets `%` and `\` | https://www.shellcheck.net/wiki/SC2059, https://mywiki.wooledge.org/BashPitfalls (#32) |
| Testing in the interactive zsh and assuming bash behaves the same | zsh does not split unquoted `$var` by default; run the script under its shebang shell | https://zsh.sourceforge.io/FAQ/zshfaq03.html |

## 4. Review items

Each row: id, what in a diff triggers it, what to check, why, source.
Items ShellCheck already reports are listed so the reviewer knows the rule
exists; do not restate a finding ShellCheck printed (section 7).

### 4.1 Quoting and word splitting

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-quote-var | Unquoted `$var`, `${var}` or `$1` as a command argument | Double-quote it, or justify the split with a comment and use `${=var}` in zsh / an array in bash | Splitting and globbing break on spaces and `*` in data | https://www.shellcheck.net/wiki/SC2086 |
| sh-quote-cmdsub | Unquoted `$(cmd)` as an argument | Quote it; if `cmd` emits several items, loop over them | Same splitting and globbing on command output | https://www.shellcheck.net/wiki/SC2046 |
| sh-quote-at | `$@`, `$*`, `${arr[@]}` unquoted, or `"$*"` where separate arguments are meant | Use `"$@"` / `"${arr[@]}"` | Unquoted forms re-split each element | https://www.shellcheck.net/wiki/SC2068, https://www.shellcheck.net/wiki/SC2048 |
| sh-array-from-split | `arr=( $var )` or `arr=( $(cmd) )` | `read -ra arr <<< "$var"`, `mapfile -t` (bash 4+) or a `read -r` loop | Unquoted splitting plus globbing into the array | https://www.shellcheck.net/wiki/SC2206, https://www.shellcheck.net/wiki/SC2207 |
| sh-single-quote-expansion | `$var` or `$(...)` inside single quotes where expansion is intended | Use double quotes, or mix quote types in one word | Single quotes expand nothing | https://www.shellcheck.net/wiki/SC2016 |
| sh-ls-parse | `for f in $(ls ...)`, `ls ... | grep`, `ls -l | awk` | Use a glob (`for f in ./*.txt`), `find`, or `stat` | `ls` output is for people and mangles names | https://www.shellcheck.net/wiki/SC2045, https://www.shellcheck.net/wiki/SC2012, https://www.shellcheck.net/wiki/SC2010 |
| sh-find-loop | `for f in $(find ...)`, `find ... | xargs` without `-print0`/`-0` | `find -exec ... {} +`, or `find -print0` with `while IFS= read -r -d ''` | Names with spaces or newlines split | https://www.shellcheck.net/wiki/SC2044, https://www.shellcheck.net/wiki/SC2038, https://mywiki.wooledge.org/BashFAQ/020 |
| sh-read-raw | `read` without `-r`, or without `IFS=` when whole lines matter | `IFS= read -r line` | Backslashes are eaten and edge whitespace trimmed | https://www.shellcheck.net/wiki/SC2162, https://mywiki.wooledge.org/BashFAQ/001 |
| sh-dash-args | A glob (`*`) or user value passed as a file argument to `rm`, `cp`, `mv` | Use `./*` and `--` before operands | A file named `-rf` becomes an option | https://google.github.io/styleguide/shellguide.html#wildcard-expansion-of-filenames, https://mywiki.wooledge.org/BashPitfalls (#3) |
| sh-empty-glob | Loop over a glob that may match nothing | `shopt -s nullglob` (bash) or `[[ -e $f ]] || continue`; in zsh, `NOMATCH` makes a no-match an error | Unmatched glob stays literal in bash/sh | https://www.shellcheck.net/wiki/SC2045, https://www.gnu.org/software/bash/manual/html_node/The-Shopt-Builtin.html, https://zsh.sourceforge.io/Doc/Release/Options.html |
| sh-dbl-bracket-rhs | `[[ $a = $b ]]` or `[[ $a == $b ]]` with unquoted right side | Quote the right side unless pattern matching is intended | Unquoted RHS is a glob pattern | https://mywiki.wooledge.org/BashPitfalls (#34) |
| sh-zsh-split | zsh code relying on `$var` splitting into words | Use `${=var}` or an array; do not set `SH_WORD_SPLIT` globally | zsh does not split unquoted parameters by default | https://zsh.sourceforge.io/FAQ/zshfaq03.html, https://zsh.sourceforge.io/Doc/Release/Options.html |

### 4.2 Error handling

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-strict-mode | New bash script without `set -euo pipefail` | Add it after the shebang (house default); for sh, `set -eu` plus explicit checks | House rule; unset variables and failed pipelines otherwise pass silently | HOUSE, https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html |
| sh-errexit-gap | Reliance on `set -e` to stop after a command whose failure matters | Add an explicit check (`cd -- "$d" || exit`); `-e` is ignored after `if`/`while`/`until`, in `&&`/`||` lists except the last, under `!`, and inside a function called from any of those | errexit does not fire in those contexts | https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html, https://mywiki.wooledge.org/BashFAQ/105, https://mywiki.wooledge.org/BashPitfalls (#60) |
| sh-masked-status | `local x=$(cmd)`, `export x=$(cmd)`, `declare x=$(cmd)`, `readonly x=$(cmd)` | Declare, then assign on a separate line | The builtin's status (0) replaces `cmd`'s | https://www.shellcheck.net/wiki/SC2155, https://google.github.io/styleguide/shellguide.html#use-local-variables |
| sh-cmdsub-errexit | A function that relies on `set -e` called inside `$(...)` | Check inside the function (`|| return`), or `shopt -s inherit_errexit` (bash 4.4+) | Bash clears `-e` in command substitution unless `inherit_errexit` is set | https://www.gnu.org/software/bash/manual/html_node/Command-Execution-Environment.html, https://www.gnu.org/software/bash/manual/html_node/The-Shopt-Builtin.html, https://mywiki.wooledge.org/BashPitfalls (#60) |
| sh-cmdsub-unchecked | `x=$(cmd)` where an empty result is then used as a path or argument | Check the status (`x=$(cmd) || exit`) or use `${x:?}` | A failed fork or command yields an empty string | https://www.shellcheck.net/wiki/SC2115, https://www.shellcheck.net/wiki/SC2312 |
| sh-pipefail-sigpipe | `set -o pipefail` with an early-exiting reader (`grep -q`, `head`) | Confirm the writer's SIGPIPE status cannot flip the result; restructure if it can | With pipefail, the writer killed by SIGPIPE makes a successful match look like failure | https://mywiki.wooledge.org/BashPitfalls (#60) |
| sh-pipestatus | Pipeline where a non-last stage's failure matters, no `pipefail` | Enable `pipefail` or copy `PIPESTATUS` immediately | Without it the status is only the last command's | https://www.gnu.org/software/bash/manual/html_node/Pipelines.html, https://google.github.io/styleguide/shellguide.html#checking-return-values |
| sh-cd-unchecked | `cd dir` followed by commands, without `|| exit`/`|| return` or `set -e` covering it | Add the check; prefer a subshell `( cd -- "$d" && cmd )` | Commands run in the wrong directory, including `rm` | https://www.shellcheck.net/wiki/SC2164, https://mywiki.wooledge.org/BashPitfalls (#19) |
| sh-dollar-q | `cmd; if [ $? -ne 0 ]` | `if ! cmd; then` | A later line inserted between them changes `$?`; with `-e` the script exits before the check | https://www.shellcheck.net/wiki/SC2181 |
| sh-arith-errexit | `((i++))` or `let i++` under `set -e` where `i` may be 0 | Use `i=$((i + 1))` or `((++i))` with care | An arithmetic result of 0 returns status 1 and exits | https://mywiki.wooledge.org/BashFAQ/105 |
| sh-trap-quote | `trap "... $var ..." EXIT` | Single-quote the trap body | Double quotes expand when the trap is set, not when it runs | https://www.shellcheck.net/wiki/SC2064 |
| sh-cleanup-trap | Script creates temp files, background jobs or lock files | `trap cleanup EXIT` set right after creation; cleanup idempotent | Interrupted or failed runs leak resources | https://mywiki.wooledge.org/BashFAQ/062 |
| sh-rm-empty-var | `rm -rf "$dir/"*` or `rm -rf "$dir"` with a variable that can be empty | `"${dir:?}"` | An empty variable turns the path into `/` | https://www.shellcheck.net/wiki/SC2115 |
| sh-stderr | Error messages printed to stdout | `>&2`, non-zero exit | Callers parse stdout; status is the result | https://google.github.io/styleguide/shellguide.html#stdout-vs-stderr |

### 4.3 Portability

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-shebang-dialect | `#!/bin/sh` script using `[[ ]]`, arrays, `local`, `function`, `$'...'`, `<( )`, `{1..n}` | Change the shebang to bash, or rewrite in POSIX | Those are undefined in POSIX sh; `/bin/sh` may be dash | https://www.shellcheck.net/wiki/SC3010, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html |
| sh-bash-version | Bash script using a section 5 feature with a `#!/bin/bash` shebang that runs on macOS | Use `#!/usr/bin/env bash` and require a Nix/Homebrew bash, or stay within 3.2 | macOS `/bin/bash` is 3.2 | BNEWS, observed `/bin/bash --version` |
| sh-echo-flags | `echo -n`, `echo -e`, or `echo "$var"` where `$var` may start with `-` or contain `\` | `printf '%s\n'` | `echo` options and escapes are implementation-defined | https://pubs.opengroup.org/onlinepubs/9799919799/utilities/echo.html |
| sh-sed-inplace | `sed -i` in a script that runs on macOS and Linux | `sed -i.bak ... && rm file.bak`, or write to a temp file and `mv` | GNU `-i` takes an optional suffix, BSD `-i` a required one; POSIX has no `-i` | https://man.freebsd.org/cgi/man.cgi?query=sed&sektion=1, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/sed.html |
| sh-gnu-only-flags | `date -d`, `readlink -f`, `grep -P`, `xargs -r`, `stat -c` in cross-platform scripts | Confirm the BSD tool on macOS accepts it, or depend on the Nix-provided GNU tool explicitly (unverified per-flag; check `man` on both) | macOS ships BSD userland | observed `/usr/bin/sed`; GNU vs BSD flag lists not opened |
| sh-zsh-arrays | zsh code indexing arrays from 0, or bash code ported to zsh | zsh arrays start at 1 unless `KSH_ARRAYS`; use `emulate -L` in functions that need sh/ksh rules | Off-by-one across shells | https://zsh.sourceforge.io/Doc/Release/Options.html, https://zsh.sourceforge.io/FAQ/zshfaq03.html |
| sh-backticks | `` `cmd` `` | `$(cmd)` | Backticks nest badly and have odd escaping | https://www.shellcheck.net/wiki/SC2006 |

### 4.4 Security

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-eval | `eval` on anything built from variables, arguments or command output | Replace with arrays, `printf -v`, or `declare`; if unavoidable, escape with `printf %q` and justify | Text is parsed twice; data becomes code | https://mywiki.wooledge.org/BashFAQ/048, https://google.github.io/styleguide/shellguide.html#eval, https://www.shellcheck.net/wiki/SC2294 |
| sh-cmd-injection | External input placed into `sh -c "..."`, `ssh host "..."`, `find -exec sh -c '... {} ...'`, `su -c`, or a `sed`/`awk` program text | Pass data as positional arguments (`sh -c '... "$1"' _ "$x"`), or validate against an allowlist | The input is parsed as shell code | https://mywiki.wooledge.org/BashPitfalls (#52), https://www.shellcheck.net/wiki/SC2091 |
| sh-input-validate | Script arguments or env vars used as paths, numbers or options without checks | Validate format (`[[ $n =~ ^[0-9]+$ ]]`), reject leading `-`, use `--` | Unchecked input reaches `rm`, arithmetic, and option parsing | https://mywiki.wooledge.org/BashPitfalls (#3, #46), HOUSE (validate at every boundary) |
| sh-tempfile | Fixed or `$$`-based names under `/tmp` | `d=$(mktemp -d) || exit; trap 'rm -rf -- "$d"' EXIT` | Predictable names in a world-writable directory can be raced or pre-created | https://mywiki.wooledge.org/BashFAQ/062 |
| sh-curl-pipe | `curl ... | sh`, `curl ... | bash`, `wget -O- ... | sh` | Download to a file, verify a checksum or signature, then run; or use the Nix package | House rule forbids installers piped from `curl` | HOUSE |
| sh-printf-format | `printf "$var"` | `printf '%s' "$var"` | Format-string injection | https://www.shellcheck.net/wiki/SC2059, https://mywiki.wooledge.org/BashPitfalls (#32) |
| sh-suid | `chmod u+s`/`g+s` on a shell script | Remove; use `sudo` with a narrow rule | Shell scripts cannot be made safe as SUID/SGID | https://google.github.io/styleguide/shellguide.html#suidsgid |
| sh-secret-argv | Token or password passed as a command-line argument or echoed under `set -x` | Pass through env or stdin; disable `xtrace` around it | argv and xtrace output are visible to other users and logs (unverified beyond common practice; no source opened) | HOUSE (no secrets in source or logs) |

### 4.5 Performance

Report only on a path that runs many times or on data whose size is known
to matter; "useless cat" alone is not a finding (ShellCheck made SC2002
optional in 0.11.0).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-fork-in-loop | `$(sed ...)`, `$(basename ...)`, `$(echo ... | cut ...)` inside a loop over many items | Use parameter expansion (`${f##*/}`, `${s/#foo/bar}`) or one `awk` over the whole input | Each substitution forks; builtins do not | https://google.github.io/styleguide/shellguide.html#builtin-commands-vs-external-commands |
| sh-perf-switch | Shell loop processing large data line by line | Move the work into one `awk`/`jq` call, or out of shell | Shell is slow at data processing | https://google.github.io/styleguide/shellguide.html#when-to-use-shell |
| sh-repeated-redirect | Many `echo ... >> file` lines in a row | Group: `{ cmd1; cmd2; } >> file` | Opens the file once (style) | https://www.shellcheck.net/wiki/SC2129 |
| sh-useless-cat | `cat file | cmd` | Only if measured or in a hot loop; `cmd < file` | Extra process; optional check | https://www.shellcheck.net/wiki/SC2002 |
| sh-multi-date | Several `date` calls building one timestamp | One call, or `printf '%(...)T'` (bash 4.2+) / `$EPOCHSECONDS` (5.0+) | Values can straddle a boundary between calls | https://mywiki.wooledge.org/BashPitfalls (#58) |

### 4.6 Readability and structure

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-size-limit | Script grows past 100 lines, gains non-trivial control flow, or prints/logs/reports errors to the user | Move it to a `dotctl` subcommand in Go; shell stays only for thin hand-off entry points and zsh functions that change the calling shell | House rule and Google guide agree on 100 lines | HOUSE, https://google.github.io/styleguide/shellguide.html#when-to-use-shell |
| sh-main | Script with more than one function and top-level code | Put the program in `main`, last line `main "$@"` | One entry point; allows `local` everywhere | https://google.github.io/styleguide/shellguide.html#main |
| sh-local | Function assigns variables without `local` | Declare `local` (separate from command-substitution assignment) | Variables leak to the global scope | https://google.github.io/styleguide/shellguide.html#use-local-variables |
| sh-cmd-in-var | Command or options stored in a string variable | Array or function | Strings cannot hold argument boundaries | https://mywiki.wooledge.org/BashFAQ/050 |
| sh-alias-in-script | `alias` inside a script | Use a function | Aliases expand at definition, are hard to quote | https://google.github.io/styleguide/shellguide.html#aliases |
| sh-test-brackets | `[ ]` / `test` in a bash script | Prefer `[[ ]]` in bash; keep `[ ]` in sh | `[[ ]]` does no splitting or globbing on operands | https://google.github.io/styleguide/shellguide.html#tests |
| sh-pipe-while-var | `cmd | while read ...; do var=...; done; use "$var"` | `while ...; done < <(cmd)` or `shopt -s lastpipe` (bash 4.2+, no job control) | Variables set in the subshell are lost | https://www.shellcheck.net/wiki/SC2031, https://mywiki.wooledge.org/BashFAQ/024 |
| sh-unused-var | Variable assigned, never read; or read, never assigned | Fix the name or remove | Often a typo | https://www.shellcheck.net/wiki/SC2034, https://www.shellcheck.net/wiki/SC2154 |
| sh-same-file-pipe | Reading and writing the same file in one pipeline (`cmd f | x > f`) | Write to a temp file, then `mv` | The redirection truncates the file before it is read | https://www.shellcheck.net/wiki/SC2094, https://mywiki.wooledge.org/BashPitfalls (#13) |

### 4.7 Testing

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| sh-bats | New or changed script behaviour with no `.bats` test | Add a bats test that runs the script and asserts status and output; this repository runs bats through `tests/run.sh` | Behaviour of shell glue is otherwise untested | https://bats-core.readthedocs.io/en/stable/ |
| sh-shellcheck-ci | New `.sh`/`.bash` file not listed in the CI `shellcheck` job (`.github/workflows/ci.yaml`) | Add it to the `shellcheck -x` list | CI only checks listed files | https://github.com/koalaman/shellcheck/blob/master/shellcheck.1.md, `.github/workflows/ci.yaml` |
| sh-shellcheck-disable | `# shellcheck disable=SCxxxx` added | A comment states why the warning is a false positive; scope it to one line | Blanket disables hide later regressions | https://github.com/koalaman/shellcheck/blob/master/shellcheck.1.md (directives) |
| sh-test-under-shebang | Test runs the script with a different shell than its shebang (e.g. `zsh script.sh`, `sh script.bash`) | Run it as `./script` or with the shebang's interpreter | zsh and sh expand differently from bash | https://zsh.sourceforge.io/FAQ/zshfaq03.html |

## 5. Version-gated features

macOS `/bin/bash` is 3.2.57 (observed). A script with `#!/bin/bash` that
runs on macOS must avoid everything below unless it requires a newer bash
on `PATH` (`#!/usr/bin/env bash` plus Nix or Homebrew bash). Versions come
from BNEWS (https://tiswww.case.edu/php/chet/bash/NEWS).

| Feature | Bash version | 3.2 alternative |
|---|---|---|
| Associative arrays (`declare -A`) | 4.0 | Parallel indexed arrays, or switch language |
| `mapfile` / `readarray` | 4.0 (`-d` in 4.4) | `while IFS= read -r l; do a+=("$l"); done < <(cmd)` |
| `globstar` (`**`) | 4.0 | `find` |
| `|&`, `;;&`, `${v^^}` / `${v,,}` case modification, `coproc` | 4.0 | `2>&1 |`; `tr '[:lower:]' '[:upper:]'` |
| `lastpipe` shopt, negative array subscripts, `printf '%(fmt)T'` | 4.2 | Process substitution; `${a[${#a[@]}-1]}`; `date` |
| Namerefs (`declare -n`), `wait -n` | 4.3 | Pass values via stdout; `wait "$pid"` per job |
| `inherit_errexit` shopt, `${v@Q}` and other `@` transformations | 4.4 | Explicit checks inside command substitution; `printf %q` |
| `EPOCHSECONDS`, `EPOCHREALTIME`, `BASH_ARGV0` | 5.0 | `date +%s` |
| `test -v N` for positional parameters; `wait -p`; `@U`/`@u`/`@L` | 5.1 | `[ "$#" -ge N ]` |

zsh differences that change behaviour of the same text (ZOPT, ZFAQ):

| zsh behaviour (default options) | bash/sh behaviour |
|---|---|
| Unquoted `$var` is not split (`SH_WORD_SPLIT` off); `${=var}` splits | Split on IFS, then globbed |
| Arrays indexed from 1 (`KSH_ARRAYS` off) | From 0 |
| A glob with no match is an error (`NOMATCH`) | Left as literal text (unless `nullglob`/`failglob`) |
| `ERR_EXIT`, `ERR_RETURN`, `PIPE_FAIL` are the option names; `ERR_RETURN` returns from the function | `set -e`, `set -o pipefail`; no `ERR_RETURN` |
| `emulate -L sh` / `emulate -L ksh` scopes sh-like rules to a function | n/a |

POSIX sh: `pipefail` is in POSIX.1-2024 (Austin Group Defect 789); older
`/bin/sh` implementations may lack it (dash support not verified in this
run). `local` is not a POSIX built-in.

## 6. Execution model

What decides where a variable change is visible and which exit status a
check sees.

- Subshells: command substitution `$(...)`, `( ... )` groups, each element
  of a pipeline, and background `&` jobs run in a copy of the shell.
  Variable assignments, `cd`, `set` and traps made there do not reach the
  parent (BCEE, BPIPE). A function that must change the caller's state
  (`cd`, environment) can only do it when run in the current shell, which is
  why such code stays a zsh function and never becomes a `dotctl`
  subcommand (HOUSE).
- Pipelines: elements run concurrently and are connected by pipes. In bash
  the last element also runs in a subshell unless `lastpipe` is set and job
  control is off (scripts) (BPIPE, BSHOPT). zsh runs the last element of a
  pipeline in the current shell (not verified against the zsh manual in this
  run; check before relying on it). Reading and writing the same file in one
  pipeline races (SC2094).
- Exit status: a pipeline's status is its last element's, or with
  `pipefail` the rightmost non-zero one; `!` negates it; `PIPESTATUS`
  holds every element's status until the next command (BSET, BPIPE, GSG).
  `local`/`export`/`declare`/`readonly` with an assignment return their own
  status, not the substituted command's (SC2155).
- errexit propagation: `-e` applies to each subshell separately, is cleared
  in command substitution unless `inherit_errexit`, and is ignored for the
  whole body of a function called in a condition or `&&`/`||` list (BSET,
  BCEE, F105). POSIX describes the same function-body rule (POSIX).
- Traps: set `EXIT` cleanup in the shell that owns the resource; whether a
  subshell inherits the parent's traps was not verified in this run (the
  bash manual page did not load), so do not rely on it either way. The trap body is
  expanded when it runs only if single-quoted (SC2064).
- Background jobs: `cmd &` returns at once; collect with `wait "$pid"` to
  get its status. A job left running when the script exits keeps running
  unless the `EXIT` trap kills it (F062 shows the trap pattern).

## 7. Linter mapping

Run `shfmt -d` (or `shfmt -l -w`) and `shellcheck` first and pass their
output to the review. This repository's CI runs `shellcheck -x` on a listed
set of scripts (`.github/workflows/ci.yaml`) and bats via `tests/run.sh`;
there is no shfmt config committed. ShellCheck accepts only sh, bash, dash,
ksh and busybox (SCM); on a zsh file it stops with SC1071, so zsh files get
`zsh -n file` for syntax and this standard by hand. shfmt parses zsh
(SHFMT). Do not restate what a tool that ran already reported.

Severity is ShellCheck's own level from its source (SCS); `-S warning` hides
`info` and `style`.

| Item | Caught by | Severity |
|---|---|---|
| sh-quote-var | SC2086 | info |
| sh-quote-cmdsub | SC2046 | warning |
| sh-quote-at | SC2068, SC2048 | error, warning |
| sh-array-from-split | SC2206, SC2207 | warning |
| sh-single-quote-expansion | SC2016 | info |
| sh-ls-parse | SC2045, SC2012, SC2010 | error (warning when `ls` has flags), info, warning |
| sh-find-loop | SC2044, SC2038 | warning |
| sh-read-raw | SC2162 | info |
| sh-masked-status | SC2155 (`local -r` and others only with optional `check-extra-masked-returns`, SC2312) | warning; SC2312 info, optional |
| sh-cd-unchecked | SC2164 | warning |
| sh-dollar-q | SC2181 | style |
| sh-trap-quote | SC2064 | warning |
| sh-rm-empty-var | SC2115 | warning |
| sh-shebang-dialect | SC3xxx family, e.g. SC3010 (only with `#!/bin/sh` or `-s sh`) | warning |
| sh-backticks | SC2006 | style |
| sh-eval (eval of arrays) | SC2294 | warning |
| sh-cmd-injection (`$(...)` run as a command) | SC2091 | warning |
| sh-printf-format | SC2059 | info |
| sh-repeated-redirect | SC2129 | style |
| sh-useless-cat | SC2002 (optional `useless-use-of-cat` since 0.11.0) | style |
| sh-pipe-while-var | SC2031 | info |
| sh-unused-var | SC2034; SC2154 for uppercase names only with optional `check-unassigned-uppercase` | warning |
| sh-same-file-pipe | SC2094 | info |
| formatting, indentation | `shfmt` | — |

No linter decides: whether the script should be shell at all
(sh-size-limit), whether `set -e` actually covers a given failure
(sh-errexit-gap, sh-cmdsub-errexit), pipefail with SIGPIPE
(sh-pipefail-sigpipe), injection through `sh -c`/`ssh`/`sed` program text
(sh-cmd-injection), input validation, temp-file and cleanup design,
`curl | sh`, GNU vs BSD flags, bash 3.2 compatibility, zsh semantics, or
missing bats tests. Those are the review's work.
