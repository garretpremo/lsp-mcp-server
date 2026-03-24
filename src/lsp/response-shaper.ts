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

function uriToPath(uri: string): string {
  return uri.replace("file://", "");
}

function extractSymbolName(
  _filePath: string,
  line: string,
  character: number
): string {
  const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  let match;
  while ((match = wordRegex.exec(line)) !== null) {
    if (character >= match.index && character < match.index + match[0].length) {
      return match[0];
    }
  }
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

  private async extractDocstring(
    filePath: string,
    lineZeroBased: number
  ): Promise<string | undefined> {
    const lines = await this.getFileLines(filePath);
    let end = lineZeroBased - 1;
    while (end >= 0 && lines[end].trim() === "") end--;
    if (end < 0) return undefined;
    if (!lines[end].trim().endsWith("*/")) return undefined;
    let start = end;
    while (start >= 0 && !lines[start].trim().startsWith("/**")) {
      start--;
    }
    if (start < 0) return undefined;
    return lines
      .slice(start, end + 1)
      .map((l) =>
        l
          .trim()
          .replace(/^\/\*\*\s?/, "")
          .replace(/^\*\/\s?$/, "")
          .replace(/^\*\s?/, "")
      )
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
        "targetSelectionRange" in loc ? loc.targetSelectionRange : loc.range;
      const filePath = uriToPath(uri);
      const lineZeroBased = range.start.line;
      const lines = await this.getFileLines(filePath);
      const lineContent = lines[lineZeroBased] ?? "";

      const result: ShapedResult = {
        file: filePath,
        line: lineZeroBased + 1,
        symbol: extractSymbolName(filePath, lineContent, range.start.character),
        snippet: await this.buildSnippet(filePath, lineZeroBased),
      };

      if (flags.includeDocstring) {
        result.docstring = await this.extractDocstring(filePath, lineZeroBased);
      }

      results.push(result);
    }

    return results;
  }

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
          : (sym as DocumentSymbol).selectionRange?.start.line ??
            (sym as DocumentSymbol).range.start.line;

      const result: ShapedResult = {
        file: filePath,
        line: lineZeroBased + 1,
        symbol: sym.name,
        snippet: filePath ? await this.buildSnippet(filePath, lineZeroBased) : "",
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
      if ("children" in sym && sym.children) {
        flat.push(...this.flattenSymbols(sym.children, sym.name));
      }
    }
    return flat;
  }
}
