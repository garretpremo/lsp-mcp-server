import { describe, test, expect } from "bun:test";
import { fuzzyMatch } from "../../src/indexer/fuzzy-match";

describe("fuzzyMatch", () => {
  const files = [
    "src/main/java/com/example/UserService.java",
    "src/main/java/com/example/UserController.java",
    "src/main/java/com/example/OrderService.java",
    "src/components/UserProfile.tsx",
    "src/utils/helpers.ts",
    "README.md",
  ];

  test("exact filename match ranks first", () => {
    const results = fuzzyMatch(files, "UserService");
    expect(results[0]).toBe("src/main/java/com/example/UserService.java");
  });

  test("case-insensitive matching", () => {
    const results = fuzzyMatch(files, "userservice");
    expect(results[0]).toBe("src/main/java/com/example/UserService.java");
  });

  test("partial match finds multiple results", () => {
    const results = fuzzyMatch(files, "User");
    expect(results.length).toBe(3); // UserService, UserController, UserProfile
  });

  test("respects maxResults", () => {
    const results = fuzzyMatch(files, "User", 2);
    expect(results.length).toBe(2);
  });

  test("no match returns empty array", () => {
    const results = fuzzyMatch(files, "zzzznotfound");
    expect(results.length).toBe(0);
  });

  test("filename match ranks above directory match", () => {
    const filesWithDir = [
      "user/config.ts",
      "src/UserService.ts",
    ];
    const results = fuzzyMatch(filesWithDir, "user");
    expect(results[0]).toBe("src/UserService.ts");
  });
});
