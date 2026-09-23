import { describe, expect, test } from "bun:test";
import { activeOmpProfile, resolveOmpAgentDir } from "../../../src/domain/omp/agent-dir";

const HOME = "/home/u";

describe("resolveOmpAgentDir", () => {
  test("the default profile lives at ~/.omp/agent", () => {
    expect(resolveOmpAgentDir({}, HOME)).toEqual({ dir: "/home/u/.omp/agent", how: "default" });
  });

  test("PI_CONFIG_DIR renames the config root under home", () => {
    expect(resolveOmpAgentDir({ PI_CONFIG_DIR: ".pi" }, HOME)).toEqual({
      dir: "/home/u/.pi/agent",
      how: "default",
    });
  });

  test("PI_CODING_AGENT_DIR replaces the whole agent directory, for the default profile only", () => {
    expect(resolveOmpAgentDir({ PI_CODING_AGENT_DIR: "/elsewhere/agent" }, HOME)).toEqual({
      dir: "/elsewhere/agent",
      how: "PI_CODING_AGENT_DIR",
    });
    expect(
      resolveOmpAgentDir({ PI_CODING_AGENT_DIR: "/elsewhere/agent", OMP_PROFILE: "work" }, HOME),
    ).toEqual({ dir: "/home/u/.omp/profiles/work/agent", how: "profile", profile: "work" });
  });

  test("a named profile relocates to ~/.omp/profiles/<name>/agent; OMP_PROFILE wins over PI_PROFILE even when empty", () => {
    expect(resolveOmpAgentDir({ PI_PROFILE: "legacy" }, HOME)).toMatchObject({
      dir: "/home/u/.omp/profiles/legacy/agent",
      profile: "legacy",
    });
    expect(resolveOmpAgentDir({ OMP_PROFILE: "", PI_PROFILE: "legacy" }, HOME)).toEqual({
      dir: "/home/u/.omp/agent",
      how: "default",
    });
  });

  test("`default`, empty and whitespace select the default profile", () => {
    for (const value of ["default", "", "   "]) {
      expect(activeOmpProfile({ OMP_PROFILE: value })).toBeUndefined();
    }
    expect(activeOmpProfile({ OMP_PROFILE: " work " })).toBe("work");
  });
});
