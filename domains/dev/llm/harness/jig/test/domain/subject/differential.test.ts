/**
 * Differential tests for subject extraction: the strict reader's answer is
 * checked against two independent authorities.
 *
 *  1. bash itself. For a command the reader resolved, every program it
 *     named is shadowed by a shell function that records its argv, and the
 *     command is run under a bash with no PATH, globbing off and HOME set
 *     to a literal `~`. The recorded argv must equal what the reader
 *     produced. A resolved command contains no expansion by construction,
 *     so this comparison is exact — and it is the check that catches the
 *     parser-disagrees-with-the-shell class of bug Claude Code was reported
 *     for more than once.
 *
 *  2. tree-sitter-bash (wasm), the grammar most editors trust. Whenever the
 *     reader says "resolved", tree-sitter must see the same programs, the
 *     same literal arguments, no parse error and no expansion. This is the
 *     fallback parser named in the design; keeping it in the loop here is
 *     what makes swapping to it a known quantity.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Language, Parser, type Node as TsNode } from "web-tree-sitter";
import { DEFAULT_LIMITS, type ShellCommand, fromString } from "../../../src/domain/subject";

const LIMITS = { ...DEFAULT_LIMITS, maxMillis: 5_000 };

/**
 * Commands the strict reader must resolve, each without wrappers or
 * carriers so that both oracles can see the same programs directly.
 */
const RESOLVED_CORPUS: readonly string[] = [
  'grep "rm -rf" notes.md',
  "ls -la | wc -l && echo ok; git status",
  `printf '%s' "a b" c\\ d 'e"f'`,
  "git -C /tmp/repo push --force origin main",
  "echo '{}' > out.json",
  "rm -rf ~/x",
  'cat file.txt | grep -v "^#" | sort -u',
  `echo "double \\"quoted\\" and 'single'"`,
  `echo 'single with $notexpanded and "double"'`,
  `echo a"b"c'd'e`,
  `echo don\\'t`,
  "make -j4 CC=clang",
  'FOO=bar BAZ="q x" make',
  `git commit -m "fix: it's \\"done\\""`,
  "echo -- -n -e",
  `echo "" ''`,
  "ls -- -weird",
  "echo 'a\nb'",
  "echo x; echo y",
  "true && echo z",
  "! false",
  "git log --format='%H %s' -n 5",
  `find . -name "*.ts" -not -path "*/node_modules/*"`,
  `sed -e 's/a/b/g' -e "s/c/d/" file`,
  "awk '{ print $1 }' file",
  "echo a\\$b",
  `echo "a\\$b"`,
  "echo 'it''s'",
  'echo \\"quoted\\"',
  'echo "\\\\"',
  "echo '\\\\'",
  "echo back\\\\slash",
  "tr -d '\\n' < file",
  "echo x 2>&1 >/dev/null",
  "echo hello world",
  'echo 日本語 "空 白"',
  "git status &",
  "cat <<'EOF'\n$(not run)\nEOF",
  "cat <<EOF\nplain text\nEOF",
  "echo a  b\tc",
  "sleep 1 | true",
  'echo "quoted \\$HOME stays"',
  "echo '\\$HOME'",
  "rsync -avz --exclude='.git/' src/ dst/",
  `jq '.a | .b' file.json`,
  'echo "$"',
  "echo \\$",
];

/**
 * Where tree-sitter-bash is known to disagree with bash itself. These still
 * run against the bash oracle (which the reader must match); against
 * tree-sitter they are pinned as divergences so a grammar release that fixes
 * one shows up here instead of silently changing what the fallback would do.
 */
const TREE_SITTER_DIVERGES: readonly string[] = [
  // bash joins `a\<newline>b` into one word `ab`; tree-sitter-bash 0.25 yields two words.
  "echo a\\\nb",
];

// ---------------------------------------------------------------------------
// Oracle 1: bash
// ---------------------------------------------------------------------------

const RS = "\x1e";
const US = "\x1f";

/** Builtins that would act on the machine if a program were misread; disabled in the oracle. */
const RISKY_BUILTINS = [
  "kill",
  "cd",
  "pushd",
  "popd",
  "ulimit",
  "umask",
  "exec",
  "wait",
  "fg",
  "bg",
  "jobs",
  "disown",
  "suspend",
];

function shellFunctionName(program: string): string | undefined {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(program) ? program : undefined;
}

