import { describe, test, expect, beforeAll } from "bun:test";
import { FileIndexer } from "../../src/indexer/file-indexer";
import { join } from "path";

const fixtureRoot = join(import.meta.dir, "../fixtures/sample-ts-project");

describe("FileIndexer", () => {
  let indexer: FileIndexer;

  beforeAll(async () => {
    indexer = new FileIndexer(fixtureRoot);
    await indexer.index();
  });

  test("indexes files in the project", () => {
    const results = indexer.search("index");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.relativePath === "src/index.ts")).toBe(true);
  });

  test("ignores node_modules (hardcoded ignore)", () => {
    const results = indexer.search("dep");
    expect(results.length).toBe(0);
  });

  test("ignores directories from .gitignore", () => {
    const results = indexer.search("secret");
    expect(results.length).toBe(0);
  });

  test("returns absolute and relative paths", () => {
    const results = indexer.search("service");
    expect(results.length).toBe(1);
    expect(results[0].file).toBe(join(fixtureRoot, "src/service.ts"));
    expect(results[0].relativePath).toBe("src/service.ts");
  });

  test("reindex updates the index", async () => {
    const stats = await indexer.index();
    expect(stats.indexedFiles).toBeGreaterThan(0);
    expect(stats.duration).toBeGreaterThanOrEqual(0);
  });

  test("reindex with path only re-indexes that subtree", async () => {
    const stats = await indexer.index("src");
    expect(stats.indexedFiles).toBeGreaterThan(0);
  });
});
