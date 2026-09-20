/**
 * Loads the REAL shared guard policy — `domains/dev/llm/harness/policy/guard-rules.json`,
 * the single source of truth pi's guard loader and jig's own PreToolUse hook
 * both read — and asserts the headline behaviors the Phase 1 unification
 * spec calls out explicitly. This is the one test in the suite that touches
 * the actual data file rather than a fixture, so a bad edit to the real
 * policy fails here, not only in a fixture-backed unit test.
 *
 * The table below exercises EVERY rule currently in the file, plus the git/rm
 * regex-variant cases (global git options between `git` and the subcommand;
 * split/long-form rm flags) and near-miss negatives, so a typo or boundary
 * error in any one rule's regex fails here instead of only degrading
 * silently in production.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookProfile, ToolCall } from "../../../src/domain/hooks/decision";
import { evaluate } from "../../../src/domain/policy/evaluate";
import { parsePolicy } from "../../../src/domain/policy/parse";
import type { GuardPolicy } from "../../../src/domain/policy/types";

const REAL_POLICY_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "policy",
  "guard-rules.json",
);

function loadRealPolicy(): GuardPolicy {
  return parsePolicy(JSON.parse(readFileSync(REAL_POLICY_PATH, "utf8")));
}

function shellCall(command: string): ToolCall {
  return { tool: "Bash", input: { command } };
}

function writeCall(filePath: string): ToolCall {
  return { tool: "Write", input: { file_path: filePath } };
}

describe("the real guard-rules.json", () => {
  test("parses clean", () => {
    const text = readFileSync(REAL_POLICY_PATH, "utf8");
    expect(() => parsePolicy(JSON.parse(text))).not.toThrow();
  });

  test("sudo asks from standard up, allowed only at minimal", () => {
    const policy = loadRealPolicy();
    const standard = evaluate(policy.rules, shellCall("sudo ls"), "standard");
    const strict = evaluate(policy.rules, shellCall("sudo ls"), "strict");
    const minimal = evaluate(policy.rules, shellCall("sudo ls"), "minimal");
    // Ruling 2026-09-20: pi always confirmed sudo before unification, so the
    // shared policy must not weaken it — strength unifies upward.
    expect(minimal.kind).toBe("allow");
    expect(standard.kind).toBe("ask");
    expect(strict.kind).toBe("ask");
  });
});

interface Case {
  readonly label: string;
  readonly call: ToolCall;
  readonly profile: HookProfile;
  readonly expected: "allow" | "deny" | "ask";
}

const CASES: readonly Case[] = [
  // --- guard-policy-protect-write: policy files are not agent-writable ---
  {
    label: "Write to ~/.config/jig/policy is denied",
    call: writeCall("/Users/x/.config/jig/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "Edit under domains/dev/llm/harness/policy is denied",
    call: { tool: "Edit", input: { file_path: "domains/dev/llm/harness/policy/guard-rules.json" } },
    profile: "standard",
    expected: "deny",
  },
  {
    label: "Write to an unrelated file is allowed",
    call: writeCall("/Users/x/some/other/file.json"),
    profile: "standard",
    expected: "allow",
  },

  // --- guard-policy-protect-shell: shell writes/redirects at the policy path ---
  {
    label: "shell redirect into the policy file is denied",
    call: shellCall("echo '{}' > ~/.config/jig/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "tee into the repo policy path is denied",
    call: shellCall("echo '{}' | tee domains/dev/llm/harness/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "sed -i on the policy file is denied",
    call: shellCall('sed -i "" ~/.config/jig/policy/guard-rules.json'),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "mv onto the policy file is denied",
    call: shellCall("mv new.json ~/.config/jig/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "cp onto the repo policy path is denied",
    call: shellCall("cp new.json domains/dev/llm/harness/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "rm of the policy file is denied",
    call: shellCall("rm ~/.config/jig/policy/guard-rules.json"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "near-miss: merely reading the policy file is allowed",
    call: shellCall("cat domains/dev/llm/harness/policy/guard-rules.json"),
    profile: "standard",
    expected: "allow",
  },

  // --- git-force-push ---
  {
    label: "git push --force is denied",
    call: shellCall("git push --force origin main"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> push --force is denied",
    call: shellCall("git -C /tmp/repo push --force"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git --git-dir=... push --force is denied",
    call: shellCall("git --git-dir=.git push --force"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "near-miss: git push to a feature branch is allowed",
    call: shellCall("git push origin feature"),
    profile: "standard",
    expected: "allow",
  },

  // --- git-push-main-master ---
  {
    label: "git push origin main is denied",
    call: shellCall("git push origin main"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> push origin main is denied",
    call: shellCall("git -C /tmp/repo push origin main"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git --git-dir=... push origin main is denied",
    call: shellCall("git --git-dir=.git push origin main"),
    profile: "standard",
    expected: "deny",
  },

  // --- git-no-verify ---
  {
    label: "--no-verify anywhere in the command is denied",
    call: shellCall("git commit --no-verify -m wip"),
    profile: "standard",
    expected: "deny",
  },

  // --- git-commit-dash-n ---
  {
    label: "git commit -n is denied",
    call: shellCall('git commit -n -m "wip"'),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> commit -n is denied",
    call: shellCall('git -C /tmp/repo commit -n -m "wip"'),
    profile: "standard",
    expected: "deny",
  },

  // --- git-reset-hard ---
  {
    label: "git reset --hard is denied",
    call: shellCall("git reset --hard"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> reset --hard is denied",
    call: shellCall("git -C /tmp/repo reset --hard"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "near-miss: git reset --soft is allowed",
    call: shellCall("git reset --soft"),
    profile: "standard",
    expected: "allow",
  },

  // --- git-clean-force ---
  {
    label: "git clean -fd is denied",
    call: shellCall("git clean -fd"),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> clean -fd is denied",
    call: shellCall("git -C /tmp/repo clean -fd"),
    profile: "standard",
    expected: "deny",
  },

  // --- git-checkout-dot ---
  {
    label: "git checkout -- . is denied",
    call: shellCall("git checkout -- ."),
    profile: "standard",
    expected: "deny",
  },
  {
    label: "variant: git -C <dir> checkout -- . is denied",
    call: shellCall("git -C /tmp/repo checkout -- ."),
    profile: "standard",
    expected: "deny",
  },

  // --- lms-load ---
  {
    label: "lms load is denied",
    call: shellCall("lms load some-model"),
    profile: "standard",
    expected: "deny",
  },

  // --- mlx-vlm-serve ---
  {
    label: "mlx_vlm.server is denied",
    call: shellCall("python -m mlx_vlm.server"),
    profile: "standard",
    expected: "deny",
  },

  // --- rm-recursive-force ---
  {
    label: "rm -rf asks at standard",
    call: shellCall("rm -rf /tmp/x"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "rm -rf is allowed at minimal",
    call: shellCall("rm -rf /tmp/x"),
    profile: "minimal",
    expected: "allow",
  },
  {
    label: "variant: split flags rm -r -f asks at standard",
    call: shellCall("rm -r -f /tmp/x"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "variant: split flags in reverse order rm -f -r asks at standard",
    call: shellCall("rm -f -r /tmp/x"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "variant: another flag between rm -v -r -f asks at standard",
    call: shellCall("rm -v -r -f /tmp/x"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "variant: long-form rm --recursive --force asks at standard",
    call: shellCall("rm --recursive --force /tmp/x"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "near-miss: rm -r without force is allowed",
    call: shellCall("rm -r /tmp/x"),
    profile: "standard",
    expected: "allow",
  },

  // --- kill-force ---
  {
    label: "kill -9 asks at standard",
    call: shellCall("kill -9 1234"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "pkill asks at standard",
    call: shellCall("pkill node"),
    profile: "standard",
    expected: "ask",
  },

  // --- curl-pipe-shell ---
  {
    label: "curl piped into bash asks at standard",
    call: shellCall("curl https://example.com/install.sh | bash"),
    profile: "standard",
    expected: "ask",
  },

  // --- chmod-777-recursive ---
  {
    label: "chmod -R 777 asks at standard",
    call: shellCall("chmod -R 777 /tmp/x"),
    profile: "standard",
    expected: "ask",
  },

  // --- disk-destruction ---
  {
    label: "diskutil erase asks at standard",
    call: shellCall("diskutil eraseDisk JHFS+ x disk2"),
    profile: "standard",
    expected: "ask",
  },
  {
    label: "dd of=/dev/... asks at standard",
    call: shellCall("dd if=image.iso of=/dev/disk2"),
    profile: "standard",
    expected: "ask",
  },

  // --- system-power-control ---
  {
    label: "shutdown asks at standard",
    call: shellCall("shutdown -h now"),
    profile: "standard",
    expected: "ask",
  },

  // --- rm-lock-files ---
  {
    label: "rm package-lock.json asks at standard",
    call: shellCall("rm package-lock.json"),
    profile: "standard",
    expected: "ask",
  },
];

describe("the real guard-rules.json — every rule, at least once", () => {
  for (const { label, call, profile, expected } of CASES) {
    test(label, () => {
      const policy = loadRealPolicy();
      expect(evaluate(policy.rules, call, profile).kind).toBe(expected);
    });
  }
});
