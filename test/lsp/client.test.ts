import { describe, test, expect, mock, beforeEach } from "bun:test";
import { LspClient } from "../../src/lsp/client";

describe("LspClient", () => {
  test("tracks open documents", () => {
    const client = new LspClient.__testing.createDocumentTracker();
    expect(client.isOpen("file:///test.ts")).toBe(false);
    client.markOpen("file:///test.ts");
    expect(client.isOpen("file:///test.ts")).toBe(true);
  });

  test("converts file path to URI", () => {
    const uri = LspClient.fileToUri("/home/user/project/src/index.ts");
    expect(uri).toBe("file:///home/user/project/src/index.ts");
  });

  test("converts 1-based line/column to 0-based LSP position", () => {
    const pos = LspClient.toLspPosition(10, 5);
    expect(pos.line).toBe(9);
    expect(pos.character).toBe(4);
  });

  test("parses a complete JSON-RPC message from buffer", () => {
    const parser = new LspClient.__testing.createBufferParser();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const messages = parser.feed(Buffer.from(frame));
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(1);
    expect(messages[0].result.ok).toBe(true);
  });

  test("handles partial messages across multiple chunks", () => {
    const parser = new LspClient.__testing.createBufferParser();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, result: "hello" });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const buf = Buffer.from(frame);

    // Feed first half
    const msg1 = parser.feed(buf.subarray(0, 10));
    expect(msg1.length).toBe(0);

    // Feed second half
    const msg2 = parser.feed(buf.subarray(10));
    expect(msg2.length).toBe(1);
    expect(msg2[0].id).toBe(2);
  });

  test("handles multi-byte UTF-8 characters correctly", () => {
    const parser = new LspClient.__testing.createBufferParser();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 3, result: "héllo wörld" });
    const bodyBytes = Buffer.from(body, "utf-8");
    // Content-Length must be byte length, not string length
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${bodyBytes.length}\r\n\r\n`),
      bodyBytes,
    ]);
    const messages = parser.feed(frame);
    expect(messages.length).toBe(1);
    expect(messages[0].result).toBe("héllo wörld");
  });
});
