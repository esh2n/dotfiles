import { describe, expect, test } from "bun:test";
import { tier } from "../../src/cli/tier";
import { StaticProvider } from "../../src/infra/decision/static-provider";

describe("tier", () => {
  test("prints the tier decision for the request on stdin", async () => {
    const provider = new StaticProvider({ choice: { value: "deterministic", confidence: 0.9 } });

    const result = await tier("rename the variable everywhere\n", provider);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      tier: "deterministic",
      confidence: 0.9,
      source: "decided",
      chosen: "deterministic",
    });
  });

  test("empty stdin makes no judgment and exits 1", async () => {
    const result = await tier("   \n", new StaticProvider({}));

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^bad-request: /);
  });

  test("a judgment that could not be made exits 1 with the reason", async () => {
    const result = await tier("hello", new StaticProvider({}));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^provider-error: /);
  });
});
