import { describe, expect, test } from "bun:test";
import {
  canonicalMcpName,
  editedPaths,
  embeddedCommands,
  hashlineOperations,
  mapToolCall,
  sanitizeMcpName,
  stripSelector,
  webUrlOf,
} from "../../../adapters/omp/src/map";
import { requestFor } from "../../../src/domain/policy/request";

/** The action the core reads out of a mapped call — the thing that matters. */
function actionsOf(toolName: string, input: unknown, mcpServers: readonly string[] = []) {
  const mapping = mapToolCall(toolName, input, { mcpServers });
  if (mapping.kind !== "judge") return mapping.kind;
  return mapping.calls.map((call) => {
    const request = requestFor(call);
    if (request === undefined) return { action: "none" as const, tool: call.tool };
    switch (request.action) {
      case "shell.exec":
        return { action: request.action, raw: request.raw, tool: call.tool };
      case "net.fetch":
        return { action: request.action, host: request.host };
      case "mcp.call":
        return { action: request.action, server: request.server, tool: request.tool };
      default:
        return { action: request.action, path: request.path };
    }
  });
}

describe("bash", () => {
  test("is a shell.exec carrying the command", () => {
    expect(actionsOf("bash", { command: "git status", timeout: 30 })).toEqual([
      { action: "shell.exec", raw: "git status", tool: "bash" },
    ]);
  });

  test("a call with no command is unreadable, not allowed", () => {
    expect(mapToolCall("bash", {})).toEqual({
      kind: "unreadable",
      reason: "a bash call with no command to read",
    });
  });
});

describe("eval", () => {
  test("the cell body is judged as a shell command, under its own tool name", () => {
    const actions = actionsOf("eval", { language: "py", code: 'os.system("rm -rf /tmp/x")' });
    expect(actions).toContainEqual({
      action: "shell.exec",
      raw: 'os.system("rm -rf /tmp/x")',
      tool: "eval",
    });
    // …and the command inside it, which a rule about `rm` can actually read:
    // the whole cell reads as a program called `os.system`.
    expect(actions).toContainEqual({ action: "shell.exec", raw: "rm -rf /tmp/x", tool: "eval" });
  });

  test("a JS cell is read the same way — the kernel is irrelevant to the guard", () => {
    const actions = actionsOf("eval", { language: "js", code: "Bun.spawnSync(['sudo','ls'])" });
    expect(actions).toContainEqual({ action: "shell.exec", raw: "sudo ls", tool: "eval" });
  });

  test("an argument list is rejoined, a prose literal is left as it is", () => {
    expect(embeddedCommands('subprocess.run(["rm", "-rf", "/tmp/x"])')).toEqual([
      "rm",
      "-rf",
      "/tmp/x",
      "rm -rf /tmp/x",
    ]);
    expect(embeddedCommands('print("hello")')).toEqual(["hello"]);
    expect(embeddedCommands("x = 1")).toEqual([]);
  });

  test("a cell with no body is unreadable", () => {
    expect(mapToolCall("eval", { language: "py" }).kind).toBe("unreadable");
  });
});

describe("write", () => {
  test("is an fs.write on the path", () => {
    expect(actionsOf("write", { path: "src/a.ts", content: "x" })).toEqual([
      { action: "fs.write", path: "src/a.ts" },
    ]);
  });

  test("a write to a web URL is a fetch, not a file write", () => {
    expect(actionsOf("write", { path: "https://example.com/hook", content: "{}" })).toEqual([
      { action: "net.fetch", host: "example.com" },
    ]);
  });
});

describe("read", () => {
  test("a file path is an fs.read, with omp's trailing selector peeled off", () => {
    expect(actionsOf("read", { path: "~/.ssh/config:1-10" })).toEqual([
      { action: "fs.read", path: "~/.ssh/config" },
    ]);
    expect(actionsOf("read", { path: "src/a.ts:raw" })).toEqual([
      { action: "fs.read", path: "src/a.ts" },
    ]);
  });

  test("a web URL is a net.fetch — omp has no separate fetch tool", () => {
    expect(actionsOf("read", { path: "https://example.com/page" })).toEqual([
      { action: "net.fetch", host: "example.com" },
    ]);
  });

  test("an internal URL stays a path", () => {
    expect(actionsOf("read", { path: "ssh://host/etc/passwd" })).toEqual([
      { action: "fs.read", path: "ssh://host/etc/passwd" },
    ]);
  });
});

