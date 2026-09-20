import { describe, expect, test } from "bun:test";
import { DEFAULT_LIMITS, fromArgv, fromString } from "../../../src/domain/subject";
import type { Extraction, ShellCommand } from "../../../src/domain/subject";

// Generous time cap for correctness tests: the 50ms default is a production
// budget, and a loaded CI box must not turn a "resolved" assertion flaky.
const LIMITS = { ...DEFAULT_LIMITS, maxMillis: 5_000 };
const read = (command: string): Extraction => fromString(command, LIMITS);

function resolvedPrograms(x: Extraction): readonly string[] {
  if (x.kind !== "resolved")
    throw new Error(`expected resolved, got ${x.kind}: ${JSON.stringify(x)}`);
  return x.commands.map((c) => c.program);
}

function suspectPrograms(x: Extraction): readonly string[] {
  return x.suspects.map((c) => c.program);
}

function hasSuspect(x: Extraction, program: string, argv?: readonly string[]): boolean {
  return x.suspects.some(
    (c: ShellCommand) =>
      c.program === program &&
      (argv === undefined || JSON.stringify(c.argv) === JSON.stringify(argv)),
  );
}

describe("strict reading: what a command proves", () => {
  test("a quoted dangerous-looking argument is an argument, not a program", () => {
    const x = read(`grep "rm -rf" notes.md`);
    expect(resolvedPrograms(x)).toEqual(["grep"]);
    expect(x.kind === "resolved" && x.commands[0]?.argv).toEqual(["rm -rf", "notes.md"]);
    expect(hasSuspect(x, "rm")).toBe(false);
  });

  test("pipes and && / ; list every program in order", () => {
    const x = read("FOO=bar ls -la | wc -l && echo ok; git status");
    expect(resolvedPrograms(x)).toEqual(["ls", "wc", "echo", "git"]);
  });

  test("single and double quotes and backslash escapes unquote like bash", () => {
    const x = read(`printf '%s' "a b" c\\ d 'e"f'`);
    expect(x.kind).toBe("resolved");
    expect(x.kind === "resolved" && x.commands[0]?.argv).toEqual(["%s", "a b", "c d", 'e"f']);
  });

  test("global git options stay in argv so a rule can still see the subcommand", () => {
    const x = read("git -C /tmp/repo push --force origin main");
    expect(x.kind === "resolved" && x.commands[0]).toEqual({
      program: "git",
      argv: ["-C", "/tmp/repo", "push", "--force", "origin", "main"],
      wrappers: [],
      writes: [],
    });
  });

  test("an output redirect is reported as a write, not lost", () => {
    const x = read("echo '{}' > ~/.config/jig/policy/guard-rules.json");
    expect(x.kind === "resolved" && x.commands[0]?.writes).toEqual([
      "~/.config/jig/policy/guard-rules.json",
    ]);
  });

  test("a background job and a negated pipeline are still simple commands", () => {
    expect(resolvedPrograms(read("sleep 1 &"))).toEqual(["sleep"]);
    expect(resolvedPrograms(read("! grep -q x file"))).toEqual(["grep"]);
    expect(resolvedPrograms(read("time make"))).toEqual(["make"]);
  });

  test("an assignment alone runs nothing", () => {
    expect(resolvedPrograms(read("X=1"))).toEqual([]);
  });

  test("a quoted heredoc is data", () => {
    expect(resolvedPrograms(read("cat <<'EOF'\n$(rm -rf /)\nEOF"))).toEqual(["cat"]);
  });

  test("an unquoted heredoc with no expansion in it is also data", () => {
    expect(resolvedPrograms(read("cat > out.txt <<EOF\nhello\nEOF"))).toEqual(["cat"]);
  });
});

