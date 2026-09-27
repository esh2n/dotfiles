/** A small model catalog for tier tests (the real one is policy/models.json). */

import { type ModelCatalog, parseCatalog } from "../../../src/domain/tiers/catalog";

export const TEST_CATALOG_JSON = {
  version: 1,
  models: {
    "deepseek-flash": {
      provider: "deepseek",
      model: "deepseek-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      keyRef: "op://vault/deepseek/credential",
    },
    "deepseek-v4-pro": {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      keyRef: "op://vault/deepseek/credential",
    },
    "qwen-local": { provider: "lm_studio", model: "qwen/qwen3.8-27b" },
  },
};

export const TEST_CATALOG: ModelCatalog = parseCatalog(TEST_CATALOG_JSON);
