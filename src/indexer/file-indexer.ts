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

  async index(subPath?: string): Promise<IndexStats> {
    const start = performance.now();

    if (!subPath) {
      this.ig = ignore();
      this.ig.add(HARDCODED_IGNORES);
      await this.loadGitignore();
      this.files = [];
      await this.walk("");
    } else {
      const prefix = subPath.endsWith("/") ? subPath : subPath + "/";
      this.files = this.files.filter(
        (f) => !f.startsWith(prefix) && f !== subPath
      );
      await this.walk(subPath);
    }

    const duration = Math.round(performance.now() - start);
    return { indexedFiles: this.files.length, duration };
  }

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
