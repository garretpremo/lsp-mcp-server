import { spawn, type Subprocess } from "bun";
import { readFile } from "fs/promises";
import type {
  InitializeParams,
  InitializeResult,
  DefinitionParams,
  ReferenceParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  Location,
  LocationLink,
  SymbolInformation,
  DocumentSymbol,
  Position,
} from "vscode-languageserver-protocol";

export interface LspClientOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  rootUri: string;
  timeout: number;
}

class DocumentTracker {
  private openDocs = new Set<string>();

  isOpen(uri: string): boolean {
    return this.openDocs.has(uri);
  }

  markOpen(uri: string): void {
    this.openDocs.add(uri);
  }

  markClosed(uri: string): void {
    this.openDocs.delete(uri);
  }

  allOpen(): string[] {
    return [...this.openDocs];
  }
}

export class LspClient {
  private process: Subprocess | null = null;
  private options: LspClientOptions;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer: Buffer = Buffer.alloc(0);
  private initialized = false;
  private exited = false;
  private documents = new DocumentTracker();

  constructor(options: LspClientOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.process = spawn({
      cmd: [this.options.command, ...this.options.args],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...this.options.env },
    });

    // Track process exit for crash detection
    this.process.exited.then(() => {
      this.exited = true;
    });

    // Read stdout in background
    this.readStdout();

    // Initialize handshake
    const initParams: InitializeParams = {
      processId: process.pid,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
        },
        workspace: {
          symbol: { dynamicRegistration: false },
        },
      },
      rootUri: this.options.rootUri,
      rootPath: this.options.rootUri.replace("file://", ""),
    };

    await this.sendRequest("initialize", initParams);
    await this.sendNotification("initialized", {});
    this.initialized = true;
  }

  async ensureDocumentOpen(filePath: string): Promise<void> {
    const uri = LspClient.fileToUri(filePath);
    if (this.documents.isOpen(uri)) return;

    const content = await readFile(filePath, "utf-8");
    const ext = filePath.split(".").pop() ?? "";
    const langId = this.getLanguageId(ext);

    await this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: langId,
        version: 1,
        text: content,
      },
    });

    this.documents.markOpen(uri);
  }

  async definition(
    filePath: string,
    line: number,
    column: number
  ): Promise<Location | Location[] | LocationLink[] | null> {
    await this.ensureDocumentOpen(filePath);
    const params: DefinitionParams = {
      textDocument: { uri: LspClient.fileToUri(filePath) },
      position: LspClient.toLspPosition(line, column),
    };
    return this.sendRequest("textDocument/definition", params);
  }

  async references(
    filePath: string,
    line: number,
    column: number
  ): Promise<Location[] | null> {
    await this.ensureDocumentOpen(filePath);
    const params: ReferenceParams = {
      textDocument: { uri: LspClient.fileToUri(filePath) },
      position: LspClient.toLspPosition(line, column),
      context: { includeDeclaration: true },
    };
    return this.sendRequest("textDocument/references", params);
  }

  async documentSymbols(
    filePath: string
  ): Promise<SymbolInformation[] | DocumentSymbol[] | null> {
    await this.ensureDocumentOpen(filePath);
    const params: DocumentSymbolParams = {
      textDocument: { uri: LspClient.fileToUri(filePath) },
    };
    return this.sendRequest("textDocument/documentSymbol", params);
  }

  async workspaceSymbols(
    query: string
  ): Promise<SymbolInformation[] | null> {
    const params: WorkspaceSymbolParams = { query };
    return this.sendRequest("workspace/symbol", params);
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    for (const uri of this.documents.allOpen()) {
      await this.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
      this.documents.markClosed(uri);
    }

    try {
      await this.sendRequest("shutdown", null);
      await this.sendNotification("exit", null);
    } catch {
      this.process.kill();
    }

    this.process = null;
    this.initialized = false;
  }

  get isAlive(): boolean {
    return this.process !== null && this.initialized && !this.exited;
  }

  static fileToUri(filePath: string): string {
    return `file://${filePath}`;
  }

  static toLspPosition(line: number, column: number): Position {
    return { line: line - 1, character: column - 1 };
  }

  static __testing = {
    createDocumentTracker: DocumentTracker,
    createBufferParser: class BufferParser {
      private buffer = Buffer.alloc(0);
      private static readonly DELIMITER = Buffer.from("\r\n\r\n");

      feed(chunk: Buffer): any[] {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const messages: any[] = [];
        while (true) {
          const headerEnd = this.buffer.indexOf(BufferParser.DELIMITER);
          if (headerEnd === -1) break;
          const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue; }
          const contentLength = parseInt(match[1], 10);
          const contentStart = headerEnd + 4;
          if (this.buffer.length < contentStart + contentLength) break;
          const content = this.buffer.subarray(contentStart, contentStart + contentLength).toString("utf-8");
          this.buffer = this.buffer.subarray(contentStart + contentLength);
          try { messages.push(JSON.parse(content)); } catch {}
        }
        return messages;
      }
    },
  };

  private getLanguageId(ext: string): string {
    const map: Record<string, string> = {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
      java: "java",
    };
    return map[ext] ?? ext;
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.writeMessage(message);
    });
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    const message = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.writeMessage(message);
  }

  private writeMessage(json: string): void {
    if (!this.process?.stdin) {
      throw new Error("LSP process not running");
    }
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    this.process.stdin.write(header + json);
  }

  private async readStdout(): Promise<void> {
    if (!this.process?.stdout) return;

    const reader = this.process.stdout.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = Buffer.from(value);
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      }
    } catch {
      // Process died — pending requests will timeout
    }
  }

  private static readonly HEADER_DELIMITER = Buffer.from("\r\n\r\n");

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf(LspClient.HEADER_DELIMITER);
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;

      if (this.buffer.length < contentStart + contentLength) {
        return;
      }

      const content = this.buffer.subarray(
        contentStart,
        contentStart + contentLength
      ).toString("utf-8");
      this.buffer = this.buffer.subarray(contentStart + contentLength);

      try {
        const msg = JSON.parse(content);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id)!;
          clearTimeout(timer);
          this.pending.delete(msg.id);

          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Malformed JSON — skip
      }
    }
  }
}
