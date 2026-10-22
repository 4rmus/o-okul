import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";

const sourceRoots = ["apps/api/src", "apps/worker/src"];
const ignoredFiles = new Set([
  "apps/api/src/db/tenant-query.ts",
  "apps/api/src/health/health.service.ts",
]);
const rlsBypassHeaderAllowedFiles = new Set(["apps/api/src/context/rls-bypass.guard.ts"]);
const bypassRlsFunctionAllowlist = new Map([
  ["apps/api/src/auth/auth-user-store.ts", new Set([
    "purgePii",
    "createOrAttachTenantIdentity",
    "withAuthMutationQuery",
    "queryAuthUsers",
  ])],
  ["apps/api/src/tenant/tenant-store.ts", new Set([
    "list",
    "findById",
    "findBySlug",
    "findForAdmin",
    "createOnboarding",
    "update",
    "transitionStatus",
  ])],
  ["apps/api/src/license/license-term-store.ts", new Set(["create"])],
  // DEC-20261021-01: MFA reset notices are system-scoped outbox rows (tenantId NULL), written outside any tenant.
  ["apps/api/src/auth/mfa-security-notice.ts", new Set(["enqueue"])],
  ["apps/api/src/identity-invitation/employee-account-activation-store.ts", new Set(["accept"])],
  ["apps/api/src/identity-invitation/student-portal-activation-store.ts", new Set(["accept"])],
]);
// Every other way to switch RLS off — withTenantDb(..., { bypassRls: true }) and a raw
// set_config('app.bypass_rls', ...) that is not the literal 'false' — is pinned per file and function the same way
// (baseline 2026-10-20). A new bypass path fails CI until it is reviewed and added here.
const rawBypassFunctionAllowlist = new Map([
  // Audit writes without a tenant (system/control-plane events) run with bypass; tenant writes set it to false.
  ["apps/api/src/audit-log/audit-log-store.ts", new Set(["applyAuditWriteSettings"])],
  // Pre-auth stores: password reset tokens and refresh sessions are read before a tenant context exists.
  ["apps/api/src/auth/password-reset-store.ts", new Set(["withClient"])],
  ["apps/api/src/auth/session-store.ts", new Set(["withClient"])],
  // Invitation acceptance and delivery bookkeeping run before the invitee has a tenant session.
  ["apps/api/src/identity-invitation/identity-invitation-store.ts", new Set(["withBypassQuery"])],
  // MFA step-up gated control-plane operations (device restore approval, clean reset, purge export).
  ["apps/api/src/operations/device-restore.service.ts", new Set(["approve"])],
  ["apps/api/src/tenant/tenant-fresh-reset.service.ts", new Set([
    "management",
    "diagnostics",
    "deliveryReceipt",
    "createPurgeExport",
    "markPurgeExportDelivered",
  ])],
]);
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
  const functions = parseFunctionRanges(contents);
  requireAllowlistedBypassCalls(file, contents, functions, failures);
  requireAllowlistedRawBypass(file, contents, functions, failures);
  if (!usesSql(contents)) {
    continue;
  }

  const localScopedWrappers = findLocalScopedWrappers(functions);
  const tenantWrappers = [
    "withTenantQuery",
    "withExplicitTenantQuery",
    "withBypassRlsQuery",
    "withTenantDb",
    ...(file === "apps/api/src/auth/auth-user-store.ts" ? ["withAuthMutationQuery"] : []),
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

function requireAllowlistedBypassCalls(file, contents, functions, output) {
  const allowedFunctions = bypassRlsFunctionAllowlist.get(file) ?? new Set();
  for (const match of contents.matchAll(/withBypassRlsQuery\s*\(/g)) {
    const index = match.index ?? 0;
    const owner = functions.find((range) => index >= range.start && index <= range.end);
    if (!owner || !allowedFunctions.has(owner.name)) {
      output.push(`${file}:${lineNumber(contents, index)}: withBypassRlsQuery çağrısı izinli fonksiyon listesinde değil (${owner?.name ?? "module"}).`);
    }
  }
}

function requireAllowlistedRawBypass(file, contents, functions, output) {
  const allowedFunctions = rawBypassFunctionAllowlist.get(file) ?? new Set();
  const sites = [];
  for (const match of contents.matchAll(/withTenantDb\s*\(/g)) {
    const call = readCallSource(contents, match.index ?? 0);
    if (/bypassRls\s*:\s*true/.test(call)) sites.push({ index: match.index ?? 0, kind: "withTenantDb bypassRls:true" });
  }
  for (const match of contents.matchAll(/set_config\(\s*'app\.bypass_rls'\s*,\s*('false'|[^,)]+)/g)) {
    if (match[1] === "'false'") continue;
    sites.push({ index: match.index ?? 0, kind: "set_config app.bypass_rls" });
  }
  for (const site of sites) {
    const owner = functions
      .filter((range) => site.index >= range.start && site.index <= range.end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
    if (!owner || !allowedFunctions.has(owner.name)) {
      output.push(`${file}:${lineNumber(contents, site.index)}: ${site.kind} izinli fonksiyon listesinde değil (${owner?.name ?? "module"}).`);
    }
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