describe("edit", () => {
  test("hashline sections fan out into one fs.edit per file", () => {
    const input = {
      input: [
        "[src/a.ts#1A2B]",
        "PUT 4.=4:",
        "+const value = 2;",
        "[src/b.ts#FFFF]",
        "PUT >$:",
        "+x",
      ].join("\n"),
    };
    expect(actionsOf("edit", input)).toEqual([
      { action: "fs.edit", path: "src/a.ts" },
      { action: "fs.edit", path: "src/b.ts" },
    ]);
  });

  test("REM is a write of the path it removes, MV also writes the destination", () => {
    const input = { input: "[old.ts#1A2B]\nMV new.ts\n[gone.ts#00FF]\nREM" };
    expect(actionsOf("edit", input)).toEqual([
      { action: "fs.edit", path: "old.ts" },
      { action: "fs.write", path: "new.ts" },
      { action: "fs.write", path: "gone.ts" },
    ]);
  });

  test("the normalized gate fields win when omp supplies them", () => {
    expect(actionsOf("edit", { paths: ["a.go", "b.go"], input: "[c.go#1A2B]\nREM" })).toEqual([
      { action: "fs.edit", path: "a.go" },
      { action: "fs.edit", path: "b.go" },
    ]);
  });

  test("replace mode carries a path of its own", () => {
    expect(actionsOf("edit", { path: "src/a.ts", old_string: "a", new_string: "b" })).toEqual([
      { action: "fs.edit", path: "src/a.ts" },
    ]);
  });

  test("patch mode's rename lands as a write at the destination", () => {
    const input = { path: "src/a.ts", edits: [{ op: "update", rename: "src/b.ts", diff: "" }] };
    expect(actionsOf("edit", input)).toEqual([
      { action: "fs.edit", path: "src/a.ts" },
      { action: "fs.write", path: "src/b.ts" },
    ]);
  });

  test("apply_patch mode is handed to the core, which fans the envelope out", () => {
    const patch = "*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch";
    const mapping = mapToolCall("edit", { input: patch });
    expect(mapping).toEqual({
      kind: "judge",
      calls: [{ tool: "apply_patch", input: { input: patch } }],
    });
  });

  test("an edit whose target cannot be read is unreadable, never a silent allow", () => {
    expect(mapToolCall("edit", { input: "this is not a patch" }).kind).toBe("unreadable");
    expect(mapToolCall("edit", {}).kind).toBe("unreadable");
  });

  test("a patch body row is not mistaken for a section header", () => {
    const text = "[src/a.ts#1A2B]\nPUT 1.=1:\n+[not/a/file.ts#1A2B]";
    expect(hashlineOperations(text).map((op) => op.path)).toEqual(["src/a.ts"]);
  });
});

describe("mcp", () => {
  test("omp's single underscore is canonicalized so server and tool survive", () => {
    expect(actionsOf("mcp__serena_replace_content", { relative_path: "a.ts" })).toEqual([
      { action: "fs.edit", path: "a.ts" },
    ]);
    expect(actionsOf("mcp__github_delete_repository", { name: "x" })).toEqual([
      { action: "mcp.call", server: "github", tool: "delete_repository" },
    ]);
  });

  test("a configured server name resolves a split the underscores cannot", () => {
    const raw = "mcp__codebase_memory_mcp_search_code";
    expect(actionsOf(raw, {}, ["codebase-memory-mcp"])).toEqual([
      { action: "mcp.call", server: "codebase_memory_mcp", tool: "search_code" },
    ]);
    // Without the configured names the split is the first underscore: still
    // an mcp.call, just a less precise server name.
    expect(actionsOf(raw, {})).toEqual([
      { action: "mcp.call", server: "codebase", tool: "memory_mcp_search_code" },
    ]);
  });

  test("a Claude-shaped name is left alone", () => {
    expect(canonicalMcpName("mcp__serena__replace_content")).toBe("mcp__serena__replace_content");
  });

  test("names are sanitized the way omp sanitizes them", () => {
    expect(sanitizeMcpName("codebase-memory-mcp")).toBe("codebase_memory_mcp");
    expect(sanitizeMcpName("cloudflare:cloudflare-api")).toBe("cloudflare_cloudflare_api");
  });
});

describe("everything else", () => {
  test("grep, todo and task are out of scope, which is not the same as allowed", () => {
    for (const tool of ["grep", "todo", "task", "web_search", "glob"]) {
      expect(mapToolCall(tool, { pattern: "x" })).toEqual({ kind: "out-of-scope" });
    }
  });
});

describe("helpers", () => {
  test("a selector is peeled at most twice and never to nothing", () => {
    expect(stripSelector("a.ts:5-16,960-973")).toBe("a.ts");
    expect(stripSelector("a.ts:raw:10-20")).toBe("a.ts");
    expect(stripSelector("a.ts")).toBe("a.ts");
  });

  test("only http(s) counts as a web URL", () => {
    expect(webUrlOf("https://example.com")).toBe("https://example.com");
    expect(webUrlOf("xd://device")).toBeUndefined();
    expect(webUrlOf("/tmp/a")).toBeUndefined();
  });

  test("the formatter is told which files an edit touched", () => {
    expect(editedPaths("edit", { input: "[a.ts#1A2B]\nPUT >$:\n+x" }, undefined)).toEqual(["a.ts"]);
    expect(editedPaths("write", { path: "b.ts" }, { resolvedPath: "/repo/b.ts" })).toEqual([
      "/repo/b.ts",
    ]);
    expect(editedPaths("bash", { command: "ls" }, undefined)).toEqual([]);
  });
});
