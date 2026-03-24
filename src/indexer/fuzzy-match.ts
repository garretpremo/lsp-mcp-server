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