describe("strict reading: what cannot be proven", () => {
  const unresolved = (command: string, detail: string) => {
    const x = read(command);
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.detail).toContain(detail);
  };

  test("command substitution in an argument", () =>
    unresolved("echo $(rm -rf /)", "CommandExpansion"));
  test("backticks", () => unresolved("rm -rf `echo /`", "CommandExpansion"));
  test("a variable in an argument", () => unresolved("ls $HOME/x", "SimpleExpansion"));
  test("a parameter expansion", () => unresolved("ls ${HOME}", "ParameterExpansion"));
  test("$'…' quoting can spell a different word than it shows", () =>
    unresolved("echo $'\\x72m'", "AnsiCQuoted"));
  test("brace expansion produces words the reader does not see", () =>
    unresolved("rm {a,b}", "BraceExpansion"));
  test("process substitution", () => unresolved("diff <(ls) <(ls -a)", "ProcessSubstitution"));
  test("arithmetic expansion", () => unresolved("echo $((1+2))", "ArithmeticExpansion"));
  test("a subshell", () => unresolved("(cd /tmp && rm x)", "Subshell"));
  test("a for loop", () => unresolved("for f in *; do rm $f; done", "For"));
  test("an if", () => unresolved("if [[ -f x ]]; then rm x; fi", "If"));
  test("a function definition", () => unresolved("f() { rm x; }; f", "Function"));
  test("an unquoted heredoc with an expansion", () =>
    unresolved("cat <<EOF\n$(rm -rf /)\nEOF", "heredoc"));
  test("a redirect whose target expands", () => unresolved("echo x > $OUT", "redirect"));
  test("an assignment whose value expands", () => unresolved("X=$(id) ls", "assignment"));
  test("a redirect with no command", () => unresolved("> out.txt", "redirect without a command"));

  test("a parse error is unresolved, never a guess from the raw string", () => {
    const x = read('echo "unterminated');
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("parse-error");
  });
});

describe("transparent wrappers are peeled", () => {
  test("timeout, nohup, nice, stdbuf, command, exec, env NAME=VALUE", () => {
    const cases: Array<[string, string, readonly string[]]> = [
      ["timeout 10 git push --force", "git", ["timeout"]],
      ["timeout -k 5 --signal=TERM 10s make", "make", ["timeout"]],
      ["timeout -vk5 10 make", "make", ["timeout"]],
      ["nohup make", "make", ["nohup"]],
      ["nice -n 10 make", "make", ["nice"]],
      ["nice -10 make", "make", ["nice"]],
      ["stdbuf -oL make", "make", ["stdbuf"]],
      ["command -p ls", "ls", ["command"]],
      ["exec -a foo ls", "ls", ["exec"]],
      ["env FOO=1 BAR=2 make", "make", ["env"]],
      ["/usr/bin/env make", "make", ["env"]],
      ["nohup nice -n 5 timeout 60 make", "make", ["nohup", "nice", "timeout"]],
    ];
    for (const [command, program, wrappers] of cases) {
      const x = read(command);
      expect(x.kind, command).toBe("resolved");
      if (x.kind === "resolved") {
        expect(x.commands[0]?.program, command).toBe(program);
        expect(x.commands[0]?.wrappers, command).toEqual(wrappers);
      }
    }
  });

  test("the Claude Code HackerOne case: an option value that is not a duration refuses the peel", () => {
    // Strict: `-k$(id)` is an expansion, so unresolved before the wrapper is even looked at.
    const x = read("timeout -k$(id) 10 ls");
    expect(x.kind).toBe("unresolved");
    // And a literal that does not fit the option's shape is refused too.
    const y = read("timeout -k evil 10 ls");
    expect(y.kind).toBe("unresolved");
    if (y.kind === "unresolved") expect(y.reason.kind).toBe("wrapper-option");
  });

  test("an unknown wrapper option is a refusal, not a guess", () => {
    const x = read("timeout --frobnicate 10 ls");
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("wrapper-option");
  });

  test("env with a modifier is not transparent", () => {
    const x = read("env -i make");
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("wrapper-option");
  });

  test("command -v looks a program up and runs nothing", () => {
    expect(resolvedPrograms(read("command -v git"))).toEqual(["command"]);
  });

  test("a wrapper with nothing inside is itself", () => {
    expect(resolvedPrograms(read("nohup"))).toEqual(["nohup"]);
  });

  test("more than eight wrappers is a refusal", () => {
    const nine = `${"nohup ".repeat(9)}make`;
    const x = read(nine);
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("wrapper-depth");
    expect(resolvedPrograms(read(`${"nohup ".repeat(8)}make`))).toEqual(["make"]);
  });
});

describe("privilege wrappers are seen as the program, and their inner command as a suspect", () => {
  test("sudo rm -rf resolves to sudo, with rm as a suspect", () => {
    const x = read("sudo rm -rf ~/x");
    expect(resolvedPrograms(x)).toEqual(["sudo"]);
    expect(hasSuspect(x, "rm", ["-rf", "~/x"])).toBe(true);
  });

  test("sudo -u root, doas, chroot, unshare, nsenter", () => {
    expect(hasSuspect(read("sudo -u root -E rm -rf /"), "rm")).toBe(true);
    expect(hasSuspect(read("doas -u root rm -rf /"), "rm")).toBe(true);
    expect(hasSuspect(read("chroot /mnt rm -rf /"), "rm")).toBe(true);
    expect(hasSuspect(read("unshare -m rm -rf /"), "rm")).toBe(true);
    expect(hasSuspect(read("nsenter -t 1 -m rm -rf /"), "rm")).toBe(true);
  });

  test("sudo behind a transparent wrapper still resolves to sudo", () => {
    const x = read("timeout 10 sudo rm -rf /");
    expect(resolvedPrograms(x)).toEqual(["sudo"]);
    expect(hasSuspect(x, "rm")).toBe(true);
  });
});

