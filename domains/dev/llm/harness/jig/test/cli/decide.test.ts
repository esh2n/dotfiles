import { describe, expect, test } from "bun:test";
import { decide } from "../../src/cli/decide";
import { StaticProvider } from "../../src/infra/decision/static-provider";

describe("decide", () => {
  test("prints the judgment on stdout and exits 0", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.8 } });

    const result = await decide(
      JSON.stringify({
        op: "choice",
        query: { prompt: "which?", options: ["main", "complex"] },
      }),
      provider,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ op: "choice", value: "complex", confidence: 0.8 });
  });

  test("stdin that is not JSON makes no judgment and exits 1", async () => {
    const provider = new StaticProvider({});

    const result = await decide("decide this for me", provider);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/not JSON/);
  });

  test("a malformed request exits 1 with the reason, and prints no judgment", async () => {
    const result = await decide(JSON.stringify({ op: "guess", query: {} }), new StaticProvider({}));

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^bad-request: /);
  });

  test("a judgment that could not be made exits 1 with the reason, and prints no judgment", async () => {
    const result = await decide(
      JSON.stringify({ op: "bool", query: { prompt: "?" } }),
      new StaticProvider({}),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^provider-error: /);
  });
});
