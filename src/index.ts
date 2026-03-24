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