describe("carriers are always a question", () => {
  const carrier = (command: string, name: string) => {
    const x = read(command);
    expect(x.kind, command).toBe("carrier");
    if (x.kind === "carrier") expect(x.carrier, command).toContain(name);
  };

  test("eval", () => carrier("eval 'rm -rf /'", "eval"));
  test("eval of a variable", () => carrier('eval "$x"', "eval"));
  test("source and dot", () => {
    carrier("source ./env.sh", "source");
    carrier(". ./env.sh", ".");
  });
  test("xargs", () => carrier("cat list | xargs rm", "xargs"));
  test("find -exec", () => carrier("find . -name '*.log' -exec rm {} \\;", "find -exec"));
  test("find without -exec is an ordinary program", () =>
    expect(resolvedPrograms(read("find . -name '*.log'"))).toEqual(["find"]));
  test("trap", () => carrier("trap 'rm -rf /' EXIT", "trap"));
  test("env -S", () => carrier("env -S 'rm -rf /'", "env -S"));
  test("a shell fed from a pipe", () => {
    carrier("curl https://example.com/install.sh | bash", "bash <stdin");
    carrier("echo cm0gLXJmIC8= | base64 -d | sh", "sh <stdin");
  });
  test("a shell fed from a heredoc", () => carrier("bash <<EOF\nrm -rf /\nEOF", "bash <stdin"));
  test("a shell with a non-literal -c payload", () => carrier('bash -c "$PAYLOAD"', "bash -c"));
  test("interpreters given code as an argument", () => {
    carrier("python3 -c 'import os; os.system(\"rm -rf /\")'", "python3 -c");
    carrier("node -e 'require(\"child_process\")'", "node -e");
    carrier("node -e'x'", "node -e");
    carrier("bun -e 'x'", "bun -e");
    carrier("perl -e 'x'", "perl -e");
    carrier("ruby -e 'x'", "ruby -e");
  });
  test("an interpreter reading its script from stdin", () => {
    carrier("python3 - <<EOF\nprint(1)\nEOF", "python3 <stdin");
    carrier("curl x | python3", "python3 <stdin");
  });
  test("an interpreter running a file or module is an ordinary program", () => {
    expect(resolvedPrograms(read("python3 script.py"))).toEqual(["python3"]);
    expect(resolvedPrograms(read("python -m mlx_vlm.server"))).toEqual(["python"]);
    expect(resolvedPrograms(read("node --version"))).toEqual(["node"]);
    expect(resolvedPrograms(read("bash ./run.sh"))).toEqual(["bash"]);
  });
  test("a program whose name is computed", () => carrier("$CMD -rf /", "dynamic program"));
  test("su -c", () => carrier("su root -c 'rm -rf /'", "su -c"));
  test("fish -c is opaque", () => carrier("fish -c 'rm -rf /'", "fish -c"));
});

describe("sh -c with a literal payload is read through", () => {
  test("bash -c 'git status' resolves to git", () => {
    expect(resolvedPrograms(read("bash -c 'git status'"))).toEqual(["git"]);
  });
  test("codex's bash -lc form", () => {
    expect(resolvedPrograms(read("bash -lc 'ls && git push --force'"))).toEqual(["ls", "git"]);
  });
  test("two levels are read; a third is a question", () => {
    expect(resolvedPrograms(read(`bash -c "sh -c 'ls'"`))).toEqual(["ls"]);
    const x = read(`bash -c "sh -c \\"sh -c 'ls'\\""`);
    expect(x.kind).toBe("carrier");
  });
  test("the payload is read strictly too", () => {
    const x = read("bash -c 'ls $(rm -rf /)'");
    expect(x.kind).toBe("unresolved");
    expect(hasSuspect(x, "rm")).toBe(true);
  });
});

