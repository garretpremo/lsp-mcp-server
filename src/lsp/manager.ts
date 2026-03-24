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

  languageFor(filePath: string): string | undefined {
    const ext = extname(filePath);
    return this.config.languageForExtension(ext);
  }

  isSupported(filePath: string): boolean {
    return this.languageFor(filePath) !== undefined;
  }

  async getClient(filePath: string): Promise<LspClient> {
    const language = this.languageFor(filePath);
    if (!language) {
      throw new Error(
        `No language server available for ${extname(filePath)} files. Configure one in config.json.`
      );
    }

    const existing = this.clients.get(language);
    if (existing?.isAlive) {
      return existing;
    }

    const pending = this.starting.get(language);
    if (pending) {
      return pending;
    }

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

  allClients(): LspClient[] {
    return [...this.clients.values()].filter((c) => c.isAlive);
  }

  javaWorkspaceDir(): string {
    const hash = createHash("md5")
      .update(this.projectRoot)
      .digest("hex")
      .substring(0, 8);
    return `/tmp/jdtls-workspace-${hash}`;
  }

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
