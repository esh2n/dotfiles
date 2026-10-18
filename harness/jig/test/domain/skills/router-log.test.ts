import { describe, expect, test } from "bun:test";
import { commandOf } from "../../../src/domain/skills/router-log";

describe("commandOf", () => {
  test("takes a leading slash command, plugin-qualified or not", () => {
    expect(commandOf("/pstack:poteto-mode fix it")).toBe("/pstack:poteto-mode");
    expect(commandOf("  /tdd")).toBe("/tdd");
    expect(commandOf("/skill:poteto-mode")).toBe("/skill:poteto-mode");
  });

  test("anything else is not a command", () => {
    expect(commandOf("fix /tmp/x")).toBeUndefined();
    expect(commandOf("/")).toBeUndefined();
    expect(commandOf("/usr/bin/env is broken")).toBeUndefined();
    expect(commandOf(`/${"a".repeat(65)}`)).toBeUndefined();
    expect(commandOf(`/${"a".repeat(64)}`)).toBe(`/${"a".repeat(64)}`);
  });
});
