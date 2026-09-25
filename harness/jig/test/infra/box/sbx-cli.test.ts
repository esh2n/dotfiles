import { describe, expect, test } from "bun:test";
import { sbxEnvironment } from "../../../src/infra/box/sbx-cli";

describe("sbxEnvironment", () => {
  test("drops SSH_AUTH_SOCK, which is what makes sbx forward the host agent", () => {
    const env = sbxEnvironment({ PATH: "/usr/bin", SSH_AUTH_SOCK: "/tmp/agent.sock" });

    expect(env.SSH_AUTH_SOCK).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  test("keeps everything else, so sbx still finds its own config and login", () => {
    const env = sbxEnvironment({ HOME: "/Users/x", DOCKER_CONFIG: "/Users/x/.docker" });

    expect(env).toEqual({ HOME: "/Users/x", DOCKER_CONFIG: "/Users/x/.docker" });
  });

  test("unset variables are not passed through as the string 'undefined'", () => {
    const env = sbxEnvironment({ PATH: "/usr/bin", EMPTY: undefined });

    expect("EMPTY" in env).toBe(false);
  });
});
