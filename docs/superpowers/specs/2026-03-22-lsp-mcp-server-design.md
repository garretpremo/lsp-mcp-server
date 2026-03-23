# lsp-mcp-server Design Spec

## Overview

A lightweight, local MCP server that provides type-aware code navigation and fast file search by wrapping language servers and an in-memory file index. Built with Bun/TypeScript. Responses are compact by default with optional metadata enrichment. Packaged as both a standalone MCP server and a Claude Code plugin.

## Motivation

Claude Code's built-in Grep/Glob tools handle text search well, but lack type-aware navigation (go-to-definition, find-references) that requires language server intelligence. Existing solutions like JetBrains MCP return overly verbose responses. This server provides the same capabilities with concise, controllable output.

## Architecture

```
Claude Code (or any MCP client)
    | stdio (JSON-RPC)
    v
+-------------------------+
|   lsp-mcp-server        |  Bun/TypeScript
|                         |
|  +-------------------+  |
|  |  MCP Server Layer  |  |  @modelcontextprotocol/sdk
|  |  (tool registry)   |  |
|  +---------+---------+  |
|            |             |
|  +---------v---------+  |
|  |  LSP Manager       |  |  Detects language from file extension,
|  |  (lifecycle, pool) |  |  spawns/caches LSP instances
|  +---------+---------+  |
|            |             |
|  +---------v---------+  |
|  |  Response Shaper   |  |  Trims LSP responses to compact format
|  |                    |  |  + optional metadata enrichment
|  +---------+---------+  |
|            |             |
|  +---------v---------+  |
|  |  File Indexer      |  |  In-memory file path index,
|  |                    |  |  fuzzy matching, .gitignore aware
|  +-------------------+  |
|            |             |
+------------+-------------+
             | stdio (JSON-RPC per LSP)
             v
   +-----------+  +----------------+
   | typescript |  | eclipse.jdt.ls |
   | -language  |  |                |
   | -server    |  |                |
   +-----------+  +----------------+
```

### Startup & Project Root

The `--project` CLI argument is parsed in `index.ts` at startup and validated (must be an existing directory). This project root is passed to:
- **File Indexer** — as the root directory to walk and index
- **LSP Manager** — as the `rootUri` in the LSP `initialize` request
- **Response Shaper** — for computing relative paths

### Layers

1. **MCP Server Layer** — Registers tools, handles MCP protocol via `@modelcontextprotocol/sdk`. Entry point for all requests.
2. **LSP Manager** — Auto-detects language from file extension, spawns the right language server on first use, caches it for the session, handles LSP initialization handshake.
3. **Response Shaper** — Takes verbose LSP responses, returns compact `{file, line, symbol, snippet}` with optional enrichment via boolean flags. Reads files from disk directly to build code snippets (does not rely on LSP hover data).
4. **File Indexer** — Builds an in-memory index of all file paths at startup. Supports fuzzy file name matching and targeted re-indexing.

## MCP Tools

### File Search Tools

#### `find_file`
Fuzzy file name search against the in-memory path index.

**Parameters:**
- `query` (string, required) — fuzzy match against file names
- `maxResults` (number, optional, default: 10) — max results to return

**Response:**
```json
[
  { "file": "/absolute/path/to/UserService.java", "relativePath": "src/main/java/com/example/UserService.java" }
]
```

#### `reindex`
Rebuilds the file index.

**Parameters:**
- `path` (string, optional) — directory to re-index. If omitted, re-indexes the entire project.

**Response:**
```json
{ "indexedFiles": 1423, "duration": 45 }
```

### LSP Navigation Tools

All navigation tools share these optional enrichment parameters:
- `includeKind` (boolean) — include symbol kind (class, method, field, etc.)
- `includeContainer` (boolean) — include containing symbol name
- `includeDocstring` (boolean) — include documentation string (where available)

#### `go_to_definition`
Jump to the definition of a symbol at a given position.

**Parameters:**
- `file` (string, required) — absolute file path
- `line` (number, required) — 1-based line number
- `column` (number, required) — 1-based column number
- Enrichment flags (optional)

**Response (default):** Array of locations (LSP can return multiple definitions for overloads, type unions, re-exports).
```json
[
  {
    "file": "/absolute/path/to/file.ts",
    "line": 42,
    "symbol": "handleRequest",
    "snippet": "  async handleRequest(req: Request): Promise<Response> {\n    const body = await req.json();\n    return this.process(body);"
  }
]
```

**Response (with enrichment):**
```json
[
  {
    "file": "/absolute/path/to/file.ts",
    "line": 42,
    "symbol": "handleRequest",
    "kind": "method",
    "container": "RequestHandler",
    "docstring": "Processes an incoming HTTP request and returns a response.",
    "snippet": "  async handleRequest(req: Request): Promise<Response> {\n    ..."
  }
]
```

#### `find_references`
Find all references to a symbol at a given position.

**Parameters:**
- `file` (string, required) — absolute file path
- `line` (number, required) — 1-based line number
- `column` (number, required) — 1-based column number
- `maxResults` (number, optional, default: 20)
- Enrichment flags (optional)

**Response:** Array of result objects (same shape as `go_to_definition`).

#### `document_symbols`
List all symbols in a file.

**Parameters:**
- `file` (string, required) — absolute file path
- Enrichment flags (optional)

**Response:**
```json
[
  { "name": "RequestHandler", "line": 10, "snippet": "export class RequestHandler {" },
  { "name": "handleRequest", "line": 42, "snippet": "  async handleRequest(req: Request): Promise<Response> {" }
]
```

#### `workspace_symbol`
Search for symbols across the entire project.

