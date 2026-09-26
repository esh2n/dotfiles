#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The repository works for anyone who clones it, anywhere: no path or host
# name of one machine is written into it, every committed link stays inside
# it, and no text file turns binary. Ported from the old layout's
# core/validation/portability.sh; the file list is now every tracked text
# file, less the records that quote real paths as evidence and the tests'
# own fixtures.

REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

# tracked files in scope, NUL-separated
scoped_files() {
	git -C "${REPO_ROOT}" ls-files -z -- . \
		':!harness/rules/research' ':!harness/rules/decisions' ':!plans' \
		':!tests' ':!harness/jig/test' \
		':!home/shared/litellm/config/bench/report.md' # a benchmark's own output
}

@test "portability: no absolute home path or checkout path of one machine" {
	# {{HOME}}-style placeholders are expanded at install time; /Users/me/
	# is the documentation's made-up user.
	hits="$(scoped_files | (cd "${REPO_ROOT}" && xargs -0 grep -nIE '(/Users/[A-Za-z0-9_.]+/|go/github\.com/esh2n/)' 2>/dev/null) |
		grep -v '{{' | grep -v '/Users/me/' || true)"
	[ -z "${hits}" ] || {
		echo "write \$HOME, \$DOTFILES_ROOT or a {{HOME}} placeholder instead:"
		echo "${hits}"
		false
	}
}

@test "portability: no machine's host name" {
	hits="$(scoped_files | (cd "${REPO_ROOT}" && xargs -0 grep -nIE 'esh2n-mac' 2>/dev/null) || true)"
	[ -z "${hits}" ] || {
		echo "${hits}"
		false
	}
}

@test "portability: the environment variables are documented in .env.example" {
	[ -f "${REPO_ROOT}/.env.example" ]
}

# verdict<TAB>path<TAB>target for every tracked link of the repository in $1:
# ok, absolute, home, escape (climbs above the root) or missing (indexed but
# gone from the work tree). Paths are split on the TAB of `ls-files -s -z`,
# never on spaces, so no name is dropped (the old scanner lost "bad link"
# and non-ASCII names).
scan_links() {
	python3 - "$1" <<'PY'
import os, posixpath, subprocess, sys
root = sys.argv[1]
out = subprocess.run(["git", "-C", root, "ls-files", "-s", "-z"], check=True, capture_output=True).stdout
for entry in out.split(b"\0"):
    if not entry.startswith(b"120000 "):
        continue
    rel = entry.split(b"\t", 1)[1].decode()
    path = os.path.join(root, rel)
    if not os.path.islink(path):
        print(f"missing\t{rel}\t")
        continue
    target = os.readlink(path)
    if target.startswith("/"):
        verdict = "absolute"
    elif target.startswith("~"):
        verdict = "home"
    else:
        norm = posixpath.normpath(posixpath.join(posixpath.dirname(rel), target))
        verdict = "escape" if norm == ".." or norm.startswith("../") else "ok"
    print(f"{verdict}\t{rel}\t{target}")
PY
}

@test "portability: every committed link is relative and stays inside the repository" {
	run scan_links "${REPO_ROOT}"
	[ "$status" -eq 0 ]
	bad="$(grep -v '^ok' <<<"$output" || true)"
	[ -z "${bad}" ] || {
		echo "${bad}"
		false
	}
}

@test "portability: the link scan sees every unsafe link, whatever its name" {
	fixture="${BATS_TEST_TMPDIR}/fixture"
	mkdir -p "${fixture}/sub"
	git -C "${fixture}" init -q
	touch "${fixture}/file"
	ln -s file "${fixture}/fine"
	ln -s /etc/hosts "${fixture}/bad link"
	ln -s '~/x' "${fixture}/méchant"
	ln -s ../../outside "${fixture}/sub/up"
	ln -s '*/../../x' "${fixture}/glob"
	git -C "${fixture}" add -A
	run scan_links "${fixture}"
	[ "$status" -eq 0 ]
	[[ "$output" == *$'ok\tfine\tfile'* ]]
	[[ "$output" == *$'absolute\tbad link\t/etc/hosts'* ]]
	[[ "$output" == *$'home\tméchant\t~/x'* ]]
	[[ "$output" == *$'escape\tsub/up\t../../outside'* ]]
	[[ "$output" == *$'escape\tglob\t*/../../x'* ]]
}

@test "portability: no tracked text file holds a NUL byte (git would treat it as binary)" {
	hits="$(cd "${REPO_ROOT}" && git ls-files -z | python3 -c '
import os, sys
exts = {".js", ".mjs", ".ts", ".sh", ".bash", ".bats", ".md", ".json", ".yaml", ".yml",
        ".toml", ".nix", ".html", ".css", ".txt", ".zsh", ".go", ".lua", ".kdl"}
for rel in sys.stdin.buffer.read().decode().split("\0"):
    if rel and os.path.splitext(rel)[1].lower() in exts and os.path.isfile(rel):
        with open(rel, "rb") as f:
            if b"\0" in f.read():
                print(rel)
')"
	[ -z "${hits}" ] || {
		echo "use a \\0 or \\u0000 escape instead:"
		echo "${hits}"
		false
	}
}
