import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";

const sourceRoots = ["apps/api/src", "apps/worker/src"];
const ignoredFiles = new Set([
  "apps/api/src/db/tenant-query.ts",
  "apps/api/src/health/health.service.ts",
]);
const rlsBypassHeaderAllowedFiles = new Set(["apps/api/src/context/rls-bypass.guard.ts"]);
const tenantScopedTables = getTenantScopedTables();

const failures = [];

for (const file of sourceRoots.flatMap(listTsFiles)) {
  if (ignoredFiles.has(file) || file.endsWith(".test.ts") || file.endsWith(".e2e.test.ts")) {
    continue;
  }

  const contents = readFileSync(file, "utf8");
  if (contents.includes("x-rls-bypass-reason") && !rlsBypassHeaderAllowedFiles.has(file)) {
    failures.push(`${file}: x-rls-bypass-reason header yalnız RlsBypassGuard içinde okunmalı.`);
  }
  if (!usesSql(contents)) {
    continue;
  }

  const functions = parseFunctionRanges(contents);
  const localScopedWrappers = findLocalScopedWrappers(functions);
  const tenantWrappers = [
    "withTenantQuery",
    "withExplicitTenantQuery",
    "withBypassRlsQuery",
    "withTenantDb",
    ...localScopedWrappers,
  ];
  const protectedRanges = findWrapperCallbackRanges(contents, tenantWrappers);
  const safeHelperRanges = findSafeHelperRanges(contents, functions, protectedRanges);
  const safeRanges = [...protectedRanges, ...safeHelperRanges];

  for (const query of findQueryCalls(contents)) {
    const touchedTable = touchesTenantScopedTable(query.source);
    if (!touchedTable) continue;
    if (inAnyRange(query.index, safeRanges)) continue;

    failures.push(
      `${file}:${lineNumber(contents, query.index)}: "${touchedTable}" sorgusu tenant/bypass wrapper veya yalnız wrapper'dan çağrılan helper dışında çalışıyor.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Tenant DB erişim kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Tenant DB erişim kontrolü geçti.");

function listTsFiles(root) {
  const entries = readdirSync(root);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function usesSql(contents) {
  return contents.includes(".query(") || contents.includes(".query<") || contents.includes("new pg.Pool");
}

function touchesTenantScopedTable(contents) {
  return tenantScopedTables.find((table) => contents.includes(`"${table}"`)) ?? touchesDynamicTenantTable(contents);
}

function touchesDynamicTenantTable(contents) {
  return /\b(?:FROM|JOIN|UPDATE|INTO)\s+"\$\{[^}]*tableName[^}]*\}"/.test(contents) ||
    /\bDELETE\s+FROM\s+"\$\{[^}]*tableName[^}]*\}"/.test(contents)
    ? "dynamic tenant table"
    : undefined;
}

function findQueryCalls(contents) {
  const calls = [];
  const regex = /\.query(?:<[^>]+>)?\s*\(/g;
  for (const match of contents.matchAll(regex)) {
    const index = match.index ?? 0;
    calls.push({ index, source: readCallSource(contents, index) });
  }
  return calls;
}

function readCallSource(contents, callIndex) {
  const open = contents.indexOf("(", callIndex);
  if (open === -1) return contents.slice(callIndex, callIndex + 500);

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < contents.length; index += 1) {
    const char = contents[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return contents.slice(callIndex, index + 1);
    }
  }
  return contents.slice(callIndex, callIndex + 500);
}

function parseFunctionRanges(contents) {
  const ranges = [];
  const seen = new Set();
  const patterns = [
    {
      kind: "function",
      regex: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)(?:<[^>{}]+>)?\s*\(/g,
    },
    {
      kind: "method",
      regex: /(?:^|\n)\s*(?:(?:private|public|protected)\s+)?(?:async\s+)?(\w+)(?:<[^>{}]+>)?\s*\(/g,
    },
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern.regex)) {
      const name = match[1];
      if (!name || ["catch", "constructor", "for", "function", "if", "switch", "while"].includes(name)) continue;
      const signatureOpen = contents.indexOf("(", match.index ?? 0);
      const signatureClose = findMatchingParen(contents, signatureOpen);
      const open = findFunctionBodyOpen(contents, signatureClose);
      const end = findMatchingBrace(contents, open);
      if (open === -1 || end === -1) continue;
      const key = `${name}:${open}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push({
        name,
        kind: pattern.kind,
        declarationStart: match.index ?? 0,
        start: open,
        end,
        body: contents.slice(open, end + 1),
      });
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function findMatchingParen(contents, open) {
  if (open === -1) return -1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < contents.length; index += 1) {
    const char = contents[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findFunctionBodyOpen(contents, signatureClose) {
  if (signatureClose === -1) return -1;
  let quote = null;
  let escaped = false;
  let typeDepth = 0;
  for (let index = signatureClose + 1; index < contents.length; index += 1) {
    const char = contents[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "<" || char === "(" || char === "[") {
      typeDepth += 1;
      continue;
    }
    if ((char === ">" || char === ")" || char === "]") && typeDepth > 0) {
      typeDepth -= 1;
      continue;
    }
    if (typeDepth === 0 && char === "{") return index;
    if (typeDepth === 0 && (char === ";" || char === "=")) return -1;
    if (typeDepth === 0 && char === "\n" && contents.slice(signatureClose + 1, index).trim() === "") return -1;
  }
  return -1;
}

function findLocalScopedWrappers(functions) {
  const tenantSettingHelpers = functions
    .filter((fn) => fn.body.includes("set_config('app.bypass_rls'"))
    .map((fn) => fn.name);

  return functions
    .filter((fn) =>
      fn.body.includes("BEGIN") &&
      fn.body.includes("COMMIT") &&
      (fn.body.includes("set_config('app.bypass_rls'") || tenantSettingHelpers.some((helper) => callsName(fn.body, helper)))
    )
    .map((fn) => fn.name);
}

function findWrapperCallbackRanges(contents, wrapperNames) {
  const ranges = [];
  for (const name of wrapperNames) {
    const regex = new RegExp(`(?:this\\.)?${escapeRegex(name)}\\s*\\(`, "g");
    for (const match of contents.matchAll(regex)) {
      const callStart = match.index ?? 0;
      const arrow = contents.indexOf("=>", callStart);
      if (arrow === -1 || arrow - callStart > 300) continue;
      const open = contents.indexOf("{", arrow);
      if (open === -1 || open - callStart > 400) continue;
      const end = findMatchingBrace(contents, open);
      if (end !== -1) ranges.push({ start: open, end, label: name });
    }
  }
  return ranges;
}

function findSafeHelperRanges(contents, functions, protectedRanges) {
  const safe = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (safe.includes(fn)) continue;
      if (!touchesTenantScopedTable(fn.body) || !usesSql(fn.body)) continue;

      const callSites = findCallSites(contents, fn, functions);
      if (callSites.length === 0) continue;
      const safeRanges = [...protectedRanges, ...safe];
      if (callSites.every((site) => inAnyRange(site, safeRanges))) {
        safe.push(fn);
        changed = true;
      }
    }
  }

  return safe.map((fn) => ({ start: fn.start, end: fn.end, label: fn.name }));
}

function findCallSites(contents, fn, functions) {
  const sites = [];
  const prefix = fn.kind === "method" ? "(?:this\\.)?" : "";
  const regex = new RegExp(`${prefix}${escapeRegex(fn.name)}\\s*\\(`, "g");
  for (const match of contents.matchAll(regex)) {
    const index = match.index ?? 0;
    if (fn.kind === "function" && index > 0 && /[\w$.]/.test(contents[index - 1])) continue;
    if (functions.some((candidate) => candidate.name === fn.name && index >= candidate.declarationStart && index <= candidate.start)) {
      continue;
    }
    sites.push(index);
  }
  return sites;
}

function callsName(contents, name) {
  return new RegExp(`(?:this\\.)?${escapeRegex(name)}\\s*\\(`).test(contents);
}

function findMatchingBrace(contents, open) {
  if (open === -1) return -1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < contents.length; index += 1) {
    const char = contents[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function inAnyRange(index, ranges) {
  return ranges.some((range) => index >= range.start && index <= range.end);
}

function lineNumber(contents, index) {
  return contents.slice(0, index).split(/\r?\n/).length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
