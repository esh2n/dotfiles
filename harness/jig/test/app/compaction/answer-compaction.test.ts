import { describe, expect, test } from "bun:test";
import { answerCompaction } from "../../../src/app/compaction/answer-compaction";
import { StaticProvider } from "../../../src/infra/decision/static-provider";

// Five items, so the default `preserveRecent: 2` pins the first and the last two
// and leaves b and c to be judged. With three items nothing would be asked.
const items = ["a", "b", "c", "d", "e"].map((id) => ({ id, summary: `item ${id}` }));

describe("answerCompaction", () => {
  test("judges the middle items and pins the first and the last two", async () => {
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.9 },
        { value: false, confidence: 0.95 },
      ],
    });

    const result = await answerCompaction({ items }, provider);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // b is reproducible (dropped), c is not (kept), a/d/e are pinned.
    expect(result.result.kept.map((item) => item.id)).toEqual(["a", "c", "d", "e"]);
    expect(result.result.decisions).toEqual([
      { id: "a", kept: true, confidence: 1, source: "pinned" },
      { id: "b", kept: false, confidence: 0.9, source: "decided" },
      { id: "c", kept: true, confidence: 0.95, source: "decided" },
      { id: "d", kept: true, confidence: 1, source: "pinned" },
      { id: "e", kept: true, confidence: 1, source: "pinned" },
    ]);
  });

  test("a weakly answered item is kept, because the safe side is keeping", async () => {
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.55 },
        { value: false, confidence: 0.9 },
      ],
    });

    const result = await answerCompaction({ items }, provider);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.decisions[1]).toEqual({
      id: "b",
      kept: true,
      confidence: 0.55,
      source: "fallback",
    });
  });

  test("an explicitly pinned item is never asked about", async () => {
    // One answer for one question (b): this passes only if the pinned item was
    // excluded from the batch. b is reproducible, so it is the one that goes.
    const provider = new StaticProvider({ bools: [{ value: true, confidence: 0.9 }] });

    const result = await answerCompaction(
      {
        items: [
          { id: "a", summary: "one" },
          { id: "b", summary: "two" },
          { id: "c", summary: "three", pinned: true },
          { id: "d", summary: "four" },
          { id: "e", summary: "five" },
        ],
      },
      provider,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.kept.map((item) => item.id)).toEqual(["a", "c", "d", "e"]);
    expect(result.result.decisions[2]?.source).toBe("pinned");
  });

  test("the caller cannot set the threshold — how cautious to be is not a caller's parameter", async () => {
    const provider = new StaticProvider({
      bools: [
        { value: true, confidence: 0.55 },
        { value: false, confidence: 0.9 },
      ],
    });

    // A body that tries to lower the threshold is simply not read.
    const result = await answerCompaction({ items, options: { threshold: 0.1 } }, provider);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.decisions[1]?.source).toBe("fallback");
  });

  test("an empty item list is a bad-request", async () => {
    const result = await answerCompaction({ items: [] }, new StaticProvider({}));

    expect(result).toEqual({
      ok: false,
      kind: "bad-request",
      message: expect.stringContaining("nothing to judge"),
    });
  });

  test("a malformed item names the index that is wrong", async () => {
    const result = await answerCompaction(
      {
        items: [
          { id: "a", summary: "ok" },
          { id: "", summary: "broken" },
        ],
      },
      new StaticProvider({ bool: { value: true, confidence: 1 } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("items[1].id");
  });

  test("a missing items array is a bad-request", async () => {
    const result = await answerCompaction({}, new StaticProvider({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("bad-request");
  });

  test("a provider failure is a provider-error, not a dropped context", async () => {
    const result = await answerCompaction({ items }, new StaticProvider({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("provider-error");
  });
});
