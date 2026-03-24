import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";
import { FileIndexer } from "../src/indexer/file-indexer";
import { join } from "path";

const fixtureRoot = join(import.meta.dir, "fixtures/sample-ts-project");

describe("integration: file indexer tools", () => {
  test("full flow: index, search, reindex", async () => {
    const indexer = new FileIndexer(fixtureRoot);

    // Initial index
    const stats = await indexer.index();
    expect(stats.indexedFiles).toBeGreaterThan(0);

    // Search for a file
    const results = indexer.search("service");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relativePath).toBe("src/service.ts");

    // Reindex a subtree
    const reindexStats = await indexer.index("src");
    expect(reindexStats.indexedFiles).toBeGreaterThan(0);

    // Search still works after reindex
    const results2 = indexer.search("index");
    expect(results2.some((r) => r.relativePath === "src/index.ts")).toBe(true);
  });
});
