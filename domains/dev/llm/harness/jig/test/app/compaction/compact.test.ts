import { describe, expect, test } from "bun:test";
import { type Item, compact } from "../../../src/app/compaction/compact";
import type {
  BoolBatchQuery,
  ChoiceQuery,
  Decided,
  DecisionProvider,
} from "../../../src/domain/decision/provider";

/** Answers a whole batch in order and records what it was asked. */
class ScriptedProvider implements DecisionProvider {
  readonly name = "scripted";
  readonly batches: BoolBatchQuery[] = [];

  constructor(private readonly answers: readonly Decided<boolean>[]) {}

  async boolBatch(query: BoolBatchQuery): Promise<readonly Decided<boolean>[]> {
    this.batches.push(query);
    if (query.prompts.length !== this.answers.length) {
      throw new Error(
        `scripted: ${this.answers.length} answers for ${query.prompts.length} prompts`,
      );
    }
    return this.answers;
  }

  async bool(): Promise<Decided<boolean>> {
    throw new Error("scripted: compact must judge as one batch, not one call per item");
  }

  async choice<T extends string>(query: ChoiceQuery<T>): Promise<Decided<T>> {
    const first = query.options[0];
    if (first === undefined) throw new Error("no options");
    return { value: first, confidence: 1 };
  }

  async score(): Promise<Decided<number>> {
    return { value: 0, confidence: 1 };
  }
}

/** Answers nothing, to prove a short batch is an error rather than a silent keep. */
class ShortProvider extends ScriptedProvider {
  override async boolBatch(): Promise<readonly Decided<boolean>[]> {
    return [];
  }
}

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, summary: id, ...extra });

describe("compact", () => {
  test("keeps pinned items and asks nothing when every item is pinned", async () => {
    const provider = new ScriptedProvider([]);
    const result = await compact([item("a", { pinned: true })], provider, { preserveRecent: 0 });

    expect(result.kept.map((i) => i.id)).toEqual(["a"]);
    expect(result.decisions[0]).toEqual({ id: "a", kept: true, confidence: 1, source: "pinned" });
    expect(provider.batches).toEqual([]);
  });

  test("always pins the first item and the most recent N", async () => {
    const provider = new ScriptedProvider([{ value: true, confidence: 0.9 }]);
    const items = [item("a"), item("b"), item("c"), item("d")];

    const result = await compact(items, provider, { preserveRecent: 2 });

    // a (first) + c, d (most recent 2) are pinned; only b is asked, and it is
    // reproducible, so it goes.
    expect(result.kept.map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(provider.batches.length).toBe(1);
    expect(provider.batches[0]?.prompts).toEqual([
      'Is item "b" reproducible by running the same tool call again? Answer true only for a tool result whose content the same command or read would produce again; answer false for anything that is not a tool result.',
    ]);
  });

  test("judges every candidate in one batch, with the item list as the material", async () => {
    const answers = [
      { value: true, confidence: 0.9 },
      { value: false, confidence: 0.95 },
      { value: true, confidence: 0.8 },
    ];
    const provider = new ScriptedProvider(answers);
    const items = [
      item("pin0", { pinned: true }),
      item("x", { summary: "the failing test output" }),
      item("y", { summary: "an early grep result" }),
      item("z", { summary: "the file we just read" }),
      item("r1"),
      item("r2"),
    ];

    const result = await compact(items, provider, { preserveRecent: 2 });

    expect(provider.batches.length).toBe(1);
    const batch = provider.batches[0];
    expect(batch?.prompts.length).toBe(3);
    expect(batch?.prompts[0]).toContain('Is item "x" reproducible');
    // The material is the whole list, so the model sees the surroundings of the item it judges.
    expect(batch?.material).toContain("[pin0] (pinned) pin0");
    expect(batch?.material).toContain("[x] the failing test output");
    // x and z are reproducible (dropped), y is not (kept), pinned items always stay.
    expect(result.kept.map((i) => i.id)).toEqual(["pin0", "y", "r1", "r2"]);
  });

  test("drops a non-pinned item the provider confidently calls reproducible", async () => {
    const provider = new ScriptedProvider([{ value: true, confidence: 0.95 }]);
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];

    const result = await compact(items, provider, { preserveRecent: 2 });

    expect(result.kept.map((i) => i.id)).toEqual(["pin0", "r1", "r2"]);
    expect(result.decisions.find((d) => d.id === "x")).toEqual({
      id: "x",
      kept: false,
      confidence: 0.95,
      source: "decided",
    });
  });

  test("an item the model says is not reproducible is kept", async () => {
    const provider = new ScriptedProvider([{ value: false, confidence: 0.9 }]);
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];

    const result = await compact(items, provider, { preserveRecent: 2 });

    expect(result.decisions.find((d) => d.id === "x")).toEqual({
      id: "x",
      kept: true,
      confidence: 0.9,
      source: "decided",
    });
  });

  test("keeps an item when the provider is unsure (conservative fallback)", async () => {
    const provider = new ScriptedProvider([{ value: true, confidence: 0.2 }]);
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];

    const result = await compact(items, provider, { preserveRecent: 2 });

    expect(result.decisions.find((d) => d.id === "x")).toEqual({
      id: "x",
      kept: true,
      confidence: 0.2,
      source: "fallback",
    });
  });

  test("the default threshold is 0.6, so a 0.55 judgment is 'unsure' and the item is kept", async () => {
    const provider = new ScriptedProvider([{ value: true, confidence: 0.55 }]);
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];

    const result = await compact(items, provider, { preserveRecent: 2 });

    expect(result.decisions.find((d) => d.id === "x")).toEqual({
      id: "x",
      kept: true,
      confidence: 0.55,
      source: "fallback",
    });
  });

  test("a short batch is an error, not a silent keep", async () => {
    const provider = new ShortProvider([]);
    const items = [item("pin0"), item("x"), item("r1")];

    await expect(compact(items, provider, { preserveRecent: 1 })).rejects.toThrow(
      /returned 0 judgments for 1 items/,
    );
  });
});
