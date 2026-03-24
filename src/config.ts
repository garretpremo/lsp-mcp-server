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
