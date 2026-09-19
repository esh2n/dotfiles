import { describe, expect, test } from "bun:test";
import {
  RemoteDecisionProtocolError,
  parseRemoteDecisionRequest,
  readErrorResponse,
  requireDecidedBoolean,
} from "../../../src/domain/decision/remote";

describe("parseRemoteDecisionRequest", () => {
  test("parses a choice request and defaults the context to empty", () => {
    const request = parseRemoteDecisionRequest({
      op: "choice",
      query: { prompt: "which tier?", options: ["main", "complex"] },
    });

    expect(request).toEqual({
      op: "choice",
      query: { prompt: "which tier?", options: ["main", "complex"] },
      context: {},
    });
  });

  test("carries the option descriptions through", () => {
    const request = parseRemoteDecisionRequest({
      op: "choice",
      query: {
        prompt: "which tier?",
        options: ["main", "complex"],
        criteria: { main: "routine", complex: "hard" },
      },
      context: { session: "abc" },
    });

    expect(request.query).toEqual({
      prompt: "which tier?",
      options: ["main", "complex"],
      criteria: { main: "routine", complex: "hard" },
    });
    expect(request.context).toEqual({ session: "abc" });
  });

  test("parses a batch request as one material plus its questions", () => {
    const request = parseRemoteDecisionRequest({
      op: "boolBatch",
      query: { material: "the item list", prompts: ["keep a?", "keep b?"] },
    });

    expect(request).toEqual({
      op: "boolBatch",
      query: { material: "the item list", prompts: ["keep a?", "keep b?"] },
      context: {},
    });
  });

  test("rejects an unknown op", () => {
    expect(() => parseRemoteDecisionRequest({ op: "predict", query: {} })).toThrow(
      RemoteDecisionProtocolError,
    );
  });

  test("rejects a choice with fewer than two options", () => {
    expect(() =>
      parseRemoteDecisionRequest({ op: "choice", query: { prompt: "?", options: ["only"] } }),
    ).toThrow(/at least two options/);
  });

  test("rejects a batch without material", () => {
    expect(() =>
      parseRemoteDecisionRequest({ op: "boolBatch", query: { prompts: ["a"] } }),
    ).toThrow(/material must be a string/);
  });

  test("rejects a non-object body", () => {
    expect(() => parseRemoteDecisionRequest("choice")).toThrow(/must be an object/);
  });
});

describe("readErrorResponse", () => {
  test("reads the service's own rejection", () => {
    expect(
      readErrorResponse({ op: "error", error: { kind: "bad-request", message: "no options" } }),
    ).toEqual({ kind: "bad-request", message: "no options" });
  });

  test("is undefined for a judgment and for a malformed error", () => {
    expect(readErrorResponse({ op: "bool", value: true, confidence: 1 })).toBeUndefined();
    expect(readErrorResponse({ op: "error" })).toBeUndefined();
    expect(readErrorResponse(null)).toBeUndefined();
  });
});

describe("requireDecidedBoolean", () => {
  test("accepts a probability-shaped confidence", () => {
    expect(requireDecidedBoolean({ value: true, confidence: 0.7 }, "q")).toEqual({
      value: true,
      confidence: 0.7,
    });
  });

  test("rejects a confidence outside [0, 1]", () => {
    expect(() => requireDecidedBoolean({ value: true, confidence: 1.2 }, "q")).toThrow(
      /not a probability/,
    );
  });

  test("rejects a non-boolean value", () => {
    expect(() => requireDecidedBoolean({ value: "yes", confidence: 0.5 }, "q")).toThrow(
      /must be a boolean/,
    );
  });
});
