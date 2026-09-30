import { describe, expect, test } from "bun:test";
import { runCommand } from "../../../src/infra/proc/exec-file";

describe("runCommand", () => {
  test("a variable named in unsetEnv is not inherited, the rest are", async () => {
    process.env.JIG_TEST_DROP = "dropped";
    process.env.JIG_TEST_KEEP = "kept";
    try {
      const result = await runCommand(
        "sh",
        ["-c", 'printf "%s|%s" "${JIG_TEST_DROP-unset}" "${JIG_TEST_KEEP-unset}"'],
        { cwd: process.cwd(), timeoutMs: 5_000, unsetEnv: ["JIG_TEST_DROP"] },
      );
      expect(result.stdout).toBe("unset|kept");
    } finally {
      // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
      delete process.env.JIG_TEST_DROP;
      // biome-ignore lint/performance/noDelete: as above
      delete process.env.JIG_TEST_KEEP;
    }
  });
});
