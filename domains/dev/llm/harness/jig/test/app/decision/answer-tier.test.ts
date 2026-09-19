import { describe, expect, test } from "bun:test";
import { answerTier } from "../../../src/app/decision/answer-tier";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

describe("answerTier", () => {
  test("a confident judgment picks the judged tier", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.81 } });

    const result = await answerTier({ request: "refactor the routing module" }, provider);

    expect(result).toEqual({
      ok: true,
      decision: { tier: "complex", confidence: 0.81, source: "decided" },
    });
  });

  test("a weak judgment falls back to main and says it was a fallback", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.51 } });

    const result = await answerTier({ request: "do the thing" }, provider);

    // 0.51 is inside the dead band (1 - 0.6 = 0.4 .. 0.6), so the safe side wins.
    expect(result).toEqual({
      ok: true,
      decision: { tier: "main", confidence: 0.51, source: "fallback" },
    });
  });

  test("the threshold is a caller decision, not a hardcoded one", async () => {
    const provider = new StaticProvider({ choice: { value: "complex", confidence: 0.51 } });

    const result = await answerTier({ request: "do the thing" }, provider, {
      options: { threshold: 0.5 },
    });

    expect(result).toEqual({
      ok: true,
      decision: { tier: "complex", confidence: 0.51, source: "decided" },
    });
  });

  test("an empty request is a bad-request, not a judgment", async () => {
    const result = await answerTier({ request: "   " }, new StaticProvider({}));

    expect(result).toEqual({
      ok: false,
      kind: "bad-request",
      message: expect.stringContaining("nothing to route"),
    });
  });

  test("a missing request field is a bad-request", async () => {
    const result = await answerTier({}, new StaticProvider({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("bad-request");
  });

  test("a provider failure is a provider-error", async () => {
    const result = await answerTier({ request: "hello" }, new StaticProvider({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("provider-error");
  });
});
