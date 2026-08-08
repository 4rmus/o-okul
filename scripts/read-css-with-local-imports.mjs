import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function readCssWithLocalImports(entryPath, visited = new Set()) {
  const resolvedPath = resolve(entryPath);
  if (visited.has(resolvedPath)) {
    throw new Error(`CSS_IMPORT_CYCLE:${resolvedPath}`);
  }

  const nextVisited = new Set(visited).add(resolvedPath);
  const source = readFileSync(resolvedPath, "utf8");
  return source.replace(
    /^@import\s+["'](\.\/[^"']+)["'];[ \t]*$/gm,
    (_statement, importPath) => readCssWithLocalImports(resolve(dirname(resolvedPath), importPath), nextVisited),
  );
}