interface Recorded {
  readonly program: string;
  readonly argv: readonly string[];
}

function runOracle(command: string, programs: readonly string[]): readonly Recorded[] {
  const dir = mkdtempSync(join(tmpdir(), "jig-oracle-"));
  const out = join(dir, "argv.log");
  writeFileSync(out, "");
  // Input files the corpus redirects from, so bash does not abort before the program runs.
  for (const name of ["file", "file.txt", "file.json", "notes.md"])
    writeFileSync(join(dir, name), "");
  const preamble = [
    "set -f",
    `for b in ${RISKY_BUILTINS.join(" ")}; do enable -n "$b" 2>/dev/null; done`,
    `__rec() { local IFS='${US}'; builtin printf '%s${RS}' "$*" >> "$JIG_ORACLE_OUT"; }`,
    ...programs.map((p) => `${p}() { __rec ${p} "$@"; }`),
  ].join("\n");
  try {
    const result = Bun.spawnSync(["/bin/bash", "-c", `${preamble}\n${command}`], {
      cwd: dir,
      env: { PATH: "/nonexistent", HOME: "~", JIG_ORACLE_OUT: out, LC_ALL: "en_US.UTF-8" },
      stdin: "ignore",
    });
    if (result.exitCode !== 0 && result.stderr.length > 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      if (stderr.includes("command not found"))
        throw new Error(`oracle ran an unshadowed program: ${stderr.trim()}`);
    }
    const log = readFileSync(out, "utf8");
    return log
      .split(RS)
      .filter((line) => line !== "")
      .map((line) => {
        const [program = "", ...argv] = line.split(US);
        return { program, argv };
      });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sortedKeys(
  commands: readonly { program: string; argv: readonly string[] }[],
): readonly string[] {
  return commands.map((c) => JSON.stringify([c.program, c.argv])).sort();
}

describe("differential: strict reader vs bash", () => {
  for (const command of [...RESOLVED_CORPUS, ...TREE_SITTER_DIVERGES]) {
    test(JSON.stringify(command), () => {
      const x = fromString(command, LIMITS);
      expect(x.kind, `reader should resolve: ${JSON.stringify(x)}`).toBe("resolved");
      if (x.kind !== "resolved") return;
      const programs = [...new Set(x.commands.map((c) => c.program))];
      for (const p of programs)
        expect(
          shellFunctionName(p),
          `corpus programs must be function-nameable: ${p}`,
        ).toBeDefined();
      const recorded = runOracle(command, programs);
      expect(sortedKeys(recorded)).toEqual(sortedKeys(x.commands));
    });
  }
});

// ---------------------------------------------------------------------------
// Oracle 2: tree-sitter-bash
// ---------------------------------------------------------------------------

const WASM = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "node_modules",
  "tree-sitter-bash",
  "tree-sitter-bash.wasm",
);

async function treeSitterParser(): Promise<Parser> {
  await Parser.init();
  const language = await Language.load(WASM);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

const EXPANSION_TYPES = new Set([
  "command_substitution",
  "simple_expansion",
  "expansion",
  "process_substitution",
  "arithmetic_expansion",
  "brace_expression",
  "ansi_c_string",
]);
const COMPOUND_TYPES = new Set([
  "subshell",
  "if_statement",
  "for_statement",
  "c_style_for_statement",
  "while_statement",
  "case_statement",
  "function_definition",
  "compound_statement",
  "test_command",
  "arithmetic_command",
]);

interface TsReading {
  readonly commands: readonly Recorded[];
  readonly problems: readonly string[];
}

function unquote(node: TsNode, problems: string[]): string {
  switch (node.type) {
    case "word":
    case "number":
      return node.text.replace(/\\\n/g, "").replace(/\\(.)/gs, "$1");
    case "raw_string":
      return node.text.slice(1, -1);
    case "string": {
      let out = "";
      for (const child of node.children) {
        if (child.type === "string_content") out += child.text.replace(/\\([$`"\\\n])/g, "$1");
        else if (child.type === "$") out += "$";
        else if (child.type === '"') continue;
        else problems.push(`inside string: ${child.type}`);
      }
      return out;
    }
    case "concatenation":
      return node.namedChildren.map((c) => unquote(c, problems)).join("");
    default:
      if (EXPANSION_TYPES.has(node.type)) problems.push(node.type);
      else problems.push(`unhandled argument node ${node.type}`);
      return node.text;
  }
}

function readTree(root: TsNode): TsReading {
  const commands: Recorded[] = [];
  const problems: string[] = [];
  const visit = (node: TsNode): void => {
    if (node.type === "ERROR" || node.isMissing) problems.push("parse error");
    if (COMPOUND_TYPES.has(node.type)) problems.push(node.type);
    if (node.type === "command") {
      const name = node.childForFieldName("name");
      if (name === null) {
        problems.push("command without a name");
      } else {
        const program = unquote(name.namedChildren[0] ?? name, problems);
        const argv = node.children
          .filter((c) => node.childrenForFieldName("argument").some((a) => a.id === c.id))
          .map((c) => unquote(c, problems));
        commands.push({ program, argv });
      }
    }
    if (node.type === "heredoc_body") {
      for (const child of node.namedChildren)
        if (EXPANSION_TYPES.has(child.type)) problems.push(`heredoc ${child.type}`);
    }
    if (node.type === "file_redirect") {
      const dest = node.childForFieldName("destination");
      if (dest !== null && EXPANSION_TYPES.has(dest.type)) problems.push("redirect expansion");
    }
    for (const child of node.children)
      if (child.type !== "command" || node.type !== "command") visit(child);
  };
  visit(root);
  return { commands, problems };
}

describe("differential: strict reader vs tree-sitter-bash", () => {
  const parserPromise = treeSitterParser();

  for (const command of RESOLVED_CORPUS) {
    test(JSON.stringify(command), async () => {
      const parser = await parserPromise;
      const x = fromString(command, LIMITS);
      expect(x.kind).toBe("resolved");
      if (x.kind !== "resolved") return;
      const tree = parser.parse(command);
      expect(tree).not.toBeNull();
      if (tree === null) return;
      const reading = readTree(tree.rootNode);
      expect(reading.problems, "tree-sitter must agree the command is plain").toEqual([]);
      expect(sortedKeys(reading.commands)).toEqual(sortedKeys(x.commands));
    });
  }

  for (const command of TREE_SITTER_DIVERGES) {
    test(`known divergence ${JSON.stringify(command)}`, async () => {
      const parser = await parserPromise;
      const x = fromString(command, LIMITS);
      expect(x.kind).toBe("resolved");
      if (x.kind !== "resolved") return;
      const tree = parser.parse(command);
      if (tree === null) throw new Error("tree-sitter returned null");
      expect(sortedKeys(readTree(tree.rootNode).commands)).not.toEqual(sortedKeys(x.commands));
    });
  }

  /** Strings the reader refuses; tree-sitter must see the same reason, so the refusal is not the reader's whim. */
  const REFUSED: readonly [string, string][] = [
    ["echo $(rm -rf /)", "command_substitution"],
    ["ls $HOME/x", "simple_expansion"],
    ["ls ${HOME}", "expansion"],
    ["diff <(ls) x", "process_substitution"],
    ["echo $((1+2))", "arithmetic_expansion"],
    ["(cd /tmp && rm x)", "subshell"],
    ["for f in a b; do rm $f; done", "for_statement"],
    ["if true; then rm x; fi", "if_statement"],
    ["f() { rm x; }", "function_definition"],
    ["echo $'\\x72m'", "ansi_c_string"],
  ];
  for (const [command, expected] of REFUSED) {
    test(`both refuse ${JSON.stringify(command)}`, async () => {
      const parser = await parserPromise;
      expect(fromString(command, LIMITS).kind).not.toBe("resolved");
      const tree = parser.parse(command);
      if (tree === null) throw new Error("tree-sitter returned null");
      const reading = readTree(tree.rootNode);
      expect(reading.problems.join(" ")).toContain(expected);
    });
  }
});

/** Every resolved corpus entry also appears in the suspects — the lenient reader never sees less than the strict one. */
describe("differential: lenient ⊇ strict", () => {
  for (const command of RESOLVED_CORPUS) {
    test(JSON.stringify(command), () => {
      const x = fromString(command, LIMITS);
      if (x.kind !== "resolved") return;
      const suspects = new Set(
        x.suspects.map((c: ShellCommand) => JSON.stringify([c.program, c.argv])),
      );
      for (const c of x.commands)
        expect(suspects.has(JSON.stringify([c.program, c.argv])), JSON.stringify(c)).toBe(true);
    });
  }
});
