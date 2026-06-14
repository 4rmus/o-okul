import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/web/src", "apps/web/app", "apps/web/e2e-next"];
const storageReference = /\b(?:window\.)?(localStorage|sessionStorage)\b/g;
const allowedLocalStorageCall =
  /\b(?:window\.)?localStorage\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,\n)]+)/g;
const allowedLocalStorageKeys = {
  "apps/web/app/(auth)/login/page.tsx": {
    rememberedEmailStorageKey: "des.rememberedLoginEmail",
  },
  "apps/web/app/(app)/app-shell.tsx": {
    sidebarGroupStorageKey: "des.sidebar.expandedGroups.v2",
  },
};
const failures = [];

for (const root of roots) {
  for (const file of listFiles(root)) {
    const content = readFileSync(file, "utf8");

    const allowedRanges = collectAllowedRanges(file, content);
    for (const match of content.matchAll(storageReference)) {
      const start = match.index ?? 0;
      if (!allowedRanges.some((range) => range.start <= start && start < range.end)) {
        failures.push(`${file}:${lineNumber(content, start)}: izin verilmeyen ${match[1]} kullanımı`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Web token storage kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web token storage kontrolü geçti: yalnız izinli UI tercih anahtarları storage kullanıyor.");

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

function collectAllowedRanges(file, content) {
  const allowedKeys = allowedLocalStorageKeys[file];
  if (!allowedKeys) return [];

  const keyDeclarations = Object.entries(allowedKeys).map(([identifier, literal]) => {
    const escapedIdentifier = escapeRegExp(identifier);
    const escapedLiteral = escapeRegExp(literal);
    return new RegExp(`\\bconst\\s+${escapedIdentifier}\\s*=\\s*["']${escapedLiteral}["']`);
  });
  for (const declaration of keyDeclarations) {
    if (!declaration.test(content)) {
      failures.push(`${file}: izinli storage anahtarı beklenen sabit değerle tanımlı değil`);
      return [];
    }
  }

  const ranges = [];
  for (const match of content.matchAll(allowedLocalStorageCall)) {
    const keyExpression = (match[2] ?? "").trim();
    if (!Object.hasOwn(allowedKeys, keyExpression)) continue;
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