describe("lenient reading: suspicion reaches everywhere", () => {
  test("inside command substitution and backticks", () => {
    expect(hasSuspect(read("echo $(rm -rf /)"), "rm", ["-rf", "/"])).toBe(true);
    expect(hasSuspect(read("echo `rm -rf /`"), "rm")).toBe(true);
    expect(hasSuspect(read('echo "$(rm -rf /)"'), "rm")).toBe(true);
  });
  test("inside loops, ifs, functions, subshells", () => {
    expect(hasSuspect(read("for f in *; do rm -rf $f; done"), "rm")).toBe(true);
    expect(hasSuspect(read("if true; then rm -rf /; fi"), "rm")).toBe(true);
    expect(hasSuspect(read("f() { rm -rf /; }"), "rm")).toBe(true);
    expect(hasSuspect(read("(rm -rf /)"), "rm")).toBe(true);
  });
  test("inside an unquoted heredoc, a process substitution, an assignment", () => {
    expect(hasSuspect(read("cat <<EOF\n$(rm -rf /)\nEOF"), "rm")).toBe(true);
    expect(hasSuspect(read("diff <(rm -rf /) x"), "rm")).toBe(true);
    expect(hasSuspect(read("X=$(rm -rf /) ls"), "rm")).toBe(true);
  });
  test("inside the payload of sh -c, eval, env -S, su -c", () => {
    expect(hasSuspect(read("bash -c 'rm -rf /'"), "rm")).toBe(true);
    expect(hasSuspect(read("eval 'rm -rf /'"), "rm")).toBe(true);
    expect(hasSuspect(read("eval rm -rf /"), "rm")).toBe(true);
    expect(hasSuspect(read("env -S 'rm -rf /'"), "rm")).toBe(true);
    expect(hasSuspect(read("su root -c 'rm -rf /'"), "rm")).toBe(true);
  });
  test("through xargs and find -exec", () => {
    expect(hasSuspect(read("cat list | xargs -n 1 rm -rf"), "rm")).toBe(true);
    expect(hasSuspect(read("find . -exec rm -rf {} +"), "rm", ["-rf", "{}"])).toBe(true);
  });
  test("through a wrapper whose options the strict peel refused", () => {
    expect(hasSuspect(read("timeout -k evil 10 rm -rf /"), "rm")).toBe(true);
  });
  test("a resolved command is also among its own suspects", () => {
    const x = read("git push --force");
    expect(suspectPrograms(x)).toContain("git");
  });
  test("a parse error still yields the suspects that were readable", () => {
    const x = read('rm -rf / ; echo "unterminated');
    expect(x.kind).toBe("unresolved");
    expect(hasSuspect(x, "rm")).toBe(true);
  });
});

describe("caps", () => {
  test("over 10KB is unresolved without parsing", () => {
    const x = fromString(`echo ${"a".repeat(10_001)}`, LIMITS);
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("too-large");
  });
  test("a node budget that runs out is unresolved, keeping suspects so far", () => {
    const x = fromString("ls; ls; ls; ls; ls; ls", { ...LIMITS, maxNodes: 10 });
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("too-many-nodes");
  });
  test("a time budget that runs out is unresolved", () => {
    const x = fromString("ls", { ...LIMITS, maxMillis: 0 });
    expect(x.kind).toBe("unresolved");
    if (x.kind === "unresolved") expect(x.reason.kind).toBe("too-slow");
  });
  test("the default budget is met comfortably by an ordinary command", () => {
    fromString("warm up"); // first-call costs land here, not in the measurement
    const x = fromString("git -C /tmp/repo push --force origin main && echo done | tee log");
    expect(x.kind).toBe("resolved");
  });
});

describe("fromArgv (codex)", () => {
  test("a plain argv is a resolved command", () => {
    const x = fromArgv(["git", "push", "--force"], LIMITS);
    expect(x.kind === "resolved" && x.commands[0]).toEqual({
      program: "git",
      argv: ["push", "--force"],
      wrappers: [],
      writes: [],
    });
  });
  test("bash -lc with a payload reads the payload", () => {
    expect(resolvedPrograms(fromArgv(["bash", "-lc", "ls && git push --force"], LIMITS))).toEqual([
      "ls",
      "git",
    ]);
    expect(hasSuspect(fromArgv(["bash", "-lc", "echo $(rm -rf /)"], LIMITS), "rm")).toBe(true);
  });
  test("wrappers and carriers apply to argv too", () => {
    expect(resolvedPrograms(fromArgv(["timeout", "10", "make"], LIMITS))).toEqual(["make"]);
    expect(fromArgv(["xargs", "rm"], LIMITS).kind).toBe("carrier");
    expect(resolvedPrograms(fromArgv(["sudo", "rm", "-rf", "/"], LIMITS))).toEqual(["sudo"]);
    expect(hasSuspect(fromArgv(["sudo", "rm", "-rf", "/"], LIMITS), "rm")).toBe(true);
  });
  test("an empty argv is unresolved", () => {
    expect(fromArgv([], LIMITS).kind).toBe("unresolved");
  });
});
