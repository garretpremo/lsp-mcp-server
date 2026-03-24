import { describe, test, expect } from "bun:test";
import { ResponseShaper } from "../../src/lsp/response-shaper";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { SymbolKind } from "vscode-languageserver-protocol";

// Create a temp file for snippet testing
const tmpDir = join(tmpdir(), "lsp-mcp-test-" + Date.now());
mkdirSync(tmpDir, { recursive: true });
const testFile = join(tmpDir, "test.ts");
writeFileSync(
  testFile,
  `import { Foo } from "./foo";

export class MyService {
  async handleRequest(req: Request): Promise<Response> {
    const body = await req.json();
    return this.process(body);
  }

  private process(data: unknown): Response {
    return new Response(JSON.stringify(data));
  }
}
`
);

describe("ResponseShaper", () => {
  const shaper = new ResponseShaper(tmpDir);

  test("shapes a Location into compact result", async () => {
    const result = await shaper.shapeDefinition(
      [{ uri: `file://${testFile}`, range: { start: { line: 3, character: 8 }, end: { line: 3, character: 21 } } }],
      {}
    );
    expect(result.length).toBe(1);
    expect(result[0].file).toBe(testFile);
    expect(result[0].line).toBe(4); // 1-based
    expect(result[0].symbol).toBe("handleRequest");
    expect(result[0].snippet).toContain("handleRequest");
    // Default: no kind, no container, no docstring
    expect(result[0].kind).toBeUndefined();
    expect(result[0].container).toBeUndefined();
  });

  test("includes kind when requested", async () => {
    const result = await shaper.shapeSymbols(
      [
        {
          name: "MyService",
          kind: SymbolKind.Class,
          location: {
            uri: `file://${testFile}`,
            range: { start: { line: 2, character: 0 }, end: { line: 11, character: 1 } },
          },
        },
      ],
      { includeKind: true }
    );
    expect(result[0].kind).toBe("class");
  });

  test("flattens hierarchical DocumentSymbols with container tracking", async () => {
    const hierarchicalSymbols = [
      {
        name: "MyService",
        kind: SymbolKind.Class,
        range: { start: { line: 2, character: 0 }, end: { line: 11, character: 1 } },
        selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 22 } },
        children: [
          {
            name: "handleRequest",
            kind: SymbolKind.Method,
            range: { start: { line: 3, character: 2 }, end: { line: 6, character: 3 } },
            selectionRange: { start: { line: 3, character: 8 }, end: { line: 3, character: 21 } },
          },
          {
            name: "process",
            kind: SymbolKind.Method,
            range: { start: { line: 8, character: 2 }, end: { line: 10, character: 3 } },
            selectionRange: { start: { line: 8, character: 10 }, end: { line: 8, character: 17 } },
          },
        ],
      },
    ];
    const result = await shaper.shapeSymbols(
      hierarchicalSymbols as any,
      { includeKind: true, includeContainer: true },
      testFile
    );
    expect(result.length).toBe(3); // MyService + handleRequest + process
    expect(result[0].symbol).toBe("MyService");
    expect(result[0].kind).toBe("class");
    expect(result[0].container).toBeUndefined();
    expect(result[1].symbol).toBe("handleRequest");
    expect(result[1].kind).toBe("method");
    expect(result[1].container).toBe("MyService");
    expect(result[2].symbol).toBe("process");
    expect(result[2].container).toBe("MyService");
  });

  test("extracts docstring from JSDoc comment", async () => {
    const docFile = join(tmpDir, "documented.ts");
    writeFileSync(
      docFile,
      `/**
 * Processes an incoming request.
 */
export function handleRequest(req: Request): Response {
  return new Response("ok");
}
`
    );
    const result = await shaper.shapeDefinition(
      [{ uri: `file://${docFile}`, range: { start: { line: 3, character: 16 }, end: { line: 3, character: 29 } } }],
      { includeDocstring: true }
    );
    expect(result[0].docstring).toContain("Processes an incoming request");
  });

  test("snippet is 3 lines: definition + 2 below", async () => {
    const result = await shaper.shapeDefinition(
      [{ uri: `file://${testFile}`, range: { start: { line: 3, character: 8 }, end: { line: 3, character: 21 } } }],
      {}
    );
    const lines = result[0].snippet.split("\n");
    expect(lines.length).toBe(3);
  });
});
