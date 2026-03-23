# lsp-mcp-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight MCP server that provides type-aware code navigation and fast file search by wrapping language servers and an in-memory file index.

**Architecture:** Bun/TypeScript stdio MCP server with four layers — MCP tool registry, LSP manager (spawns/pools language servers), response shaper (compact output with optional enrichment), and file indexer (in-memory fuzzy file search). Also packaged as a Claude Code plugin.

**Tech Stack:** Bun runtime, TypeScript, `@modelcontextprotocol/sdk`, `vscode-languageserver-protocol`, `ignore` (gitignore parsing), `bun test`

**Spec:** `docs/superpowers/specs/2026-03-22-lsp-mcp-server-design.md`

---

## File Structure

```
lsp-mcp-server/
├── src/
│   ├── index.ts                # CLI entry point — parses --project, starts MCP server
│   ├── config.ts               # Loads/validates config.json, provides defaults
│   ├── mcp/
│   │   └── server.ts           # MCP server setup, tool registration & dispatch
│   ├── lsp/
│   │   ├── manager.ts          # LSP lifecycle, auto-detect language, pool instances
│   │   ├── client.ts           # LSP client — JSON-RPC over stdio to a single LSP
│   │   └── response-shaper.ts  # Trims LSP responses, reads files for snippets
│   └── indexer/
│       ├── file-indexer.ts     # File tree walker, .gitignore + hardcoded ignores
│       └── fuzzy-match.ts      # Fuzzy file name matching and scoring
├── test/
│   ├── indexer/
│   │   ├── file-indexer.test.ts
│   │   └── fuzzy-match.test.ts
│   ├── lsp/
│   │   ├── client.test.ts
│   │   ├── manager.test.ts
│   │   └── response-shaper.test.ts
│   ├── config.test.ts
│   └── fixtures/               # Test fixture files (sample projects, configs)
│       ├── sample-ts-project/
│       │   ├── tsconfig.json
│       │   ├── src/
│       │   │   ├── index.ts
│       │   │   └── service.ts
│       │   └── .gitignore
│       └── sample-config.json
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── .mcp.json
│   └── skills/
│       └── lsp-search/
│           └── SKILL.md
├── package.json
├── tsconfig.json
└── README.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts` (stub)
- Create: `.gitignore`

- [ ] **Step 1: Initialize project with bun**

```bash
cd /home/gpremo-re/projects/lsp-mcp-server
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add @modelcontextprotocol/sdk vscode-languageserver-protocol ignore
```

- [ ] **Step 3: Update tsconfig.json**

Set `tsconfig.json` to:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Update .gitignore**

Ensure `.gitignore` includes:
```
node_modules/
dist/
*.log
```

- [ ] **Step 5: Write stub entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env bun

console.error("lsp-mcp-server starting...");
```

- [ ] **Step 6: Verify bun runs the entry point**

```bash
bun run src/index.ts
```
Expected: prints "lsp-mcp-server starting..." to stderr.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json bun.lock .gitignore src/index.ts
git commit -m "chore: scaffold project with bun and dependencies"
```

---

### Task 2: Fuzzy File Matching

**Files:**
- Create: `src/indexer/fuzzy-match.ts`
- Create: `test/indexer/fuzzy-match.test.ts`

This is a pure function with no dependencies — good starting point.

- [ ] **Step 1: Write the failing tests**

`test/indexer/fuzzy-match.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/indexer/fuzzy-match.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fuzzyMatch**

`src/indexer/fuzzy-match.ts`:
```typescript
/**
 * Scores a file path against a query string.
 * Higher score = better match.
 * Returns 0 for no match.
 */
function score(filePath: string, queryLower: string): number {
  const fileName = filePath.split("/").pop() ?? "";
  const fileNameLower = fileName.toLowerCase();
  const pathLower = filePath.toLowerCase();

  // No match at all
  if (!pathLower.includes(queryLower)) {
    return 0;
  }

  let s = 1;

  // Filename contains query — boost
  if (fileNameLower.includes(queryLower)) {
    s += 10;
  }

  // Filename starts with query — bigger boost
  if (fileNameLower.startsWith(queryLower)) {
    s += 5;
  }

  // Exact filename (minus extension) — biggest boost
  const nameWithoutExt = fileNameLower.replace(/\.[^.]+$/, "");
  if (nameWithoutExt === queryLower) {
    s += 20;
  }

  return s;
}

/**
 * Fuzzy-match a query against a list of file paths.
 * Returns matched paths sorted by relevance (best first).
 * Case-insensitive. Filename matches rank above directory-only matches.
 */
