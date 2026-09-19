import { describe, expect, test } from "bun:test";
import { compact, type Item } from "../../../src/app/compaction/compact";
import type {
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  DecisionProvider,
} from "../../../src/domain/decision/provider";

/** A provider that answers each keep-question from a map keyed by item id in the context. */
class ScriptedProvider implements DecisionProvider {
  readonly name = "scripted";
  constructor(private readonly byId: Record<string, Decided<boolean>>) {}
  async bool(_query: BoolQuery, context: DecisionContext): Promise<Decided<boolean>> {
    const id = context.id as string;
    const answer = this.byId[id];
    if (answer === undefined) throw new Error(`no scripted answer for ${id}`);
    return answer;
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

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, summary: id, ...extra });

describe("compact", () => {
  test("keeps pinned items without asking the provider", async () => {
    const provider = new ScriptedProvider({});
    const result = await compact([item("a", { pinned: true })], provider, { preserveRecent: 0 });
    expect(result.kept.map((i) => i.id)).toEqual(["a"]);
    expect(result.decisions[0]).toEqual({ id: "a", kept: true, confidence: 1, source: "pinned" });
  });

  test("always pins the first item and the most recent N", async () => {
    const provider = new ScriptedProvider({
      b: { value: false, confidence: 0.9 },
    });
    const items = [item("a"), item("b"), item("c"), item("d")];
    const result = await compact(items, provider, { preserveRecent: 2, threshold: 0.6 });
    // a (first) + c,d (recent 2) pinned; only b is asked and dropped.
    expect(result.kept.map((i) => i.id)).toEqual(["a", "c", "d"]);
  });

  test("drops a non-pinned item the provider confidently rejects", async () => {
    const provider = new ScriptedProvider({ x: { value: false, confidence: 0.95 } });
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];
    const result = await compact(items, provider, { preserveRecent: 2, threshold: 0.6 });
    expect(result.kept.map((i) => i.id)).toEqual(["pin0", "r1", "r2"]);
    const xDecision = result.decisions.find((d) => d.id === "x");
    expect(xDecision).toEqual({ id: "x", kept: false, confidence: 0.95, source: "decided" });
  });

  test("keeps a non-pinned item when the provider is unsure (conservative fallback)", async () => {
    const provider = new ScriptedProvider({ x: { value: false, confidence: 0.2 } });
    const items = [item("pin0"), item("x"), item("r1"), item("r2")];
    const result = await compact(items, provider, { preserveRecent: 2, threshold: 0.6 });
    const xDecision = result.decisions.find((d) => d.id === "x");
    expect(xDecision).toEqual({ id: "x", kept: true, confidence: 0.2, source: "fallback" });
    expect(result.kept.map((i) => i.id)).toContain("x");
  });
});
