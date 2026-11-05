import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimOnce } from "../../../src/infra/fs/once-keys";
import { readTail } from "../../../src/infra/fs/read-tail";

const dir = () => mkdtempSync(join(tmpdir(), "jig-once-keys-"));

describe("claimOnce", () => {
  test("a key is new once, then taken, and survives in the file", async () => {
    const path = join(dir(), "state", "denials");
    expect(await claimOnce(path, "a", 10)).toBe(true);
    expect(await claimOnce(path, "a", 10)).toBe(false);
    expect(await claimOnce(path, "b", 10)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("a\nb\n");
  });

  test("only the last keys are kept", async () => {
    const path = join(dir(), "denials");
    for (const key of ["a", "b", "c", "d"]) await claimOnce(path, key, 3);
    expect(readFileSync(path, "utf8")).toBe("b\nc\nd\n");
    expect(await claimOnce(path, "a", 3)).toBe(true);
  });

  test("a store it cannot read is an error, never a fresh start", async () => {
    await expect(claimOnce(dir(), "a", 3)).rejects.toThrow();
  });
});

describe("readTail", () => {
  test("returns the last bytes, or the whole of a shorter file", async () => {
    const path = join(dir(), "t.jsonl");
    writeFileSync(path, "0123456789");
    expect(await readTail(path, 4)).toBe("6789");
    expect(await readTail(path, 100)).toBe("0123456789");
  });

  test("a missing file is an error", async () => {
    await expect(readTail(join(dir(), "none"), 4)).rejects.toThrow();
  });
});
