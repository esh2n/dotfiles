/**
 * The default `permissions.allow` entries, per
 * `rules/decisions/2026-09-22-allow-from-guard-permit.md`:
 *
 *   「既定の permit として最初から入れる三種: `git commit`、`git push`
 *    (feature ブランチ。main への push は forbid のまま)、テストの実行
 *    (`npm test`、`go test`、`pytest`、`bun test`)。分類器のサービス停止時に
 *    作業が止まらないための保険。」
 *
 * The decision says the source is `policy/guard-rules.json`'s `permit` rules,
 * and that file has none yet. It cannot get them from inside a session: its
 * own floor rules (`floor-policy-write`, `floor-policy-edit`) forbid every
 * agent from writing it — "change it by hand, outside a session".
 *
 * So this module is a **fallback, not a second source of truth**. Each entry
 * carries both the projected Claude rule and the exact `permit` object to
 * paste into `policy/guard-rules.json`, which `jig apply --target claude`
 * prints in its dry-run. Once an id below exists in the policy file, the
 * projection produces the identical string and the set union in
 * `app/apply/apply-claude.ts` collapses the two into one entry — so pasting
 * changes nothing in the output, which is exactly the property that makes the
 * fallback safe to keep. `test/domain/claude/permits.test.ts` pins it by
 * running the fragment through the real parser and the real projection.
 *
 * Deliberately narrow. The decision's other half is「広い形(`Bash(*)`、
 * インタプリタ丸ごと、パッケージマネージャの run)は書かない」— nothing here
 * may grow into one.
 *
 * `rules/decisions/2026-09-23-hooks-carry-formatters-only-stylelint-added.md`
 * adds the static checks that ruling keeps OUT of the hooks: staticcheck,
 * cargo clippy, stylelint, html-validate (`go test` was already here). They
 * are permits so the model can run them when `rules/common` tells it to
 * before claiming completion — the same fragment, the same paste.
 */

/** A `rules[]` entry of `policy/guard-rules.json`, as JSON. */
export interface PolicyPermitRule {
  readonly id: string;
  readonly effect: "permit";
  readonly action: "shell.exec";
  readonly subject: { readonly program: string; readonly argv?: string };
  readonly why: string;
  readonly profiles: readonly string[];
}

export interface DefaultPermit {
  /** A Claude Code permission rule, same shape `to-claude-permissions.ts` emits. */
  readonly rule: string;
  /** One line, shown in the dry-run so the reader sees why it is not "broad". */
  readonly why: string;
  /** The policy rule that, once pasted by hand, produces `rule` by projection. */
  readonly policyRule: PolicyPermitRule;
}

const ALL_PROFILES = ["minimal", "standard", "strict"] as const;

/** `<program> test`, or the bare program when the test runner is its own binary. */
function testRunner(id: string, program: string, subcommand: boolean): DefaultPermit {
  return {
    rule: `Bash(${subcommand ? `${program} test` : program} *)`,
    why: "test runner",
    policyRule: {
      id,
      effect: "permit",
      action: "shell.exec",
      subject: subcommand ? { program, argv: "^test\\b" } : { program },
      why: "running the tests is ordinary work; it must not wait on the classifier",
      profiles: [...ALL_PROFILES],
    },
  };
}

const STATIC_CHECKS_RULING = "2026-09-23-hooks-carry-formatters-only-stylelint-added";

/**
 * A static check the hooks never run: `<program> <subcommand>`, or the bare
 * program when the checker is its own binary.
 */
function staticCheck(
  id: string,
  program: string,
  subcommand: string | undefined,
  language: string,
): DefaultPermit {
  const command = subcommand === undefined ? program : `${program} ${subcommand}`;
  return {
    rule: `Bash(${command} *)`,
    why: `${language} static check, run by the model before claiming completion, never by a hook`,
    policyRule: {
      id,
      effect: "permit",
      action: "shell.exec",
      subject: subcommand === undefined ? { program } : { program, argv: `^${subcommand}\\b` },
      why: `${STATIC_CHECKS_RULING}: ${command} is not wired into hooks; the model runs it before claiming completion`,
      profiles: [...ALL_PROFILES],
    },
  };
}

export const DEFAULT_PERMITS: readonly DefaultPermit[] = [
  {
    rule: "Bash(git commit *)",
    why: "insurance against a judgment-service outage stopping ordinary work",
    policyRule: {
      id: "permit-git-commit",
      effect: "permit",
      action: "shell.exec",
      subject: { program: "git", argv: "^commit\\b" },
      why: "committing is ordinary work; the destructive git shapes stay forbidden by their own rules",
      profiles: [...ALL_PROFILES],
    },
  },
  {
    rule: "Bash(git push *)",
    why:
      "feature branches only in effect: pushing to main stays forbidden by the " +
      "hook-only rule git-push-main-master, which a native allow cannot loosen " +
      "(a PreToolUse deny is honoured in every permission mode)",
    policyRule: {
      id: "permit-git-push",
      effect: "permit",
      action: "shell.exec",
      subject: { program: "git", argv: "^push\\b" },
      why: "pushing a feature branch is ordinary work; git-push-main-master and git-force-push still forbid the rest",
      profiles: [...ALL_PROFILES],
    },
  },
  testRunner("permit-npm-test", "npm", true),
  testRunner("permit-go-test", "go", true),
  testRunner("permit-pytest", "pytest", false),
  testRunner("permit-bun-test", "bun", true),
  staticCheck("permit-staticcheck", "staticcheck", undefined, "Go"),
  staticCheck("permit-cargo-clippy", "cargo", "clippy", "Rust"),
  staticCheck("permit-stylelint", "stylelint", undefined, "CSS"),
  staticCheck("permit-html-validate", "html-validate", undefined, "HTML"),
];

/**
 * The fragment to paste into `policy/guard-rules.json`'s `rules` array,
 * pretty-printed the way that file is written. The dry-run prints it because
 * the generator is not allowed to write the policy itself.
 */
export function defaultPermitPolicyFragment(): string {
  return JSON.stringify(
    DEFAULT_PERMITS.map((permit) => permit.policyRule),
    null,
    2,
  );
}
