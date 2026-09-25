import { describe, expect, test } from "bun:test";
import { resolvePiAgentDir } from "../../../src/domain/pi/agent-dir";

describe("resolvePiAgentDir", () => {
  test("defaults to ~/.pi/agent", () => {
    expect(resolvePiAgentDir({}, "/home/u")).toEqual({ dir: "/home/u/.pi/agent", via: "default" });
  });

  test("PI_CODING_AGENT_DIR replaces it whole; an empty value does not", () => {
    expect(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/srv/pi" }, "/home/u")).toEqual({
      dir: "/srv/pi",
      via: "PI_CODING_AGENT_DIR",
    });
    expect(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "" }, "/home/u").dir).toBe("/home/u/.pi/agent");
  });

  test("omp's variables mean nothing to pi", () => {
    expect(
      resolvePiAgentDir({ OMP_PROFILE: "work", PI_PROFILE: "work", PI_CONFIG_DIR: "/x" }, "/home/u")
        .dir,
    ).toBe("/home/u/.pi/agent");
  });
});
