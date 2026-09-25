import { describe, expect, test } from "bun:test";
import {
  DSH_PROFILES_DIR,
  DSH_PROFILE_PATCH_FILENAME,
  resolveDshHome,
} from "../../../src/domain/dsh/home";

describe("resolveDshHome", () => {
  test("defaults to ~/.dsh", () => {
    expect(resolveDshHome({}, "/home/u")).toEqual({ dir: "/home/u/.dsh", via: "default" });
  });

  test("DSH_HOME wins", () => {
    expect(resolveDshHome({ DSH_HOME: "/srv/dsh" }, "/home/u")).toEqual({
      dir: "/srv/dsh",
      via: "DSH_HOME",
    });
  });

  test("a blank DSH_HOME is unset, as dsh-home-paths treats it", () => {
    expect(resolveDshHome({ DSH_HOME: "  " }, "/home/u").via).toBe("default");
    expect(resolveDshHome({ DSH_HOME: "" }, "/home/u").dir).toBe("/home/u/.dsh");
  });

  test("the names dsh-app-boot fixes", () => {
    expect(DSH_PROFILES_DIR).toBe("profiles");
    expect(DSH_PROFILE_PATCH_FILENAME).toBe("cordis.patch.yml");
  });
});