**Parameters:**
- `query` (string, required) — symbol name to search for
- `maxResults` (number, optional, default: 20)
- Enrichment flags (optional)

**Response:** Array of result objects including `file` path.

## Response Shaping

All responses follow these rules:
- **Default:** `{file, line, symbol, snippet}` — minimal, enough for Claude to reason about results
- **Snippet:** 3 lines (definition line + 2 below). Read from the file directly rather than relying on LSP hover data.
- **Enrichment flags:** Boolean parameters (`includeKind`, `includeContainer`, `includeDocstring`) that add metadata fields to the response when set to true
- **Paths:** Always absolute. `find_file` additionally includes `relativePath`.
- **Hierarchy:** `document_symbols` intentionally flattens hierarchical LSP responses into a flat list. Nested symbols (e.g., methods inside a class) appear at the top level with their `container` field set when `includeContainer` is true.
- **Errors:** On failure (file not found, LSP not available, timeout, unsupported language), tools return an MCP error with a human-readable message. Example: `{ "error": "No language server available for .rs files. Configure one in config.json." }`

## LSP Manager

### Auto-detection
Routes requests to the correct language server based on file extension:
- `.ts`, `.tsx`, `.js`, `.jsx` → `typescript-language-server --stdio`
- `.java` → `eclipse.jdt.ls` (via `jdtls` wrapper script)

**Note on JDT LS:** The Java default assumes the `jdtls` wrapper script is installed (via Mason, Homebrew, or manual install). The server auto-creates a workspace data directory at `/tmp/jdtls-workspace-<project-hash>/` per project. Users can override the command, args, and add environment variables (e.g., for Lombok agent) via `config.json`.

### Lifecycle
- LSP instances spawned on first request for a given language
- `initialize` handshake sent with project root, waits for `initialized` before serving requests
- Instances cached for the MCP server's lifetime (matches the Claude Code session)
- Graceful shutdown: sends LSP `shutdown` + `exit` on SIGTERM/SIGINT
- Crash recovery: if an LSP process dies, it's restarted on the next request for that language
- **Request timeout:** LSP requests time out after 10 seconds by default (configurable in `config.json`). On timeout, the MCP tool returns an error rather than blocking indefinitely. This is especially important for JDT LS which can be slow during initial indexing.

### Document Lifecycle
- When a tool request references a file, the LSP client sends `textDocument/didOpen` if the file is not already tracked as open.
- Documents are kept open for the duration of the MCP server session to avoid repeated open/close overhead.
- On MCP server shutdown, `textDocument/didClose` is sent for all open documents before the LSP `shutdown` sequence.
- The LSP client tracks open documents in a `Set<string>` keyed by file URI.

### Configuration
Optional `config.json` at the project root to override language server commands:
```json
{
  "languageServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"]
    },
    "java": {
      "command": "jdtls",
      "args": [],
      "env": {
        "JDTLS_JVM_ARGS": "-javaagent:/path/to/lombok.jar"
      }
    }
  },
  "requestTimeout": 10000
}
```

If no config exists, sensible defaults are used. Additional languages can be added by adding entries to this config.

**Prerequisite:** Language servers must be installed on the system. The MCP server does not install them — it logs a clear error if a configured LSP binary isn't found.

## File Indexer

### Startup Behavior
- On MCP server start, walks the project root and builds an in-memory map of all file paths
- Respects `.gitignore` rules (parsed via the `ignore` npm package)
- Hardcoded ignore list (always ignored regardless of `.gitignore`): `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `target`, `.gradle`, `.idea`, `.vscode`, `__pycache__`, `.cache`

### Index Structure
- Flat array of relative paths from project root
- Fuzzy matching via substring + path-segment scoring (file named `UserService.java` ranks highest for query `userservice`)

### Reindex Behavior
- `reindex()` — rebuilds the entire index from scratch
- `reindex({path: "src/api"})` — re-walks that subtree, removes stale entries from that subtree, adds new ones

### No File Watcher
Index is built once at startup. The `reindex` tool is available when the index becomes stale.

## Project Structure

```
lsp-mcp-server/
├── src/
│   ├── index.ts              # Entry point — starts MCP server
│   ├── mcp/
│   │   └── server.ts         # MCP tool registration & dispatch
│   ├── lsp/
│   │   ├── manager.ts        # LSP lifecycle, auto-detect, pool
│   │   ├── client.ts         # LSP client (JSON-RPC over stdio)
│   │   └── response-shaper.ts # Trims LSP responses to compact format
│   └── indexer/
│       ├── file-indexer.ts    # File tree walker, ignore rules
│       └── fuzzy-match.ts    # Fuzzy file name matching
├── plugin/                    # Claude Code plugin wrapper
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── .mcp.json
│   └── skills/
│       └── lsp-search/
│           └── SKILL.md       # Guides Claude on when/how to use tools
├── package.json
├── tsconfig.json
├── bunfig.toml
├── LICENSE                    # MIT
└── README.md
```

- `src/` — Standalone MCP server, usable via `bunx lsp-mcp-server --project /path/to/project`
- `plugin/` — Claude Code plugin wrapper pointing to the same binary via `.mcp.json`
- Published to npm for installation via `bunx` or `npx`

## Supported Languages (Initial)

| Language | Extensions | Language Server | Command |
|----------|-----------|----------------|---------|
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx` | typescript-language-server | `typescript-language-server --stdio` |
| Java | `.java` | Eclipse JDT LS | `jdtls` |

Additional languages added by user config or future built-in support.

## Non-Goals

- No multi-root / monorepo support (single project root per instance)
- No file watching (manual reindex via tool)
- No hover/completions (redundant with Claude's native capabilities)
- No diagnostics (potential future addition)
- Does not install language servers — user responsibility
