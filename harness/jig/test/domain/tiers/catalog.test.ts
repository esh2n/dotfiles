import { describe, expect, test } from "bun:test";
import { parseCatalog } from "../../../src/domain/tiers/catalog";

const doc = (models: Record<string, unknown>) => ({ version: 1, models });

describe("parseCatalog", () => {
  test("parses models with their optional fields", () => {
    const catalog = parseCatalog(
      doc({
        "a-model": {
          provider: "openai",
          model: "A",
          apiBaseEnv: "A_BASE",
          apiKeyEnv: "A_KEY",
          keyRef: "op://v/a/credential",
          litellmParams: { extra_body: { ttl: 600 } },
          modelInfo: { allowed_fails: 1 },
          notes: "why",
        },
      }),
    );
    expect(catalog.models["a-model"]?.apiBaseEnv).toBe("A_BASE");
    expect(catalog.models["a-model"]?.litellmParams).toEqual({ extra_body: { ttl: 600 } });
  });

  test("a key is only ever an op:// reference, and has an env var to go into", () => {
    expect(() =>
      parseCatalog(doc({ m: { provider: "p", model: "m", apiKeyEnv: "K", keyRef: "sk-real" } })),
    ).toThrow(/op:\/\/ reference, never a key/);
    expect(() =>
      parseCatalog(doc({ m: { provider: "p", model: "m", keyRef: "op://v/i/f" } })),
    ).toThrow(/no apiKeyEnv/);
  });

  test("rejects bad env names, ids, unknown keys and versions", () => {
    expect(() =>
      parseCatalog(doc({ m: { provider: "p", model: "m", apiKeyEnv: "lower" } })),
    ).toThrow(/environment variable name/);
    expect(() => parseCatalog(doc({ "Bad Id": { provider: "p", model: "m" } }))).toThrow(
      /id must be/,
    );
    expect(() => parseCatalog(doc({ m: { provider: "p", model: "m", extra: 1 } }))).toThrow(
      /unknown key "extra"/,
    );
    expect(() => parseCatalog({ version: 2, models: {} })).toThrow(/unsupported version/);
  });
});
