import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FileIndexer } from "../indexer/file-indexer";
import { LspManager } from "../lsp/manager";
import { ResponseShaper } from "../lsp/response-shaper";
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
      maxResults: z.number().optional().default(10).describe("Max results to return"),
    },
    async ({ query, maxResults }) => {
      const results = indexer.search(query, maxResults);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "reindex",
    "Rebuild the file index (full or partial)",
    {
      path: z.string().optional().describe("Directory to re-index. If omitted, re-indexes entire project."),
    },
    async ({ path }) => {
      const stats = await indexer.index(path);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stats) }],
      };
    }
  );

  // --- LSP Navigation Tools ---

  const enrichmentSchema = {
    includeKind: z.boolean().optional().default(false).describe("Include symbol kind (class, method, etc.)"),
    includeContainer: z.boolean().optional().default(false).describe("Include containing symbol name"),
    includeDocstring: z.boolean().optional().default(false).describe("Include documentation string"),
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
      try {
        const clients = lspManager.allClients();
        if (clients.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "No language servers are running. Use go_to_definition or document_symbols on a file first to start a language server."
              }),
            }],
            isError: true,
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
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
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