export function fuzzyMatch(
  files: string[],
  query: string,
  maxResults: number = 10
): string[] {
  const queryLower = query.toLowerCase();

  return files
    .map((f) => ({ path: f, score: score(f, queryLower) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((r) => r.path);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/indexer/fuzzy-match.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/fuzzy-match.ts test/indexer/fuzzy-match.test.ts
git commit -m "feat: add fuzzy file matching"
```

---

### Task 3: File Indexer

**Files:**
- Create: `src/indexer/file-indexer.ts`
- Create: `test/indexer/file-indexer.test.ts`
- Create: `test/fixtures/sample-ts-project/` (test fixture)

Depends on: Task 2 (fuzzy-match).

- [ ] **Step 1: Create test fixtures**

Create the following fixture directory structure:
```
test/fixtures/sample-ts-project/
├── .gitignore          # contains: "ignored-dir/"
├── tsconfig.json       # empty {}
├── src/
│   ├── index.ts        # export const main = true;
│   └── service.ts      # export class Service {}
├── node_modules/
│   └── dep/
│       └── index.js    # should be ignored
└── ignored-dir/
    └── secret.ts       # should be ignored by .gitignore
```

- [ ] **Step 2: Write the failing tests**

`test/indexer/file-indexer.test.ts`:
```typescript
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
    // Full reindex should work without error
    const stats = await indexer.index();
    expect(stats.indexedFiles).toBeGreaterThan(0);
    expect(stats.duration).toBeGreaterThanOrEqual(0);
  });

  test("reindex with path only re-indexes that subtree", async () => {
    const stats = await indexer.index("src");
    expect(stats.indexedFiles).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test test/indexer/file-indexer.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement FileIndexer**

`src/indexer/file-indexer.ts`:
```typescript
import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import ignore, { type Ignore } from "ignore";
import { fuzzyMatch } from "./fuzzy-match";

const HARDCODED_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  "__pycache__",
  ".cache",
];

export interface FileSearchResult {
  file: string;
  relativePath: string;
}

export interface IndexStats {
  indexedFiles: number;
  duration: number;
}

export class FileIndexer {
  private root: string;
  private files: string[] = [];  // relative paths
  private ig: Ignore = ignore();

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Build or rebuild the file index.
   * If subPath is provided, only re-index that subtree.
   */
  async index(subPath?: string): Promise<IndexStats> {
    const start = performance.now();

    if (!subPath) {
      // Full reindex
      this.ig = ignore();
      this.ig.add(HARDCODED_IGNORES);
      await this.loadGitignore();
      this.files = [];
      await this.walk("");
    } else {
      // Partial reindex — remove old entries for this subtree, re-walk
      const prefix = subPath.endsWith("/") ? subPath : subPath + "/";
      this.files = this.files.filter(
        (f) => !f.startsWith(prefix) && f !== subPath
      );
      await this.walk(subPath);
    }

    const duration = Math.round(performance.now() - start);
    return { indexedFiles: this.files.length, duration };
  }

  /**
   * Fuzzy search for files by name.
   */
  search(query: string, maxResults: number = 10): FileSearchResult[] {
    const matched = fuzzyMatch(this.files, query, maxResults);
    return matched.map((relativePath) => ({
      file: join(this.root, relativePath),
      relativePath,
    }));
  }

  private async loadGitignore(): Promise<void> {
    try {
      const content = await readFile(join(this.root, ".gitignore"), "utf-8");
      this.ig.add(content);
    } catch {
      // No .gitignore — that's fine
    }
  }

  private async walk(dir: string): Promise<void> {
    const fullDir = join(this.root, dir);
    let entries;
    try {
      entries = await readdir(fullDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = dir ? `${dir}/${entry.name}` : entry.name;

      if (this.ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walk(relativePath);
      } else if (entry.isFile()) {
        this.files.push(relativePath);
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test test/indexer/file-indexer.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/file-indexer.ts test/indexer/ test/fixtures/
git commit -m "feat: add file indexer with gitignore support"
```

---

### Task 4: Configuration Loading

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`
- Create: `test/fixtures/sample-config.json`

- [ ] **Step 1: Create test fixture**

`test/fixtures/sample-config.json`:
```json
{
  "languageServers": {
    "typescript": {
      "command": "custom-ts-server",
      "args": ["--stdio", "--verbose"]
    }
  },
  "requestTimeout": 5000
}
```

- [ ] **Step 2: Write the failing tests**

`test/config.test.ts`:
```typescript
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
    // Test the static mapping
    const config = loadConfig.defaults();
    expect(config.languageForExtension(".ts")).toBe("typescript");
    expect(config.languageForExtension(".java")).toBe("java");
    expect(config.languageForExtension(".rs")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test test/config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement config loading**

`src/config.ts`:
```typescript
import { readFile } from "fs/promises";
import { join } from "path";

export interface LanguageServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Config {
  languageServers: Record<string, LanguageServerConfig>;
  requestTimeout: number;
  languageForExtension(ext: string): string | undefined;
}

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".java": "java",
};

const DEFAULTS: {
  languageServers: Record<string, LanguageServerConfig>;
  requestTimeout: number;
} = {
  languageServers: {
    typescript: {
      command: "typescript-language-server",
      args: ["--stdio"],
    },
    java: {
      command: "jdtls",
      args: [],
    },
  },
  requestTimeout: 10000,
};

function buildConfig(overrides?: Partial<typeof DEFAULTS>): Config {
  const languageServers = { ...DEFAULTS.languageServers };

  if (overrides?.languageServers) {
    for (const [lang, cfg] of Object.entries(overrides.languageServers)) {
      languageServers[lang] = { ...DEFAULTS.languageServers[lang], ...cfg };
    }
  }

  const requestTimeout = overrides?.requestTimeout ?? DEFAULTS.requestTimeout;

  return {
    languageServers,
    requestTimeout,
    languageForExtension(ext: string): string | undefined {
      return EXTENSION_MAP[ext];
    },
  };
}

/**
 * Load config from a config.json file in the given directory.
 * Falls back to defaults if file does not exist.
 */
export async function loadConfig(
  projectRoot: string,
  filename: string = "config.json"
): Promise<Config> {
  try {
    const raw = await readFile(join(projectRoot, filename), "utf-8");
    const parsed = JSON.parse(raw);
    return buildConfig(parsed);
  } catch {
    return buildConfig();
  }
}

// Static access to defaults for testing
loadConfig.defaults = (): Config => buildConfig();
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test test/config.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts test/fixtures/sample-config.json
git commit -m "feat: add config loading with defaults and overrides"
```

---

### Task 5: LSP Client

**Files:**
- Create: `src/lsp/client.ts`
- Create: `test/lsp/client.test.ts`

This is the JSON-RPC communication layer with a single LSP process. Testing strategy: mock the child process stdio to verify correct JSON-RPC messages are sent/received.

- [ ] **Step 1: Write the failing tests**

`test/lsp/client.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/lsp/client.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LspClient**

`src/lsp/client.ts`:

The LSP client manages a single language server child process. It handles:
- Spawning the process with stdio pipes
- JSON-RPC message framing (Content-Length headers)
- `initialize`/`initialized` handshake
- `textDocument/didOpen` / `textDocument/didClose` tracking
- Sending requests with timeout support
- Graceful shutdown

```typescript
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

  /**
   * Spawn the language server process and perform the initialize handshake.
   */
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

  /**
   * Ensure a document is open. Reads the file and sends didOpen if needed.
   */
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

  /**
   * Graceful shutdown: close all docs, then shutdown + exit.
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    // Close all open documents
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
      // Force kill if shutdown fails
      this.process.kill();
    }

    this.process = null;
    this.initialized = false;
  }

  get isAlive(): boolean {
    return this.process !== null && this.initialized && !this.exited;
  }

  // --- Static helpers ---

  static fileToUri(filePath: string): string {
    return `file://${filePath}`;
  }

  static toLspPosition(line: number, column: number): Position {
    return { line: line - 1, character: column - 1 };
  }

  // Exposed for testing
  static __testing = {
    createDocumentTracker: () => new DocumentTracker(),
    createBufferParser: () => {
      let buffer = Buffer.alloc(0);
      const DELIMITER = Buffer.from("\r\n\r\n");
      return {
        feed(chunk: Buffer): any[] {
          buffer = Buffer.concat([buffer, chunk]);
          const messages: any[] = [];
          while (true) {
            const headerEnd = buffer.indexOf(DELIMITER);
            if (headerEnd === -1) break;
            const header = buffer.subarray(0, headerEnd).toString("utf-8");
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
            const contentLength = parseInt(match[1], 10);
            const contentStart = headerEnd + 4;
            if (buffer.length < contentStart + contentLength) break;
            const content = buffer.subarray(contentStart, contentStart + contentLength).toString("utf-8");
            buffer = buffer.subarray(contentStart + contentLength);
            try { messages.push(JSON.parse(content)); } catch {}
          }
          return messages;
        },
      };
    },
  };

  // --- Private ---

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

        // Append raw bytes to buffer (preserves byte-length accuracy)
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
        // Malformed — skip to after the header
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;

      if (this.buffer.length < contentStart + contentLength) {
        return; // Not enough data yet — byte-length comparison is correct now
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
        // Notifications from server are ignored
      } catch {
        // Malformed JSON — skip
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/lsp/client.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lsp/client.ts test/lsp/client.test.ts
git commit -m "feat: add LSP client with JSON-RPC over stdio"
```

---

### Task 6: Response Shaper

**Files:**
- Create: `src/lsp/response-shaper.ts`
- Create: `test/lsp/response-shaper.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/lsp/response-shaper.test.ts`:
```typescript
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
    // Create a file with JSDoc
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
      [{ uri: \`file://\${docFile}\`, range: { start: { line: 3, character: 16 }, end: { line: 3, character: 29 } } }],
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/lsp/response-shaper.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ResponseShaper**

`src/lsp/response-shaper.ts`:
```typescript
import { readFile } from "fs/promises";
import { SymbolKind } from "vscode-languageserver-protocol";
import type {
  Location,
  LocationLink,
  SymbolInformation,
  DocumentSymbol,
} from "vscode-languageserver-protocol";

export interface EnrichmentFlags {
  includeKind?: boolean;
  includeContainer?: boolean;
  includeDocstring?: boolean;
}

export interface ShapedResult {
  file: string;
  line: number;
  symbol: string;
  snippet: string;
  kind?: string;
  container?: string;
  docstring?: string;
}

const SNIPPET_LINES = 3;

const SYMBOL_KIND_NAMES: Record<number, string> = {
  [SymbolKind.File]: "file",
  [SymbolKind.Module]: "module",
  [SymbolKind.Namespace]: "namespace",
  [SymbolKind.Package]: "package",
  [SymbolKind.Class]: "class",
  [SymbolKind.Method]: "method",
  [SymbolKind.Property]: "property",
  [SymbolKind.Field]: "field",
  [SymbolKind.Constructor]: "constructor",
  [SymbolKind.Enum]: "enum",
  [SymbolKind.Interface]: "interface",
  [SymbolKind.Function]: "function",
  [SymbolKind.Variable]: "variable",
  [SymbolKind.Constant]: "constant",
  [SymbolKind.String]: "string",
  [SymbolKind.Number]: "number",
  [SymbolKind.Boolean]: "boolean",
  [SymbolKind.Array]: "array",
  [SymbolKind.Object]: "object",
  [SymbolKind.Key]: "key",
  [SymbolKind.Null]: "null",
  [SymbolKind.EnumMember]: "enum-member",
  [SymbolKind.Struct]: "struct",
  [SymbolKind.Event]: "event",
  [SymbolKind.Operator]: "operator",
  [SymbolKind.TypeParameter]: "type-parameter",
};

// File cache is scoped per ResponseShaper instance and cleared on each request batch
// to avoid serving stale snippets when files change on disk during a session.

function uriToPath(uri: string): string {
  return uri.replace("file://", "");
}

// buildSnippet is an instance method on ResponseShaper (see below)

function extractSymbolName(
  filePath: string,
  line: string,
  character: number
): string {
  // Extract the word at the given character position
  const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  let match;
  while ((match = wordRegex.exec(line)) !== null) {
    if (
      character >= match.index &&
      character < match.index + match[0].length
    ) {
      return match[0];
    }
  }
  // Fallback: try to find any identifier near the position
  const segment = line.substring(character);
  const fallback = segment.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
  return fallback ? fallback[0] : "unknown";
}

export class ResponseShaper {
  private projectRoot: string;
  private fileCache = new Map<string, string[]>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Clear the file cache. Call between request batches if files may have changed.
   */
  clearCache(): void {
    this.fileCache.clear();
  }

  private async getFileLines(filePath: string): Promise<string[]> {
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    this.fileCache.set(filePath, lines);
    return lines;
  }

  /**
   * Extract JSDoc/Javadoc comment block immediately above a line.
   */
  private async extractDocstring(
    filePath: string,
    lineZeroBased: number
  ): Promise<string | undefined> {
    const lines = await this.getFileLines(filePath);
    // Walk backwards from the line above to find a doc comment
    let end = lineZeroBased - 1;
    // Skip blank lines
    while (end >= 0 && lines[end].trim() === "") end--;
    if (end < 0) return undefined;

    // Check if we're at the end of a block comment
    if (!lines[end].trim().endsWith("*/")) return undefined;

    // Walk back to find the start of the comment
    let start = end;
    while (start >= 0 && !lines[start].trim().startsWith("/**")) {
      start--;
    }
    if (start < 0) return undefined;

    // Extract and clean up the comment
    return lines
      .slice(start, end + 1)
      .map((l) => l.trim().replace(/^\/\*\*\s?/, "").replace(/^\*\/\s?$/, "").replace(/^\*\s?/, ""))
      .filter((l) => l.length > 0)
      .join(" ");
  }

  private async buildSnippet(
    filePath: string,
    lineZeroBased: number
  ): Promise<string> {
    const lines = await this.getFileLines(filePath);
    const start = lineZeroBased;
    const end = Math.min(start + SNIPPET_LINES, lines.length);
    return lines.slice(start, end).join("\n");
  }

  /**
   * Shape definition/reference locations into compact results.
   */
  async shapeDefinition(
    locations: (Location | LocationLink)[] | Location | null,
    flags: EnrichmentFlags
  ): Promise<ShapedResult[]> {
    if (!locations) return [];

    const locs = Array.isArray(locations) ? locations : [locations];
    const results: ShapedResult[] = [];

    for (const loc of locs) {
      const uri = "targetUri" in loc ? loc.targetUri : loc.uri;
      const range =
        "targetSelectionRange" in loc
          ? loc.targetSelectionRange
          : loc.range;

      const filePath = uriToPath(uri);
      const lineZeroBased = range.start.line;
      const lines = await this.getFileLines(filePath);
      const lineContent = lines[lineZeroBased] ?? "";

      const result: ShapedResult = {
        file: filePath,
        line: lineZeroBased + 1,
        symbol: extractSymbolName(
          filePath,
          lineContent,
          range.start.character
        ),
        snippet: await this.buildSnippet(filePath, lineZeroBased),
      };

      // Enrichment flags for definition/reference results.
      // Kind and container are not available from Location/LocationLink —
      // we'd need a follow-up hover or documentSymbol request.
      // For now, only includeDocstring is feasible (read JSDoc above the line).
      if (flags.includeDocstring) {
        result.docstring = await this.extractDocstring(filePath, lineZeroBased);
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Shape symbol information (from documentSymbol or workspaceSymbol).
   */
  async shapeSymbols(
    symbols: (SymbolInformation | DocumentSymbol)[] | null,
    flags: EnrichmentFlags,
    filePathOverride?: string
  ): Promise<ShapedResult[]> {
    if (!symbols) return [];

    const results: ShapedResult[] = [];
    const flatSymbols = this.flattenSymbols(symbols);

    for (const sym of flatSymbols) {
      const filePath =
        "location" in sym
          ? uriToPath(sym.location.uri)
          : filePathOverride ?? "";
      const lineZeroBased =
        "location" in sym
          ? sym.location.range.start.line
          : sym.selectionRange?.start.line ?? sym.range.start.line;

      const result: ShapedResult = {
        file: filePath,
        line: lineZeroBased + 1,
        symbol: sym.name,
        snippet: filePath
          ? await this.buildSnippet(filePath, lineZeroBased)
          : "",
      };

      if (flags.includeKind && sym.kind) {
        result.kind = SYMBOL_KIND_NAMES[sym.kind] ?? "unknown";
      }

      if (flags.includeContainer) {
        if ("containerName" in sym && sym.containerName) {
          result.container = sym.containerName;
        } else if ("_container" in sym) {
          result.container = (sym as any)._container;
        }
      }

      if (flags.includeDocstring) {
        result.docstring = await this.extractDocstring(filePath, lineZeroBased);
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Flatten hierarchical DocumentSymbol[] into a flat list.
   * Adds _container field for parent tracking.
   */
  private flattenSymbols(
    symbols: (SymbolInformation | DocumentSymbol)[],
    container?: string
  ): (SymbolInformation | (DocumentSymbol & { _container?: string }))[] {
    const flat: any[] = [];

    for (const sym of symbols) {
      if (container) {
        (sym as any)._container = container;
      }
      flat.push(sym);

      // DocumentSymbol has children
      if ("children" in sym && sym.children) {
        flat.push(...this.flattenSymbols(sym.children, sym.name));
      }
    }

    return flat;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/lsp/response-shaper.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lsp/response-shaper.ts test/lsp/response-shaper.test.ts
git commit -m "feat: add response shaper for compact LSP output"
```

---

### Task 7: LSP Manager

**Files:**
- Create: `src/lsp/manager.ts`
- Create: `test/lsp/manager.test.ts`

Depends on: Task 4 (config), Task 5 (LspClient).

- [ ] **Step 1: Write the failing tests**

`test/lsp/manager.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/lsp/manager.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LspManager**

`src/lsp/manager.ts`:
```typescript
import { createHash } from "crypto";
import { extname } from "path";
import { mkdirSync } from "fs";
import { LspClient, type LspClientOptions } from "./client";
import type { Config } from "../config";

export class LspManager {
  private config: Config;
  private projectRoot: string;
  private clients = new Map<string, LspClient>();
  private starting = new Map<string, Promise<LspClient>>();

  constructor(config: Config, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Get the language name for a file path. Returns undefined if unsupported.
   */
  languageFor(filePath: string): string | undefined {
    const ext = extname(filePath);
    return this.config.languageForExtension(ext);
  }

  /**
   * Check if a file's language is supported.
   */
  isSupported(filePath: string): boolean {
    return this.languageFor(filePath) !== undefined;
  }

  /**
   * Get or start a language server client for a file.
   * Throws if the language is not supported.
   */
  async getClient(filePath: string): Promise<LspClient> {
    const language = this.languageFor(filePath);
    if (!language) {
      throw new Error(
        `No language server available for ${extname(filePath)} files. Configure one in config.json.`
      );
    }

    // Return existing client if alive
    const existing = this.clients.get(language);
    if (existing?.isAlive) {
      return existing;
    }

    // If already starting, wait for it
    const pending = this.starting.get(language);
    if (pending) {
      return pending;
    }

    // Start a new client
    const startPromise = this.startClient(language);
    this.starting.set(language, startPromise);

    try {
      const client = await startPromise;
      this.clients.set(language, client);
      return client;
    } finally {
      this.starting.delete(language);
    }
  }

  /**
   * Generate the JDT LS workspace directory path for the current project.
   */
  javaWorkspaceDir(): string {
    const hash = createHash("md5")
      .update(this.projectRoot)
      .digest("hex")
      .substring(0, 8);
    return `/tmp/jdtls-workspace-${hash}`;
  }

  /**
   * Shut down all running language servers.
   */
  async shutdown(): Promise<void> {
    const stops = [...this.clients.values()].map((c) => c.stop());
    await Promise.allSettled(stops);
    this.clients.clear();
  }

  private async startClient(language: string): Promise<LspClient> {
    const serverConfig = this.config.languageServers[language];
    if (!serverConfig) {
      throw new Error(
        `No language server configured for '${language}'. Add it to config.json.`
      );
    }

    const env = { ...serverConfig.env };
    const args = [...serverConfig.args];

    // Java-specific: add workspace dir
    if (language === "java") {
      const wsDir = this.javaWorkspaceDir();
      mkdirSync(wsDir, { recursive: true });
      if (!args.includes("-data")) {
        args.push("-data", wsDir);
      }
    }

    const options: LspClientOptions = {
      command: serverConfig.command,
      args,
      env,
      rootUri: `file://${this.projectRoot}`,
      timeout: this.config.requestTimeout,
    };

    const client = new LspClient(options);

    try {
      await client.start();
    } catch (err) {
      throw new Error(
        `Failed to start '${language}' language server ('${serverConfig.command}'). Is it installed? Error: ${err}`
      );
    }

    return client;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/lsp/manager.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lsp/manager.ts test/lsp/manager.test.ts
git commit -m "feat: add LSP manager with auto-detection and pooling"
```

---

### Task 8: MCP Server — Tool Registration & Dispatch

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `src/index.ts`

Depends on: Tasks 3, 4, 6, 7 (all layers).

This task wires everything together — the MCP server layer that registers tools and dispatches to the right layer.

- [ ] **Step 1: Implement MCP server with tool registration**

`src/mcp/server.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";  // MCP SDK includes zod
import { FileIndexer } from "../indexer/file-indexer";
import { LspManager } from "../lsp/manager";
import { ResponseShaper, type EnrichmentFlags } from "../lsp/response-shaper";
import type { Config } from "../config";

export async function createServer(
  projectRoot: string,
  config: Config
): Promise<McpServer> {
  const indexer = new FileIndexer(projectRoot);
  const lspManager = new LspManager(config, projectRoot);
  const shaper = new ResponseShaper(projectRoot);

  // Index files on startup
  const indexStats = await indexer.index();
  console.error(
    `Indexed ${indexStats.indexedFiles} files in ${indexStats.duration}ms`
  );

  const server = new McpServer({
    name: "lsp-mcp-server",
    version: "0.1.0",
  });

  // --- File Search Tools ---

  server.tool(
    "find_file",
    "Fuzzy file name search against the project file index",
    {
      query: z.string().describe("Fuzzy match against file names"),
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe("Max results to return"),
    },
    async ({ query, maxResults }) => {
      const results = indexer.search(query, maxResults);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "reindex",
    "Rebuild the file index (full or partial)",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Directory to re-index. If omitted, re-indexes entire project."
        ),
    },
    async ({ path }) => {
      const stats = await indexer.index(path);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats),
          },
        ],
      };
    }
  );

  // --- LSP Navigation Tools ---

  const enrichmentSchema = {
    includeKind: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include symbol kind (class, method, etc.)"),
    includeContainer: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include containing symbol name"),
    includeDocstring: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include documentation string"),
  };

  server.tool(
    "go_to_definition",
    "Jump to the definition of a symbol at a given position",
    {
      file: z.string().describe("Absolute file path"),
      line: z.number().describe("1-based line number"),
      column: z.number().describe("1-based column number"),
      ...enrichmentSchema,
    },
    async ({ file, line, column, ...flags }) => {
      try {
        const client = await lspManager.getClient(file);
        const locations = await client.definition(file, line, column);
        const results = await shaper.shapeDefinition(locations, flags);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "find_references",
    "Find all references to a symbol at a given position",
    {
      file: z.string().describe("Absolute file path"),
      line: z.number().describe("1-based line number"),
      column: z.number().describe("1-based column number"),
      maxResults: z.number().optional().default(20).describe("Max results"),
      ...enrichmentSchema,
    },
    async ({ file, line, column, maxResults, ...flags }) => {
      try {
        const client = await lspManager.getClient(file);
        const locations = await client.references(file, line, column);
        const shaped = await shaper.shapeDefinition(
          locations ? locations.slice(0, maxResults) : null,
          flags
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(shaped, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "document_symbols",
    "List all symbols in a file",
    {
      file: z.string().describe("Absolute file path"),
      ...enrichmentSchema,
    },
    async ({ file, ...flags }) => {
      try {
        const client = await lspManager.getClient(file);
        const symbols = await client.documentSymbols(file);
        const results = await shaper.shapeSymbols(symbols, flags, file);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "workspace_symbol",
    "Search for symbols across the entire project",
    {
      query: z.string().describe("Symbol name to search for"),
      maxResults: z.number().optional().default(20).describe("Max results"),
      ...enrichmentSchema,
    },
    async ({ query, maxResults, ...flags }) => {
      // workspace/symbol needs at least one LSP running.
      // We'll try all running clients and merge results.
      // For now, require the user to have opened at least one file first,
      // or we start the TS server by default.
      // This is a simplification — in practice the user will have
      // already used go_to_definition on some file.
      const results: any[] = [];
      // TODO: iterate all running clients
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await lspManager.shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await lspManager.shutdown();
    process.exit(0);
  });

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("lsp-mcp-server connected via stdio");
}
```

- [ ] **Step 2: Update entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env bun

import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./config";
import { createServer, startServer } from "./mcp/server";

function parseArgs(): { project: string } {
  const args = process.argv.slice(2);
  let project: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1];
      i++;
    }
  }

  if (!project) {
    console.error("Usage: lsp-mcp-server --project <path>");
    process.exit(1);
  }

  const resolved = resolve(project);
  if (!existsSync(resolved)) {
    console.error(`Error: project path does not exist: ${resolved}`);
    process.exit(1);
  }

  return { project: resolved };
}

async function main() {
  const { project } = parseArgs();
  console.error(`lsp-mcp-server starting for project: ${project}`);

  const config = await loadConfig(project);
  const server = await createServer(project, config);
  await startServer(server);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it starts (and exits cleanly with no --project)**

```bash
cd /home/gpremo-re/projects/lsp-mcp-server
bun run src/index.ts 2>&1
```
Expected: prints usage message and exits with code 1.

```bash
bun run src/index.ts --project /tmp 2>&1 &
sleep 1 && kill %1
```
Expected: starts, indexes files, connects via stdio, shuts down on SIGTERM.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts src/index.ts
git commit -m "feat: add MCP server with tool registration and CLI entry point"
```

---

### Task 9: workspace_symbol Implementation

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/lsp/manager.ts`

The `workspace_symbol` tool was stubbed in Task 8 because it needs to query all running LSP clients. Implement it properly.

- [ ] **Step 1: Add `allClients()` method to LspManager**

Add to `src/lsp/manager.ts`:
```typescript
/**
 * Get all currently running LSP clients.
 */
allClients(): LspClient[] {
  return [...this.clients.values()].filter((c) => c.isAlive);
}
```

- [ ] **Step 2: Update workspace_symbol tool in server.ts**

Replace the TODO stub in the `workspace_symbol` tool handler:

```typescript
async ({ query, maxResults, ...flags }) => {
  const clients = lspManager.allClients();
  if (clients.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: "No language servers are running. Use go_to_definition or document_symbols on a file first to start a language server."
        }),
      }],
    };
  }

  const allResults: any[] = [];
  for (const client of clients) {
    const symbols = await client.workspaceSymbols(query);
    if (symbols) {
      const shaped = await shaper.shapeSymbols(symbols, flags);
      allResults.push(...shaped);
    }
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(allResults.slice(0, maxResults), null, 2),
    }],
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts src/lsp/manager.ts
git commit -m "feat: implement workspace_symbol across all running LSP clients"
```

---

### Task 10: Claude Code Plugin Wrapper

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/.mcp.json`
- Create: `plugin/skills/lsp-search/SKILL.md`

- [ ] **Step 1: Create plugin manifest**

`plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "lsp-mcp-server",
  "version": "0.1.0",
  "description": "Lightweight MCP server providing type-aware code navigation and fast file search via language servers",
  "author": {
    "name": "Garret Premo"
  },
  "repository": "https://github.com/garretpremo/lsp-mcp-server",
  "license": "MIT",
  "keywords": ["lsp", "code-navigation", "file-search"]
}
```

- [ ] **Step 2: Create MCP server configuration**

`plugin/.mcp.json`:
```json
{
  "lsp-mcp-server": {
    "command": "bun",
    "args": ["run", "${CLAUDE_PLUGIN_ROOT}/../src/index.ts", "--project", "${CLAUDE_PROJECT_DIR}"]
  }
}
```

- [ ] **Step 3: Create skill documentation**

`plugin/skills/lsp-search/SKILL.md`:
```markdown
---
name: lsp-search
description: Use when navigating code semantically — finding definitions, references, or symbols by type-aware analysis rather than text search. Also use for fast fuzzy file search by name.
---

# LSP Code Navigation & File Search

This skill provides type-aware code navigation and fast file search via language server integration.

## When to Use

- **find_file** — When you need to locate a file by name but don't know the exact path. Faster than globbing. Use before `go_to_definition` when you don't have an absolute file path.
- **go_to_definition** — When you need to jump to where a symbol (class, function, variable) is defined. More accurate than grep for finding the actual definition vs. usages.
- **find_references** — When you need to find everywhere a symbol is used. Essential for understanding impact of changes.
- **document_symbols** — When you need to understand the structure of a file (classes, methods, fields). Prefer over grep for getting a file overview.
- **workspace_symbol** — When you need to find a symbol by name across the whole project without knowing which file it's in.

## When NOT to Use

- For text/string search — use Grep instead
- For finding files by glob pattern — use Glob instead
- For reading file contents — use Read instead

## Tips

- Start with `find_file` if you only have a partial file name
- Use enrichment flags (`includeKind`, `includeContainer`) when you need to distinguish between similarly-named symbols
- `workspace_symbol` requires at least one LSP to be running — use any other LSP tool first to start the language server
- The `reindex` tool refreshes the file index if files have been added/removed since the session started
```

- [ ] **Step 4: Commit**

```bash
git add plugin/
git commit -m "feat: add Claude Code plugin wrapper"
```

---

### Task 11: Package Configuration & README

**Files:**
- Modify: `package.json`
- Create: `README.md`

- [ ] **Step 1: Update package.json for publishing**

Update `package.json` with the `bin` field, description, repository, etc.:
```json
{
  "name": "lsp-mcp-server",
  "version": "0.1.0",
  "description": "Lightweight MCP server providing type-aware code navigation and fast file search via language servers",
  "bin": {
    "lsp-mcp-server": "./src/index.ts"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/garretpremo/lsp-mcp-server"
  },
  "author": "Garret Premo",
  "license": "MIT",
  "keywords": ["mcp", "lsp", "code-navigation", "language-server"]
}
```

Keep existing `dependencies` and `devDependencies` from `bun init`.

- [ ] **Step 2: Write README**

`README.md` should cover:
- What it does (one paragraph)
- Quick start (install, run with `--project`)
- Available tools (table with name + one-line description)
- Configuration (`config.json` example)
- Claude Code plugin setup
- Prerequisites (language servers must be installed)

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: add README and configure package.json for publishing"
```

---

### Task 12: Integration Test

**Files:**
- Create: `test/integration.test.ts`

End-to-end test that starts the MCP server against the test fixtures project and verifies the file indexer tools work. LSP tools are harder to integration-test without a real language server, so this focuses on `find_file` and `reindex`.

- [ ] **Step 1: Write integration test**

`test/integration.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run all tests**

```bash
bun test
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: add integration test for file indexer"
```

---

### Task 13: Push to GitHub

- [ ] **Step 1: Push all commits**

```bash
cd /home/gpremo-re/projects/lsp-mcp-server
git push -u origin main
```

- [ ] **Step 2: Verify repo on GitHub**

```bash
gh repo view garretpremo/lsp-mcp-server --web
```
