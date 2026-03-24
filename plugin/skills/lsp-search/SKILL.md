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
