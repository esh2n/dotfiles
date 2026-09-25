import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureDecisionToken,
  readDecisionToken,
  tokenFilePath,
} from "../../../src/infra/decision/token-file";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "jig-token-file-"));
}

describe("tokenFilePath", () => {
  test("uses JIG_DECISION_TOKEN_FILE when set", () => {
    expect(tokenFilePath({ JIG_DECISION_TOKEN_FILE: "/tmp/x/decision.token" })).toBe(
      "/tmp/x/decision.token",
    );
  });

  test("falls back to the default path under Application Support", () => {
    expect(tokenFilePath({})).toContain("Library/Application Support/jig/decision.token");
  });
});

describe("ensureDecisionToken", () => {
  test("creates a new token, mode 0600, under a freshly created parent directory", async () => {
    const path = join(tempDir(), "nested", "decision.token");

    const token = await ensureDecisionToken(path);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("reuses an existing non-empty token instead of overwriting it", async () => {
    const path = join(tempDir(), "decision.token");
    await writeFile(path, "existing-token", { mode: 0o600 });

    const token = await ensureDecisionToken(path);

    expect(token).toBe("existing-token");
  });

  test("a second call reads back exactly what the first call wrote", async () => {
    const path = join(tempDir(), "decision.token");

    const first = await ensureDecisionToken(path);
    const second = await ensureDecisionToken(path);

    expect(second).toBe(first);
  });

  test("generates a fresh token when the file exists but is empty", async () => {
    const path = join(tempDir(), "decision.token");
    await writeFile(path, "", { mode: 0o600 });

    const token = await ensureDecisionToken(path);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("readDecisionToken", () => {
  test("returns the trimmed contents of an existing file", async () => {
    const path = join(tempDir(), "decision.token");
    await writeFile(path, "  a-token \n", { mode: 0o600 });

    expect(await readDecisionToken(path)).toBe("a-token");
  });

  test("returns undefined when the file does not exist", async () => {
    const path = join(tempDir(), "missing.token");

    expect(await readDecisionToken(path)).toBeUndefined();
  });

  test("returns undefined when the file is empty", async () => {
    const path = join(tempDir(), "decision.token");
    await writeFile(path, "", { mode: 0o600 });

    expect(await readDecisionToken(path)).toBeUndefined();
  });
});
