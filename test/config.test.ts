import { describe, test, expect } from "bun:test";
import { loadConfig, type Config } from "../src/config";
import { join } from "path";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", async () => {
    const config = await loadConfig("/nonexistent/path");
    expect(config.requestTimeout).toBe(10000);
    expect(config.languageServers.typescript.command).toBe(
      "typescript-language-server"
    );
    expect(config.languageServers.typescript.args).toEqual(["--stdio"]);
    expect(config.languageServers.java.command).toBe("jdtls");
  });

  test("merges user config over defaults", async () => {
    const config = await loadConfig(
      join(import.meta.dir, "fixtures"),
      "sample-config.json"
    );
    expect(config.languageServers.typescript.command).toBe("custom-ts-server");
    expect(config.languageServers.typescript.args).toEqual([
      "--stdio",
      "--verbose",
    ]);
    expect(config.requestTimeout).toBe(5000);
    // Java should still have defaults
    expect(config.languageServers.java.command).toBe("jdtls");
  });

  test("provides file extension to language mapping", () => {
    const config = loadConfig.defaults();
    expect(config.languageForExtension(".ts")).toBe("typescript");
    expect(config.languageForExtension(".java")).toBe("java");
    expect(config.languageForExtension(".rs")).toBeUndefined();
  });
});
