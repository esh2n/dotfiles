import { describe, expect, test } from "bun:test";
import { parseTiers } from "../../../src/domain/tiers/parse";

interface RawTierDoc {
  version: number;
  extra?: unknown;
  connections: {
    proxy: Record<string, unknown> & {
      compat: Record<string, unknown>;
      pi: Record<string, unknown>;
      dsh: Record<string, unknown>;
    };
  };
  tiers: {
    main: Record<string, unknown> & { dsh: Record<string, unknown> };
    complex?: Record<string, unknown> & { dsh: Record<string, unknown> };
    deterministic: Record<string, unknown>;
    [extra: string]: unknown;
  };
}

function validDoc(): RawTierDoc {
  return {
    version: 1,
    connections: {
      proxy: {
        baseUrl: "http://localhost:4000/v1",
        api: "openai-completions",
        compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
        pi: { apiKey: "sk-local-proxy" },
        dsh: { displayName: "LiteLLM (local)", apiKeyEnv: "LITELLM_API_KEY" },
      },
    },
    tiers: {
      main: {
        alias: "main",
        displayName: "DeepSeek Flash",
        backend: { provider: "deepseek", model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY" },
        reasoning: true,
        input: ["text"],
        contextWindow: 1000000,
        maxTokens: 16384,
        compat: { thinkingFormat: "deepseek" },
        pi: { name: "main — DeepSeek Flash (proxy, measured)" },
        dsh: { name: "main (DeepSeek Flash)", reasoningEfforts: { off: null, high: "high" } },
      },
      complex: {
        alias: "complex",
        displayName: "DeepSeek V4 Pro",
        backend: { provider: "deepseek", model: "deepseek-v4-pro", apiKeyEnv: "DEEPSEEK_API_KEY" },
        reasoning: true,
        input: ["text"],
        contextWindow: 1000000,
        maxTokens: 32768,
        compat: { thinkingFormat: "deepseek" },
        pi: { name: "complex — DeepSeek V4 Pro (proxy, measured)" },
        dsh: { name: "complex (Astra)" },
      },
      deterministic: {
        alias: "deterministic",
        displayName: "local Qwen",
        backend: { provider: "lm_studio", model: "qwen/qwen3.8-27b" },
        reasoning: true,
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 32768,
        compat: { thinkingFormat: "qwen-chat-template", supportsReasoningEffort: false },
        thinkingLevelMap: { minimal: null, low: null, medium: "medium", high: null },
        samplingParams: { temperature: 1, top_p: 0.95, top_k: 20 },
        pi: { name: "deterministic — local Qwen (proxy, measured)" },
        dsh: { name: "deterministic (local Qwen)" },
      },
    },
  };
}

describe("parseTiers", () => {
  test("parses a valid document", () => {
    const policy = parseTiers(validDoc());
    expect(policy.version).toBe(1);
    expect(policy.tiers.main.alias).toBe("main");
    expect(policy.tiers.deterministic.samplingParams?.temperature).toBe(1);
    expect(policy.connections.proxy.baseUrl).toBe("http://localhost:4000/v1");
  });

  test("tolerates _comment fields anywhere they're documented", () => {
    const doc = validDoc();
    (doc as { _comment?: string })._comment = "top level why";
    doc.connections.proxy._comment = { baseUrl: "why" };
    if (doc.tiers.complex) {
      doc.tiers.complex.dsh._comment = { name: "why" };
    }

    expect(() => parseTiers(doc)).not.toThrow();
  });

  test("rejects a non-object document", () => {
    expect(() => parseTiers(null)).toThrow(/expected a JSON object/);
    expect(() => parseTiers("nope")).toThrow(/expected a JSON object/);
  });

  test("rejects an unsupported version", () => {
    const doc = validDoc();
    doc.version = 2;
    expect(() => parseTiers(doc)).toThrow(/unsupported version/);
  });

  test("rejects an unknown top-level key", () => {
    const doc = validDoc();
    doc.extra = true;
    expect(() => parseTiers(doc)).toThrow(/unknown key "extra"/);
  });

  test("rejects a missing tier", () => {
    const doc = validDoc();
    // biome-ignore lint/performance/noDelete: an undefined value would still satisfy `in`
    delete doc.tiers.complex;
    expect(() => parseTiers(doc)).toThrow(/missing tier "complex"/);
  });

  test("rejects an unknown tier key", () => {
    const doc = validDoc();
    doc.tiers.banana = doc.tiers.main;
    expect(() => parseTiers(doc)).toThrow(/unknown tier "banana"/);
  });

  test("rejects a tier with an unknown field", () => {
    const doc = validDoc();
    doc.tiers.main.bogus = true;
    expect(() => parseTiers(doc)).toThrow(/tier "main".*unknown key "bogus"/);
  });

  test("rejects a tier missing a required field", () => {
    const doc = validDoc();
    // biome-ignore lint/performance/noDelete: an undefined value would still fail type checks the same way, but explicitly
    delete doc.tiers.main.contextWindow;
    expect(() => parseTiers(doc)).toThrow(/tier "main".*contextWindow/);
  });

  test("rejects a tier with the wrong alias (must equal its own key)", () => {
    const doc = validDoc();
    doc.tiers.main.alias = "not-main";
    expect(() => parseTiers(doc)).toThrow(/alias "not-main" must equal its tier key "main"/);
  });

  test("rejects an unknown key under connections.proxy", () => {
    const doc = validDoc();
    doc.connections.proxy.bogus = true;
    expect(() => parseTiers(doc)).toThrow(/connections\.proxy.*unknown key "bogus"/);
  });

  test("rejects a non-boolean compat.supportsDeveloperRole", () => {
    const doc = validDoc();
    doc.connections.proxy.compat.supportsDeveloperRole = "false";
    expect(() => parseTiers(doc)).toThrow(/supportsDeveloperRole/);
  });

  test("rejects an EffortMap value that is neither string nor null", () => {
    const doc = validDoc();
    doc.tiers.main.dsh.reasoningEfforts = { off: 5 };
    expect(() => parseTiers(doc)).toThrow(/reasoningEfforts/);
  });
});

describe("maxContextWindow (the provider window a harness may opt into)", () => {
  test("is optional, and a number when present", () => {
    const withIt = validDoc() as unknown as { tiers: Record<string, Record<string, unknown>> };
    (withIt.tiers.main as Record<string, unknown>).maxContextWindow = 1000000;
    expect(parseTiers(withIt).tiers.main.maxContextWindow).toBe(1000000);
    expect(parseTiers(validDoc()).tiers.main.maxContextWindow).toBeUndefined();
    (withIt.tiers.main as Record<string, unknown>).maxContextWindow = "1M";
    expect(() => parseTiers(withIt)).toThrow(/maxContextWindow/);
  });
});
