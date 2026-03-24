# lsp-mcp-server

A lightweight [MCP](https://modelcontextprotocol.io) server that exposes type-aware code navigation and fast file search to AI agents via language servers. It manages language server processes on demand, routes LSP requests from MCP tool calls, and returns structured results — letting agents jump to definitions, find references, list symbols, and locate files without reading entire codebases.

## Quick Start

```bash
# Install dependencies (requires Bun)
bun install

# Run against a project
bun run src/index.ts --project /path/to/your/project
```

## Available Tools

| Tool | Description |
|------|-------------|
| `find_file` | Fuzzy file name search against the project file index |
| `reindex` | Rebuild the file index (full project or a subdirectory) |
| `go_to_definition` | Jump to the definition of a symbol at a given file position |
| `find_references` | Find all references to a symbol at a given file position |
| `document_symbols` | List all symbols (classes, functions, etc.) in a file |
| `workspace_symbol` | Search for symbols by name across the entire project |

All LSP navigation tools accept optional enrichment flags: `includeKind`, `includeContainer`, and `includeDocstring`.

## Configuration

Place a `config.json` in your project root to override language server commands or the request timeout:

```json
{
  "requestTimeout": 15000,
  "languageServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"]
    },
    "java": {
      "command": "jdtls",
      "args": []
    }
  }
}
```

If no `config.json` is found, defaults are used. `requestTimeout` is in milliseconds (default: `10000`).

## Benchmarks: lsp-mcp-server vs JetBrains MCP

Tested against a 4,381-file Angular/TypeScript project (Nx monorepo).

### File Search — "document-viewer"

| | lsp-mcp-server | JetBrains MCP |
|--|---|---|
| **Response size** | ~1,500 chars | 9,792 chars |
| **Results** | 10 files, ranked by relevance | 40 items (files + dirs), unranked, duplicated by worktrees |
| **Format** | Absolute + relative paths | Flat path list with worktree duplicates |

### Document Symbols — `reports.service.ts`

| | lsp-mcp-server | JetBrains MCP |
|--|---|---|
| **Response size** | ~5,200 chars | 4,486 chars |
| **Result type** | 31 structured symbols (name, kind, container, snippet) | Raw file text (no symbols tool available) |
| **Structured** | Yes — class, method, property with hierarchy | No — LLM must parse symbols from raw text |

### Go To Definition — `HttpClient` import

| | lsp-mcp-server | JetBrains MCP |
|--|---|---|
| **Response size** | ~550 chars | 34,868 chars |
| **Result type** | 1 precise definition location | 50 text matches (grep-style, not semantic) |
| **Semantic** | Yes — LSP-powered, type-aware | No — text search with `search_in_files_by_text` |

### Agent Token Usage (identical tasks, Sonnet model)

| | lsp-mcp-server | JetBrains MCP |
|--|---|---|
| **Total tokens** | 18,910 | 25,994 |
| **Tool calls** | 3 | 10 |

### Summary

- **6.5x smaller** file search responses
- **63x smaller** definition lookup responses
- **27% fewer tokens** consumed by the agent
- Structured symbol data vs raw text
- True LSP semantics vs text-based grep

## Claude Code Plugin

The `plugin/` directory contains a Claude Code skill that wraps the MCP tools with higher-level search workflows. To use it, add the plugin path to your Claude Code configuration.

## Prerequisites

The following language servers must be installed and available on your `PATH`:

- **TypeScript / JavaScript**: [`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server)
  ```bash
  npm install -g typescript-language-server typescript
  ```
- **Java**: [`jdtls`](https://github.com/eclipse-jdtls/eclipse.jdt.ls) (Eclipse JDT Language Server)

Language servers are started lazily — only when a file of the matching type is first accessed.

## License

MIT
