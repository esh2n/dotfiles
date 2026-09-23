import { describe, expect, test } from "bun:test";
import {
  PI_MCP_ADAPTER_NPM,
  PI_SUBAGENTS_NPM,
  findNpmPackage,
  npmPackageName,
  parsePiPackages,
  piInstallLine,
  piPackagesEntry,
} from "../../../src/domain/pi/packages";

describe("parsePiPackages", () => {
  test("string and object entries alike, in file order; other entries skipped", () => {
    const parsed = parsePiPackages(
      JSON.stringify({
        packages: [
          "https://github.com/dimk90/pi-context-view",
          "npm:pi-web-access",
          { source: "npm:@example/pi-tools", skills: [] },
          42,
          { notSource: true },
        ],
      }),
    );
    expect(parsed.sources).toEqual([
      "https://github.com/dimk90/pi-context-view",
      "npm:pi-web-access",
      "npm:@example/pi-tools",
    ]);
    expect(parsed.invalid).toBeUndefined();
  });

  test("no file, an empty file, or no `packages` key: no sources, not an error", () => {
    expect(parsePiPackages(undefined)).toEqual({ sources: [] });
    expect(parsePiPackages("  \n")).toEqual({ sources: [] });
    expect(parsePiPackages('{"theme":"unkai"}')).toEqual({ sources: [] });
  });

  test("unreadable content is reported, and reads as no sources", () => {
    expect(parsePiPackages("{ nope").invalid).toBeDefined();
    expect(parsePiPackages("[]").invalid).toBe("the top level is not a JSON object");
    expect(parsePiPackages("[]").sources).toEqual([]);
  });
});

describe("npm identity", () => {
  test("pi identifies an npm package by name: scoped, unscoped, any version", () => {
    expect(npmPackageName("npm:pi-mcp-adapter")).toBe("pi-mcp-adapter");
    expect(npmPackageName("npm:pi-mcp-adapter@1.2.3")).toBe("pi-mcp-adapter");
    expect(npmPackageName("npm:@tintinweb/pi-subagents")).toBe("@tintinweb/pi-subagents");
    expect(npmPackageName("npm:@tintinweb/pi-subagents@0.19.0")).toBe("@tintinweb/pi-subagents");
    expect(npmPackageName("git:github.com/x/y@v1")).toBeUndefined();
    expect(npmPackageName("./local")).toBeUndefined();
  });

  test("findNpmPackage returns the declared source, whatever its version, or undefined", () => {
    const packages = parsePiPackages(
      JSON.stringify({ packages: ["npm:pi-web-access", "npm:pi-mcp-adapter@2.0.0"] }),
    );
    expect(findNpmPackage(packages, PI_MCP_ADAPTER_NPM)).toBe("npm:pi-mcp-adapter@2.0.0");
    expect(findNpmPackage(packages, PI_SUBAGENTS_NPM)).toBeUndefined();
  });
});

describe("the paste-able lines", () => {
  test("the install command and the packages entry, as documented", () => {
    expect(piInstallLine(PI_MCP_ADAPTER_NPM)).toBe("pi install npm:pi-mcp-adapter");
    expect(piPackagesEntry(PI_MCP_ADAPTER_NPM)).toBe('"npm:pi-mcp-adapter"');
    expect(piInstallLine(PI_SUBAGENTS_NPM)).toBe("pi install npm:@tintinweb/pi-subagents");
  });
});
