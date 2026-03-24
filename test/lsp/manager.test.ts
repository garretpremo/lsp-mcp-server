import { describe, test, expect } from "bun:test";
import { LspManager } from "../../src/lsp/manager";
import { loadConfig } from "../../src/config";

describe("LspManager", () => {
  test("detects language from file extension", () => {
    const config = loadConfig.defaults();
    const manager = new LspManager(config, "/tmp/test-project");

    expect(manager.languageFor("/path/to/file.ts")).toBe("typescript");
    expect(manager.languageFor("/path/to/file.java")).toBe("java");
    expect(manager.languageFor("/path/to/file.rs")).toBeUndefined();
  });

  test("reports unsupported language", () => {
    const config = loadConfig.defaults();
    const manager = new LspManager(config, "/tmp/test-project");

    expect(manager.isSupported("/path/to/file.ts")).toBe(true);
    expect(manager.isSupported("/path/to/file.rs")).toBe(false);
  });

  test("generates workspace dir for java projects", () => {
    const config = loadConfig.defaults();
    const manager = new LspManager(config, "/home/user/my-project");
    const workspaceDir = manager.javaWorkspaceDir();

    expect(workspaceDir).toContain("/tmp/jdtls-workspace-");
    // Same project root should produce same hash
    const again = manager.javaWorkspaceDir();
    expect(again).toBe(workspaceDir);
  });
});
