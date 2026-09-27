/** Shared test fixture: loads the REAL `harness/policy/tiers.json`. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCatalog } from "../../../src/domain/tiers/catalog";
import { parseTiers } from "../../../src/domain/tiers/parse";

export const REAL_TIERS_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "policy",
  "tiers.json",
);

export const REAL_CATALOG_PATH = join(REAL_TIERS_PATH, "..", "models.json");

export function loadRealTiers() {
  return parseTiers(
    JSON.parse(readFileSync(REAL_TIERS_PATH, "utf8")),
    parseCatalog(JSON.parse(readFileSync(REAL_CATALOG_PATH, "utf8"))),
  );
}
